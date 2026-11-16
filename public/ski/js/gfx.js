/* (G, round 11, 2026-11-14, for "smooth up the graphics for leonski" and "right now some ramps are also invisible so fix
   this as well") Drawing helpers main.js uses:
   - fixWinding: a feature mesh's triangles turned to face the way its vertex normals do. The quarterpipes facing -x
     (park.js Quarter, dir -1: the wallride, the left side hit, Jump 2's left quarterpipe) are laid out in a mirrored
     frame, so every triangle came out wound face down; the snow is drawn from the front only, so from above they were
     not drawn at all (the ground under them, lowered for them, showed instead). Checked per triangle, so any feature in
     a mirrored frame is drawn right, whatever the park adds later.
   - small features: the shapes the park leaves to the terrain's patches (no mesh of their own: the ramps up to the rails
     and boxes, butter mounds, Any mountain's ramps and side hits) are a few metres across, and the patches are 2 m a
     cell near the rider on the low tier, 4 m from about 70 m: a ramp 3.5 m long was mostly not there. Each is drawn by a
     fine grid of its own (from the full height function, as the kickers are), the patches lowered a little under it
     (overlayDip, below), and the grid drawn a hair in front of the patches (polygon offset) where they meet at its
     rim. The same program as the snow (a copy of its material), so nothing new is built. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ground } from './terrain.js?v=30';

// ---- smoothing the edges where the canvas has no multisampling (the low and medium tiers) --------------------------------
/* The scene is drawn into a picture the size of the canvas, then onto the canvas through a light FXAA pass (after the
   way Timothy Lottes' FXAA finds an edge: the luma of the four corners round a pixel gives the edge's direction, and
   the pixel is blended with two or four samples along it; a pixel with no contrast round it costs five lookups and is
   left as it is). The picture is marked as the browser's own kind of target (isXRRenderTarget, with its texture
   flagged sRGB but stored as plain bytes), so three draws the scene into it exactly as onto the canvas: the same tone
   curve and colour encoding, the very same programs (nothing new is built, the start's checks still hold), and the fog
   colours env.js works out for the screen are still right. */
const AA_VS = `varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const AA_FS = `precision highp float;
uniform sampler2D tDiffuse; uniform vec2 uInv; varying vec2 vUv;
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec4 cM = texture2D(tDiffuse, vUv);
  float lNW = lum(texture2D(tDiffuse, vUv + vec2(-1.0, -1.0) * uInv).rgb), lNE = lum(texture2D(tDiffuse, vUv + vec2(1.0, -1.0) * uInv).rgb);
  float lSW = lum(texture2D(tDiffuse, vUv + vec2(-1.0, 1.0) * uInv).rgb), lSE = lum(texture2D(tDiffuse, vUv + vec2(1.0, 1.0) * uInv).rgb);
  float lM = lum(cM.rgb);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  // (no edge here: as it is)
  if (lMax - lMin < max(0.04, lMax * 0.125)) { gl_FragColor = cM; return; }
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  float red = max((lNW + lNE + lSW + lSE) * (0.25 / 8.0), 1.0 / 128.0);
  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
  dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * uInv;
  vec3 a = 0.5 * (texture2D(tDiffuse, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tDiffuse, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture2D(tDiffuse, vUv - dir * 0.5).rgb + texture2D(tDiffuse, vUv + dir * 0.5).rgb);
  float lB = lum(b);
  gl_FragColor = vec4(lB < lMin || lB > lMax ? a : b, 1.0);
}`;
const _db = new THREE.Vector2();
export class PostAA {
  constructor(renderer) {
    this.r = renderer; this.on = true;
    const s = renderer.getDrawingBufferSize(_db);
    const rt = this.rt = new THREE.WebGLRenderTarget(Math.max(1, s.x), Math.max(1, s.y), { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, depthBuffer: true, stencilBuffer: false });
    rt.texture.colorSpace = THREE.SRGBColorSpace;   // (the programs: as onto the canvas, below)
    rt.texture.internalFormat = 'RGBA8';            // (stored as the canvas stores it: the encoded bytes, no second encoding)
    rt.isXRRenderTarget = true;                     // (three: tone mapped and encoded for the screen, as onto the canvas)
    rt.texture.name = 'smoothing';
    this.mat = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: rt.texture }, uInv: { value: new THREE.Vector2(1 / rt.width, 1 / rt.height) } },
      vertexShader: AA_VS, fragmentShader: AA_FS, depthTest: false, depthWrite: false, toneMapped: false });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(g, this.mat); this.quad.frustumCulled = false; this.quad.matrixAutoUpdate = false;
    this.scene = new THREE.Scene(); this.scene.add(this.quad); this.scene.matrixWorldAutoUpdate = false;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  // the pass's own program, built at the start with the others (main.js)
  compile() { return this.r.compileAsync(this.scene, this.cam); }
  render(scene, camera) {
    const R = this.r;
    if (!this.on) { R.setRenderTarget(null); R.render(scene, camera); return; }
    const s = R.getDrawingBufferSize(_db), rt = this.rt;
    if (s.x !== rt.width || s.y !== rt.height) { rt.setSize(s.x, s.y); this.mat.uniforms.uInv.value.set(1 / s.x, 1 / s.y); }
    // (the draw counts are the frame's both draws: the scene's and the pass's)
    const ar = R.info.autoReset, ac = R.autoClear;
    R.setRenderTarget(rt); R.render(scene, camera);
    // (the pass covers every pixel of the canvas: nothing to clear first)
    R.info.autoReset = false; R.autoClear = false;
    R.setRenderTarget(null); R.render(this.scene, this.cam);
    R.info.autoReset = ar; R.autoClear = ac;
  }
}

// ---- winding -------------------------------------------------------------------------------------------------------------
// every triangle wound against its corners' normals flipped; yields every `chunk` triangles (main.js builds the jumps a
// few milliseconds a frame); returns how many were flipped
export function* fixWinding(g, chunk = 8000) {
  const I = g.index, P = g.attributes.position, N = g.attributes.normal;
  if (!I || !P || !N) return 0;
  const ix = I.array, p = P.array, n = N.array, m = ix.length;
  let flipped = 0;
  for (let t = 0; t < m; t += 3) {
    const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const d = fx * (n[a] + n[b] + n[c]) + fy * (n[a + 1] + n[b + 1] + n[c + 1]) + fz * (n[a + 2] + n[b + 2] + n[c + 2]);
    if (d < 0) { const s = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = s; flipped++; }
    if (t % (chunk * 3) === chunk * 3 - 3) yield;
  }
  if (flipped) I.needsUpdate = true;
  return flipped;
}
export function fixWindingNow(g) { const it = fixWinding(g, Infinity); let r = it.next(); while (!r.done) r = it.next(); return r.value; }

// ---- small terrain-drawn features ------------------------------------------------------------------------------------------
// the features the terrain's patches draw (no mesh of their own) small enough that the patches cannot: a side under 40 m
// and at most 1600 m2 (the long rollers and the rock bands are drawn by the patches, as before)
const zA = f => f.zs ?? f.z0, zB = f => f.z1 ?? (f.zEnd + 2);
export function smallFeatures(park) {
  return (park && park.all || []).filter(f => {
    if (f.ownMesh || typeof f.height !== 'function') return false;
    const w = f.x1 - f.x0, l = zB(f) - zA(f);
    return Number.isFinite(w) && Number.isFinite(l) && w > 0 && l > 0 && Math.min(w, l) <= 40 && w * l <= 1600;
  });
}
/* how far the terrain's patches are lowered at x, z under the small features (as park.js visualDip lowers them under the
   kickers: up to 35 cm, twice the feature's rise), so the patches' straight cells never stand over the fine grid; main.js
   hands it to the park's visualDip before the first patch is built */
export function overlayDip(list) {
  const B = 32, key = (i, j) => (i + 32768) * 65536 + (j + 32768), grid = new Map();
  for (const f of list) for (let i = Math.floor(f.x0 / B); i <= Math.floor(f.x1 / B); i++) for (let j = Math.floor(zA(f) / B); j <= Math.floor(zB(f) / B); j++) {
    const k = key(i, j); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(f);
  }
  return (x, z, g) => {
    const l = grid.get(key(Math.floor(x / B), Math.floor(z / B))); if (!l) return 0;
    if (g === undefined) g = ground(x, z);
    let d = 0;
    for (const f of l) { const y = f.height(x, z, g); if (y > g + 0.02) d = Math.max(d, Math.min(0.35, (y - g) * 2)); }
    return d;
  };
}
// the overlay's material: the snow's own program (a copy of the material, as the terrain's batch has), drawn a hair in
// front where it lies on the patches at its rim
export function overlayMaterial(snow) {
  const m = snow.clone();
  m.onBeforeCompile = snow.onBeforeCompile; m.customProgramCacheKey = snow.customProgramCacheKey;
  m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -2;
  return m;
}
/* each feature's grid: rows and columns st m apart over its box (finer for the smaller ones), the full height (H) at
   each point, only the cells where the feature is the snow on top and stands over the bare ground (as park.js does for
   the kickers); merged into one mesh per `cell` m square of the world (each left out on its own when out of view; big
   squares, as each mesh is a draw call and the grids are only a few thousand triangles: the low tier's budget is draws).
   groomAt: the snow's groomed look there, as the terrain's patches have it, so the grid and the patches round it match. */
export function* overlaySteps(feats, { H, ground, groomAt, material, cell = 1024 }) {
  const cells = new Map();
  for (const f of feats) {
    const x0 = f.x0, x1 = f.x1, z0 = zA(f), z1 = zB(f), W = x1 - x0, L = z1 - z0;
    const st = Math.min(0.6, Math.max(0.25, 0.05 * Math.sqrt(W * L)));
    const nx = Math.max(2, Math.ceil(W / st) + 1), nz = Math.max(2, Math.ceil(L / st) + 1), dx = W / (nx - 1), dz = L / (nz - 1);
    const Y = new Float32Array(nx * nz), K = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++) {
      const z = z0 + j * dz;
      for (let i = 0; i < nx; i++) {
        const x = x0 + i * dx, g = ground(x, z), y = H(x, z), fy = f.height(x, z, g), v = j * nx + i;
        Y[v] = y; K[v] = fy > g + 0.003 && fy >= y - 0.45 ? 1 : 0;
      }
    }
    // the cells kept, and the points they use
    const map = new Int32Array(nx * nz).fill(-1), idx = [];
    let nv = 0;
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      if (!(K[a] | K[b] | K[c] | K[d])) continue;
      for (const v of [a, b, c, d]) if (map[v] < 0) map[v] = nv++;
      idx.push(map[a], map[c], map[b], map[b], map[c], map[d]);     // (+z then +x: faces up)
    }
    if (!nv) { yield; continue; }
    const P = new Float32Array(nv * 3), Nn = new Float32Array(nv * 3), Gr = new Float32Array(nv);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const v = j * nx + i, w = map[v]; if (w < 0) continue;
      const x = x0 + i * dx, z = z0 + j * dz;
      const il = Math.max(0, i - 1), ir = Math.min(nx - 1, i + 1), jd = Math.max(0, j - 1), ju = Math.min(nz - 1, j + 1);
      const hx = (Y[j * nx + ir] - Y[j * nx + il]) / ((ir - il) * dx), hz = (Y[ju * nx + i] - Y[jd * nx + i]) / ((ju - jd) * dz);
      const l = Math.hypot(hx, 1, hz);
      P[w * 3] = x; P[w * 3 + 1] = Y[v]; P[w * 3 + 2] = z;
      Nn[w * 3] = -hx / l; Nn[w * 3 + 1] = 1 / l; Nn[w * 3 + 2] = -hz / l;
      Gr[w] = groomAt(x, z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(Nn, 3));
    g.setAttribute('aGroom', new THREE.BufferAttribute(Gr, 1));
    g.setIndex(nv > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    const key = Math.floor((x0 + x1) / 2 / cell) + ',' + Math.floor((z0 + z1) / 2 / cell);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(g);
    yield;
  }
  const meshes = [];
  for (const [key, gs] of cells) {
    // (mixed index sizes: all to 32 bits before merging)
    if (gs.length > 1 && gs.some(g => g.index.array instanceof Uint32Array)) for (const g of gs) if (!(g.index.array instanceof Uint32Array)) g.setIndex(new THREE.Uint32BufferAttribute(g.index.array, 1));
    const g = gs.length > 1 ? mergeGeometries(gs, false) : gs[0];
    if (gs.length > 1) for (const x of gs) x.dispose();
    if (!g) continue;
    g.computeBoundingSphere(); g.computeBoundingBox();
    const m = new THREE.Mesh(g, material);
    m.name = 'small features ' + key; m.receiveShadow = true; m.castShadow = false; m.matrixAutoUpdate = false; m.updateMatrixWorld();
    meshes.push(m);
    yield;
  }
  return meshes;
}
