// Water for the open map: the sea, lakes, rivers and canals from the map data's water areas, drawn as a surface at the
// water's own level instead of the satellite picture lying on the ground. Lit as the game's other surfaces are (the
// sky's light and the sun), with a glossy surface that reflects the sky more the flatter you look across it, and small
// waves from several directions moving across it (the normal only: the surface itself stays flat, so nothing floats).
// One mesh and one material for all of an area's water.
//
//   const w = water.build(data, { scene, groundAt, focus: [x, z] });   w.group, w.dispose()
import * as THREE from 'three';

function inRing(x, z, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

let MAT = null;
const DROPS = Array.from({ length: 16 }, () => new THREE.Vector4(0, 0, -100, 0));
let dropI = 0;
// the page's underwater veil, made once
let VEIL = null;
function veil() {
  if (VEIL) return VEIL;
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5;opacity:0;transition:opacity .15s;' +
    'background:radial-gradient(ellipse at 50% 20%, rgba(70,140,150,.45), rgba(10,45,55,.82));backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)';
  document.body.appendChild(d);
  return (VEIL = d);
}
function material() {
  if (MAT) return MAT;
  // (both sides: from under the water its surface shows too)
  const m = new THREE.MeshStandardMaterial({ color: 0x1d3a44, roughness: 0.08, metalness: 0.0, envMapIntensity: 1.0, side: THREE.DoubleSide });
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = { value: 0 };
    sh.uniforms.uDrops = { value: DROPS };
    m.userData.shader = sh;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos;
uniform float uTime;
uniform vec4 uDrops[16];   // where something in the water stirred it: x, z, the time it did, how hard
// the slope of a few waves from different directions (a, k: height and wave number; w: speed)
vec2 waveSlope(vec2 p, float t) {
  vec2 g = vec2(0.0);
  const int N = 5;
  vec2 D[5]; D[0] = vec2(0.94, 0.34); D[1] = vec2(-0.42, 0.91); D[2] = vec2(0.71, -0.70); D[3] = vec2(-0.97, -0.24); D[4] = vec2(0.20, 0.98);
  float K[5]; K[0] = 0.55; K[1] = 0.83; K[2] = 1.37; K[3] = 2.31; K[4] = 3.9;
  float A[5]; A[0] = 0.030; A[1] = 0.021; A[2] = 0.012; A[3] = 0.0065; A[4] = 0.0035;
  for (int i = 0; i < N; i++) {
    float ph = K[i] * dot(D[i], p) + sqrt(9.8 * K[i]) * t * 0.55;
    g += D[i] * (A[i] * K[i] * cos(ph));
  }
  return g;
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    // small waves, calmer far away (where the pixels would only shimmer)
    float far = clamp(length(vWPos - cameraPosition) / 180.0, 0.0, 1.0);
    vec2 sl = waveSlope(vWPos.xz, uTime) * mix(1.0, 0.25, far);
    // rings going out from where a car or a person stirs the water (2.2 m/s, gone in about 4 s)
    for (int i = 0; i < 16; i++) {
      vec4 d = uDrops[i];
      if (d.w <= 0.0) continue;
      float age = uTime - d.z;
      if (age < 0.0 || age > 4.5) continue;
      vec2 dv = vWPos.xz - d.xy; float r = length(dv) + 1e-3;
      float front = 2.2 * age, x = r - front;
      float env = exp(-x * x / 1.6) * exp(-age * 0.9) * d.w / (1.0 + r * 0.35);
      sl += (dv / r) * cos(x * 3.2) * env * 0.55;
    }
    vec3 nW = normalize(vec3(-sl.x, 1.0, -sl.y));
    normal = normalize(mat3(viewMatrix) * nW);
  }`);
  };
  MAT = m;
  return m;
}

// the level of a water area: the ground's height where it is water (elevation data is flat over water), taken low so
// banks sampled by mistake do not lift it; a little over it so the ground does not show through
function levelOf(a, groundAt, focus) {
  const o = a.outer, hs = [];
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of o) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1]; }
  // inside the area and within 1.5 km of the middle of what is loaded
  const fx = focus[0], fz = focus[1], R = 1500;
  const bx0 = Math.max(x0, fx - R), bx1 = Math.min(x1, fx + R), bz0 = Math.max(z0, fz - R), bz1 = Math.min(z1, fz + R);
  if (bx1 <= bx0 || bz1 <= bz0) return null;
  let s = 0x9e3779b9 ^ (a.id | 0);
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  for (let i = 0; i < 400 && hs.length < 60; i++) {
    const x = bx0 + (bx1 - bx0) * rnd(), z = bz0 + (bz1 - bz0) * rnd();
    if (!inRing(x, z, o) || (a.holes || []).some(h => inRing(x, z, h))) continue;
    const g = groundAt(x, z);
    if (g != null && isFinite(g)) hs.push(+g);
  }
  if (!hs.length) return null;
  hs.sort((p, q) => p - q);
  // (a pond smaller than the elevation data's cells has its banks in it: taken higher, so the whole of it shows)
  let A = 0; for (let i = 0, j = o.length - 1; i < o.length; j = i++) A += (o[j][0] + o[i][0]) * (o[j][1] - o[i][1]);
  const small = Math.abs(A) / 2 < 60000;
  const lo = hs[Math.floor(hs.length * 0.3)] + 0.18;
  return small ? Math.max(lo, hs[Math.floor(hs.length * 0.85)] + 0.06) : lo;
}

export function build(data, ctx) {
  const group = new THREE.Group();
  group.name = 'water';
  group.matrixAutoUpdate = false;
  const groundAt = ctx.groundAt, focus = ctx.focus || [0, 0];
  const pos = [], idx = [], kept = [];
  let n = 0;
  // sea level here (the elevation data's 0: the sea, a bay, a harbour; its depths are the sea floor, not the water)
  const sea = ctx.seaY ? ctx.seaY(focus[0], focus[1]) : null;
  for (const a of (data && data.areas) || []) {
    if (a.kind !== 'water' || !a.outer || a.outer.length < 3) continue;
    const ocean = a.tags && a.tags.water === 'ocean';
    let y = ocean && sea != null ? sea + 0.12 : levelOf(a, groundAt, focus);
    if (y == null) continue;
    // (water lower than the sea is the sea floor of a bay or a harbour mapped as water: the water is at sea level)
    if (sea != null && y < sea + 0.12) y = sea + 0.12;
    try {
      const outer = a.outer.map(p => new THREE.Vector2(p[0], p[1]));
      const holes = (a.holes || []).filter(h => h && h.length >= 3).map(h => h.map(p => new THREE.Vector2(p[0], p[1])));
      const tris = THREE.ShapeUtils.triangulateShape(outer, holes);
      const pts = outer.concat(...holes), base = pos.length / 3;
      for (const p of pts) pos.push(p.x, y, p.y);
      for (const t of tris) idx.push(base + t[0], base + t[2], base + t[1]);
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const p of a.outer) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1]; }
      kept.push({ y, outer: a.outer, holes: a.holes || [], bb: [x0, z0, x1, z1] });
      n++;
    } catch (e) { /* a ring that cannot be cut into triangles */ }
  }
  if (!n) return { group, stats: { areas: 0 }, dispose() {} };
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeVertexNormals();
  // (flat: every normal straight up, whichever way a ring was wound)
  const nr = g.attributes.normal.array; for (let i = 0; i < nr.length; i += 3) { nr[i] = 0; nr[i + 1] = 1; nr[i + 2] = 0; }
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, material());
  mesh.name = 'water';
  mesh.receiveShadow = false; mesh.castShadow = false;
  mesh.matrixAutoUpdate = false;
  // the water's level at x, z, or null where there is none
  const levelAt = (x, z) => {
    for (const k of kept) { const b = k.bb; if (x < b[0] || x > b[2] || z < b[1] || z > b[3]) continue; if (inRing(x, z, k.outer) && !k.holes.some(h => inRing(x, z, h))) return k.y; }
    return null;
  };
  const last = new Map();
  let wasUnder = false;
  mesh.onBeforeRender = (renderer, scene, camera) => {
    const now = performance.now() / 1000;
    const sh = MAT && MAT.userData.shadow, s2 = MAT && MAT.userData.shader;
    void sh;
    if (s2) s2.uniforms.uTime.value = now;
    // whatever is in the water and moving stirs it: a ring every fifth of a second, harder the faster it goes
    const list = ctx.bodies ? ctx.bodies() : [];
    for (let i = 0; i < list.length; i++) {
      const b = list[i]; if (!b) continue;
      const y = levelAt(b.x, b.z);
      if (y == null || b.y > y + 0.6 || b.y < y - 3) { last.delete(i); continue; }
      const L = last.get(i);
      if (L && now - L.t < 0.2) continue;
      const moved = L ? Math.hypot(b.x - L.x, b.z - L.z) / Math.max(0.05, now - L.t) : 3;
      last.set(i, { x: b.x, z: b.z, t: now });
      if (moved < 0.3 && L) continue;
      DROPS[dropI].set(b.x, b.z, now, Math.min(1.6, 0.35 + moved * 0.12)); dropI = (dropI + 1) % DROPS.length;
    }
    // under the water: everything seen through blue-green water, a little blurred (an overlay on the page)
    const cy = levelAt(camera.position.x, camera.position.z), under = cy != null && camera.position.y < cy - 0.05;
    if (under !== wasUnder) { wasUnder = under; veil().style.opacity = under ? '1' : '0'; }
  };
  // (always drawn: the fog's change under water and the rings happen here)
  mesh.frustumCulled = false;
  group.add(mesh);
  if (ctx.scene) ctx.scene.add(group);
  return {
    group, stats: { areas: n, tris: idx.length / 3 },
    levelAt,
    dispose() { if (group.parent) group.parent.remove(group); g.dispose(); if (wasUnder) veil().style.opacity = '0'; },
  };
}
export default { build };
