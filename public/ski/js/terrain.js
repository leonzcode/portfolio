// The mountain: a groomed run going downhill along +z (x across, y up), deep snow beside it rising gently into a
// wide open snowfield (no mountains round it: Leon, 2026-11-05, "just a blue sky for now"), and the park's features
// (park.js) on it. One height function serves the physics and the meshes:
//   height(x, z)       full surface (features included)
//   normal(x, z, out)  its normal
//   surface(x, z)      0 groomed, 1 deep snow, 2 park feature (packed)
// The terrain is drawn as a quadtree of patches (32 x 32 quads each, smaller patches near the camera), built a few a
// frame, with skirts hiding the seams between sizes. Features with their own meshes (kickers, the pipe) are left out
// of the patches (the ground under them is lowered a little) and drawn by park.js at finer spacing.
import * as THREE from 'three';
import { fbm, ridged, smoothstep, clamp } from './noise.js?v=24';

// ---- the run's long profile ----------------------------------------------------------------------------------------
// [z where it starts, pitch in degrees] (above the start the slope behind is a gentle 12 degrees, not the old 26: with
// the mountains gone it is open snow up to the sky)
const SECTIONS = [
  [-900, 12], [-150, 10], [-55, 10], [12, 19], [42, 14], [395, 11], [640, 15], [700, 17], [890, 13],
  [960, 15], [1060, 11], [1150, 9], [1300, 5], [1420, 2], [1560, 0.5]
];
const Z0 = -900, Z1 = 2600, DZ = 0.5, NZ = Math.round((Z1 - Z0) / DZ) + 1;
const PITCH = new Float32Array(NZ), BASE = new Float32Array(NZ);
/* (J, round 9) a map may have a profile of its own: the Jump Line's short in-run (park.js JUMPLINE_RUN) drops in
   steeply below its start; the park map keeps SECTIONS. setRun(sections) is called by the map's park maker, before
   anything reads the run (main.js builds the park before the terrain, the lift and the props). */
export function setRun(sections = SECTIONS) { profile(sections); }
profile(SECTIONS);
function profile(SECTIONS) {
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
}
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
  if (mtn) return mtn.bare ? mtn.at(x, z) : mtn.at(x, z) + 0.35 * fbm(x * 0.06, z * 0.06, 2) + 0.5 * Math.max(0, fbm(x * 0.11 + 4, z * 0.11, 2));   // (bare: Freeride's own land, no noise added)
  const y0 = baseLine(z), W = runHalf(z), ax = Math.abs(x), d = ax - W;
  // gentle long undulations on the run, a slight crown, and the groomer's banks at its sides
  // (the crown stops a little past the run's sides: out in the open snowfield it would fall away for ever)
  const xc = Math.min(ax, W + 30);
  let y = y0 + 0.22 * fbm(x * 0.018 + 11, z * 0.014, 2) - 0.00018 * xc * xc;
  y += 0.38 * Math.exp(-(d - 0.6) * (d - 0.6) * 0.35);
  if (d > 0) {
    const s = smoothstep(0, 24, d);
    y += s * 1.6 * fbm(x * 0.03, z * 0.03, 3);           // drifts and pillows in the deep snow
    // the snow rising a little from the run's sides, then a broad open snowfield (the ranges and valley walls are gone)
    y += 0.05 * d - 0.03 * Math.max(0, d - 60) + 2.5 * smoothstep(40, 260, d) + 3 * fbm(x * 0.004 + 3, z * 0.004 - 7, 2) * smoothstep(60, 300, d);
  }
  return y;
}

// ground() less its noise (a few metres at most): for working out distances, not for drawing
function roughGround(x, z) {
  const d = Math.abs(x) - runHalf(z);
  return baseLine(z) - 0.00018 * Math.min(Math.abs(x), runHalf(z) + 30) ** 2 + (d > 0 ? 0.05 * d - 0.03 * Math.max(0, d - 60) + 2.5 * smoothstep(40, 260, d) : 0);
}

let park = null;           // set by park.js: { height(x, z, g) -> y or -Infinity, visualDip(x, z) -> metres, surface(x, z) }
export function setPark(p) { park = p; }
export function getPark() { return park; }

export function height(x, z) {
  const g = ground(x, z);
  if (!park) return g;
  const f = park.height(x, z, g);
  return f > g ? f : g;
}
// the height the terrain patches use: features with their own meshes left out, the ground under them lowered
export function visualHeight(x, z, st) {   // (st: the patch's cell size, for Freeride's rock: freeride.js)
  const g = ground(x, z);
  if (!park) return g;
  const f = park.heightTerrainOnly(x, z, g);
  return Math.max(g, f) - park.visualDip(x, z, st);
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
  if (mtn) return mtn.surface ? mtn.surface(x, z) : 1;
  if (park && park.surface(x, z)) return 2;
  return Math.abs(x) - runHalf(z) > 1.2 ? 1 : 0;
}

// ---- patches --------------------------------------------------------------------------------------------------------
// (big enough that there is snow at least 3.2 km out all round anywhere on the run: the snow material fades it into the
// sky's horizon by then, so its edge never shows. The old 4096 m root is one of its quarters' quarters, so the patches
// near the run are cut exactly as before)
const ROOT = { x0: -6144, z0: -5344, size: 16384 };
export class Terrain {
  constructor(scene, material, opts = {}) {
    this.scene = scene; this.mat = material;
    this.minLeaf = opts.minLeaf || 16;      // metres
    if (mtn && opts.mtnLeaf) this.minLeaf = Math.min(this.minLeaf, opts.mtnLeaf);   // (a mountain map's own: main.js)
    this.SEG = opts.seg || 24;               // quads along a patch's side
    this.K = opts.K || 1.7;                  // split when the camera is within K patch sizes
    this.group = new THREE.Group(); this.group.name = 'terrain'; scene.add(this.group);
    this.cache = new Map(); this.shown = new Set(); this.queue = [];
    this.budget = opts.budget || 4;          // ms a frame for building
    this.index = this.makeIndex();
    this.root = opts.root || ROOT;
    // patches wholly past this are not drawn: the snow material has faded the snow into the horizon's colour by then,
    // and the sky dome shows that same colour below the horizon
    this.cull = opts.root ? Infinity : opts.far || 3250;
    /* (E, 2026-11-09, for the walls on Freeride's skyline at x = 2048: where patches past the far distance are left
       out, none is bigger than 1024 m. A 4096 m patch is 128 m a cell on the low tier, and on Freeride's mountains its
       surface fell up to 66 m under the ground's true height, so the 1024 m patch beside it showed its skirt as a wall
       that tall. Kept to 1024 m, no far seam steps more than about 11 m; it is 1 to 10 patches more, and no more triangles
       in view, since the big squares reached far past the far distance) */
    this.maxLeaf = this.cull === Infinity ? Infinity : 1024;
    this.cam = new THREE.Vector3();
    /* (2026-11-09, the second lag pass: every patch is drawn by one BatchedMesh, one draw for all the snow, each patch
       still left out on its own when it is out of view, and drawn nearest first. Each patch shown is copied into a
       slot of the batch's buffers once; a patch hidden keeps its slot (shown again with no copy) until a new patch
       needs one, which then takes the slot hidden longest. In v20 the near patches were a draw each and the big far
       ones merged into one mesh per 2 km square, which drew the patches behind the camera too.) */
    this.inUse = new Set();
    this.slots = new Map();                  // patch key -> { geom, inst, vis, used }
    // (slots: about twice the most patches seen at once, 77 on the low tier, 131 on medium, on Freeride; the low tier's
    // build budget is 3 ms, main.js. 160 slots of 32 x 32 quads are about 9 MB on the graphics card)
    this.cap = this.budget <= 3 ? 160 : 260;
    this.batch = null;
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
  /* (2026-11-08, the lag pass: a patch's heights are worked out a row at a time, as many rows a frame as the budget
     allows, so no frame waits for a whole patch. The heights are most of a patch's cost (Freeride's land, the park's
     features under it): a whole patch at once held a frame 2 to 5 ms on this machine, four to six times that on a
     slow one. The patch is put together once its last row is in.) */
  job(key, x0, z0, size) {
    const N = this.SEG + 3;
    return { key, x0, z0, size, st: size / this.SEG, N, H: new Float32Array(N * N), j: 0 };
  }
  // work on a job's heights until the clock passes `until`; true when they are all in
  stepJob(J, until) {
    const { x0, z0, st, N, H } = J;
    while (J.j < N) {
      const j = J.j, z = z0 + (j - 1) * st;
      for (let i = 0; i < N; i++) H[j * N + i] = visualHeight(x0 + (i - 1) * st, z, st);
      J.j++;
      if (performance.now() > until) break;
    }
    return J.j >= N;
  }
  build(key, x0, z0, size) { const J = this.job(key, x0, z0, size); this.stepJob(J, Infinity); return this.mesh(J); }
  mesh(J) {
    const { x0, z0, size, H, key } = J;
    const SEG = this.SEG, n = SEG + 1, st = size / SEG, N = n + 2;
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
    m.userData = { key, ymin, ymax, used: 0, x0, z0, size };
    return m;
  }
  // choose the patches for the camera at cam; meshes not built yet are queued and their parent stays meanwhile
  update(cam, frame) {
    /* (2026-11-06, the lag pass: the walk sampled the noise twice at every node, every frame, about 5% of a frame on a
       slow machine. Nothing waiting to be built and the camera within 1.5 m of where it last chose: the same patches
       stand, so the walk is skipped; a camera moved that little never changes a patch's detail.) */
    if (!this.queue.length && this._at && this._at.distanceToSquared(cam) < 2.25) return 0;
    (this._at || (this._at = cam.clone())).copy(cam);
    this.cam.copy(cam);
    const want = [];
    const visit = (x0, z0, size, lvl) => {
      const d = this.dist(x0, z0, size);
      if (lvl > 0 && d > this.cull) return;
      const key = lvl + ':' + x0 + ':' + z0;
      // (the open snow well off the run and above the start is smooth: it is split at 0.6 of the distance)
      const open = this.cull !== Infinity && (x0 > 120 || x0 + size < -120 || z0 + size < -250);
      // (a made-up mountain may ask for coarser patches: mtn.lodK, Freeride's steep face on the low tier, 2026-11-07)
      const split = size > this.minLeaf && (size > this.maxLeaf || d < size * this.K * (open ? 0.6 : 1) * (mtn && mtn.lodK || 1));
      if (split) {
        const h = size / 2, kids = [[x0, z0], [x0 + h, z0], [x0, z0 + h], [x0 + h, z0 + h]];
        const ready = kids.every(([kx, kz]) => this.cache.has((lvl + 1) + ':' + kx + ':' + kz));
        if (ready || !this.cache.has(key)) { for (const [kx, kz] of kids) visit(kx, kz, h, lvl + 1); return; }
        for (const [kx, kz] of kids) { const kk = (lvl + 1) + ':' + kx + ':' + kz; if (!this.cache.has(kk)) this.queue.push([kk, kx, kz, h, this.dist(kx, kz, h)]); }
      }
      if (!this.cache.has(key)) { this.queue.push([key, x0, z0, size, this.dist(x0, z0, size)]); cover(x0, z0, size, lvl, 2); }
      else want.push(key);
    };
    /* (2026-11-06, for "random frames where it like blinks": a patch wanted but not built yet, as when the camera moves
       away and four small patches should give way to one bigger one, left its ground out until it was built, a frame
       or more of sky showing through the snow. Its smaller patches already built (up to two sizes down) stay meanwhile.) */
    const cover = (x0, z0, size, lvl, depth) => {
      const h = size / 2;
      for (const [kx, kz] of [[x0, z0], [x0 + h, z0], [x0, z0 + h], [x0 + h, z0 + h]]) {
        const kk = (lvl + 1) + ':' + kx + ':' + kz;
        if (this.cache.has(kk)) want.push(kk);
        else if (depth > 1 && h > this.minLeaf) cover(kx, kz, h, lvl + 1, depth - 1);
      }
    };
    this.queue.length = 0;
    visit(this.root.x0, this.root.z0, this.root.size, 0);
    // build nearest first within the budget (a patch not finished is carried on next frame, its rows kept)
    if (this.queue.length) {
      const seen = new Set(), jobs = this.jobs || (this.jobs = new Map());
      this.queue.sort((a, b) => a[4] - b[4]);
      const until = performance.now() + this.budget;
      for (const q of this.queue) {
        if (this.reach && q[4] > this.reach) break;       // (warm: only as far as reach)
        if (seen.has(q[0])) continue; seen.add(q[0]);
        const J = jobs.get(q[0]) || this.job(q[0], q[1], q[2], q[3]);
        if (this.stepJob(J, until)) { jobs.delete(q[0]); this.cache.set(q[0], this.mesh(J)); }
        else { jobs.set(q[0], J); break; }
        if (performance.now() > until) break;
      }
      // (a patch no longer wanted is dropped half built)
      if (jobs.size > 8) for (const k of jobs.keys()) if (!seen.has(k)) jobs.delete(k);
    }
    const now = new Set(want);
    for (const k of now) this.cache.get(k).userData.used = frame;
    this.show(now, frame);
    this.inUse = now;
    if (this.cache.size > 900) this.trim(frame);
    return this.reach ? this.queue.filter(q => q[4] <= this.reach && !this.cache.has(q[0])).length : this.queue.length;
  }
  // the patches in `now` shown in the batch, the others hidden; a patch with no slot yet is given one
  show(now, frame) {
    if (!this.batch) {
      const n = this.SEG + 1, vp = n * n + 4 * n, ip = this.index.length;
      const cap = this.cap;
      this.vp = vp; this.ip = ip;
      // (its own copy of the snow material, the same shader: shared with the kickers and the rock, three looked its
      // program up again every frame at each change between the batch and them)
      const bm = this.mat.clone(); bm.onBeforeCompile = this.mat.onBeforeCompile; bm.customProgramCacheKey = this.mat.customProgramCacheKey;
      const b = this.batch = new THREE.BatchedMesh(cap, cap * vp, cap * ip, bm);
      b.name = 'snow patches'; b.receiveShadow = true; b.castShadow = false; b.frustumCulled = false; b.matrixAutoUpdate = false;
      b.renderOrder = 1;                     // (after the things standing on the snow: what is in front is drawn first)
      b.colorTexture = null;                 // (three r180 asks a batch for colorTexture, which it calls _colorsTexture: undefined made it look the program up again every frame)
      this.group.add(b); b.updateMatrixWorld();
    }
    const B = this.batch;
    for (const [k, S] of this.slots) {
      const vis = now.has(k);
      if (vis !== S.vis) { B.setVisibleAt(S.inst, vis); S.vis = vis; }
      if (vis) S.used = frame;
    }
    for (const k of now) {
      if (this.slots.has(k)) continue;
      const g = this.cache.get(k).geometry;
      let S = null;
      if (B.instanceCount < this.cap) {
        const geom = B.addGeometry(g, this.vp, this.ip);
        S = { geom, inst: B.addInstance(geom), vis: true, used: frame };
      } else {
        // (the slot hidden longest; its old patch keeps nothing in the batch)
        let old = null;
        for (const [k2, S2] of this.slots) if (!S2.vis && (!old || S2.used < old[1].used)) old = [k2, S2];
        if (!old) { this.single(k); continue; }
        this.slots.delete(old[0]); S = old[1];
        B.setGeometryAt(S.geom, g); B.setVisibleAt(S.inst, true); S.vis = true; S.used = frame;
      }
      this.slots.set(k, S);
    }
    // (more patches at once than the batch holds, which no ride has asked for: the rest drawn one by one)
    for (const k of this.shown) if (!now.has(k) || this.slots.has(k)) { const m = this.cache.get(k); if (m) this.group.remove(m); this.shown.delete(k); }
  }
  single(k) { const m = this.cache.get(k); if (!m.parent) { m.updateMatrix(); this.group.add(m); m.updateMatrixWorld(); } this.shown.add(k); }
  dist(x0, z0, size) {
    const c = this.cam;
    const dx = Math.max(x0 - c.x, 0, c.x - (x0 + size)), dz = Math.max(z0 - c.z, 0, c.z - (z0 + size));
    // (2026-11-06, the lag pass: the ground's height here only counts when the camera is 30 m over it, so off the real
    // mountain the run's long profile and the snowfield's rise do, without the noise: ground() was most of each walk)
    const qx = clamp(c.x, x0, x0 + size), qz = clamp(c.z, z0, z0 + size);
    /* (2026-11-09: on a mountain the ground there is the mountain's own, dear to work out (Freeride's), and the walk
       asked for it at every node every time the camera moved 1.5 m: kept on an 8 m grid; it only weighs the camera's
       height over the ground, with 30 m to spare, so 8 m across changes nothing) */
    let gy;
    if (mtn) {
      const gx = Math.round(qx * 0.125), gz = Math.round(qz * 0.125), k = (gx + 32768) * 65536 + gz + 32768;
      const G = this.gmemo || (this.gmemo = new Map());
      gy = G.get(k);
      if (gy === undefined) { if (G.size > 40000) G.clear(); gy = ground(gx * 8, gz * 8); G.set(k, gy); }
    } else gy = roughGround(qx, qz);
    return Math.hypot(dx, dz, Math.max(0, Math.abs(c.y - gy) - 30) * 0.6);
  }
  trim(frame) {
    const list = [...this.cache.entries()].filter(([k]) => !this.inUse.has(k)).sort((a, b) => a[1].userData.used - b[1].userData.used);
    for (let i = 0; i < list.length - 600; i++) { list[i][1].geometry.dispose(); this.cache.delete(list[i][0]); }
  }
  // build everything the camera at p needs now (behind the loading screen); reach: only the patches within that many
  // metres (2026-11-12, loading: the far ones, about half of them, are built in the first frames after, nearest first)
  warm(p, reach = 0) { const b = this.budget; this.budget = 1e9; this.reach = reach; for (let i = 0; i < 12; i++) if (!this.update(p, 0)) break; this.budget = b; this.reach = 0; this._at = null; }
}
