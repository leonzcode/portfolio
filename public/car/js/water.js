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
function material() {
  if (MAT) return MAT;
  const m = new THREE.MeshStandardMaterial({ color: 0x1d3a44, roughness: 0.08, metalness: 0.0, envMapIntensity: 1.0 });
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = { value: 0 };
    m.userData.shader = sh;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos;
uniform float uTime;
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
  return hs[Math.floor(hs.length * 0.3)] + 0.18;
}

export function build(data, ctx) {
  const group = new THREE.Group();
  group.name = 'water';
  group.matrixAutoUpdate = false;
  const groundAt = ctx.groundAt, focus = ctx.focus || [0, 0];
  const pos = [], idx = [];
  let n = 0;
  for (const a of (data && data.areas) || []) {
    if (a.kind !== 'water' || !a.outer || a.outer.length < 3) continue;
    const y = levelOf(a, groundAt, focus);
    if (y == null) continue;
    try {
      const outer = a.outer.map(p => new THREE.Vector2(p[0], p[1]));
      const holes = (a.holes || []).filter(h => h && h.length >= 3).map(h => h.map(p => new THREE.Vector2(p[0], p[1])));
      const tris = THREE.ShapeUtils.triangulateShape(outer, holes);
      const pts = outer.concat(...holes), base = pos.length / 3;
      for (const p of pts) pos.push(p.x, y, p.y);
      for (const t of tris) idx.push(base + t[0], base + t[2], base + t[1]);
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
  mesh.onBeforeRender = () => { const sh = MAT && MAT.userData.shader; if (sh) sh.uniforms.uTime.value = performance.now() / 1000; };
  group.add(mesh);
  if (ctx.scene) ctx.scene.add(group);
  return {
    group, stats: { areas: n, tris: idx.length / 3 },
    dispose() { if (group.parent) group.parent.remove(group); g.dispose(); },
  };
}
export default { build };
