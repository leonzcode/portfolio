/* Freeride's meshes: the rock faces, the jibs, the start flags and the finish arch.
   Rock faces. A heightfield cliff draws as long thin triangles, so every cliff band, chute wall, rib end and outcrop
   gets a curtain of its own: rows along its lip (every 0.9 m, 1.35 on the low tier), each a cross-section of the real
   height from 4 m behind the lip down the face to 2 m out on the snow below, a point every 0.6 m of the face's height
   (0.85 on the low tier) and few on the snow either side, the same number in every row of an element so rows always
   join. Every point is on the land itself, so what is drawn is what is ridden (2026-11-08: the points were pushed out
   by up to 0.9 m for bulges and strata, rock standing where the rider was not stopped; the bulges are the land's own
   now, and the strata the rock material's). A band's rows run straight down the fall line, a row every dr across it;
   an outcrop's go round its outline at right angles to it. The terrain's own fine patches are held down under them
   (freeride.js visualDip), only where they cover it (markCover), so the curtains draw the real surface there and
   nothing coarse stands in front of a face.
   Each quad goes to the rock mesh (steeper than about 53 degrees) or to a snow mesh drawn with the terrain's own snow
   material, lifted a few centimetres (and a little more for each element, so two curtains meeting at a corner never
   fight over the same snow). All of it is one rock mesh and one snow mesh, two draw calls (the rock slab of the jibs
   goes in the rock mesh too). */
import * as THREE from 'three';
import { snowUniforms, FIELD_GLSL, fieldUniforms } from './materials.js?v=26';
import { simplex, clamp, smoothstep, rng } from './noise.js?v=26';
import { rockArrays, stripsOf, ZONES } from './frrockgeo.js?v=26';   // (2026-11-12: the curtains' sums, for a worker too)
export { stripsOf };

// ---- the rock material: grey stone with strata, cracks and streaks, snow where it faces up -----------------------------
/* (2026-11-11, for "better graphics for the entire mountain": rock from a real photograph) Poly Haven's "Dark Rock 02"
   (CC0, materials.js freerideLook): its colour, height, normal and occlusion, seen from the three axes and blended by
   the face's facing (no stretching on a wall), its layers lying level on the walls as rock beds do; at two sizes on the
   tiers above low (3.4 m and 13 m a repeat, so no tile shows) and one on low; the layers of the rock in height, each its
   own shade, and the iron stains and wet streaks as before; snow on what faces up, ledges and the tops of the beds,
   by the photo's own relief; and the mountain's own light (materials.js field: out of the sun behind a ridge, less sky
   in a couloir). Until the pictures have come, the old drawn rock. */
let ROCK = null;
export function rockMaterial(q) {
  if (ROCK) return ROCK;
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  m.name = 'freeride rock';
  const fine = q.tier !== 'low';
  m.onBeforeCompile = s => {
    s.uniforms.uNoise = snowUniforms.uNoise; s.uniforms.uNight = snowUniforms.uNight;
    s.uniforms.uRockCol = snowUniforms.uRockCol; s.uniforms.uRockNrm = snowUniforms.uRockNrm; s.uniforms.uRockTex = snowUniforms.uRockTex;
    fieldUniforms(s);
    s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>
varying vec3 vWPos; varying vec3 vWNor;`).replace('#include <project_vertex>', `#include <project_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNor = normalize(mat3(modelMatrix) * objectNormal);`);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWPos; varying vec3 vWNor; uniform sampler2D uNoise; uniform float uNight;
uniform sampler2D uRockCol; uniform sampler2D uRockNrm; uniform float uRockTex;
${FIELD_GLSL}
float gSnowR; vec3 gBl; vec4 gFl; vec3 gRN;
// the noise picture seen from the three axes, blended by the surface's facing (no stretching on a wall)
vec4 tri3(float k) { return texture2D(uNoise, vWPos.zy * k) * gBl.x + texture2D(uNoise, vWPos.xz * k) * gBl.y + texture2D(uNoise, vWPos.xy * k) * gBl.z; }
// the rock's pictures the same way (a wall's layers level: v is the height)
vec4 triT(sampler2D t, float k) { return texture2D(t, vWPos.zy * k) * gBl.x + texture2D(t, vWPos.xz * k) * gBl.y + texture2D(t, vWPos.xy * k) * gBl.z; }
// its normal: each view's tangent x and y laid on the world's two axes in that view (and its occlusion, gAO)
float gAO;
vec3 triN(float k) {
  vec3 a = texture2D(uRockNrm, vWPos.zy * k).rgb, b = texture2D(uRockNrm, vWPos.xz * k).rgb, c = texture2D(uRockNrm, vWPos.xy * k).rgb;
  gAO = a.b * gBl.x + b.b * gBl.y + c.b * gBl.z;
  a.xy = a.xy * 2.0 - 1.0; b.xy = b.xy * 2.0 - 1.0; c.xy = c.xy * 2.0 - 1.0;
  return vec3(0.0, a.y, a.x) * gBl.x + vec3(b.x, 0.0, b.y) * gBl.y + vec3(c.x, c.y, 0.0) * gBl.z;
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 wn = normalize(vWNor);
  gBl = pow(abs(wn), vec3(4.0)); gBl /= gBl.x + gBl.y + gBl.z;
  gFl = fieldAt(vWPos.xz);
  float h1 = tri3(0.045).b;
  // the layers of the rock: bands in height, warped, each its own shade
  float lay = vWPos.y * 0.62 + (h1 - 0.5) * 3.2;
  float band = fract(lay), bandId = floor(lay);
  float shade = fract(sin(bandId * 12.9898) * 43758.5453);
  vec3 rock; float relief;
  gRN = vec3(0.0);
  if (uRockTex > 0.5) {
    // the photo's rock (linear, about 0.04 on average: real gneiss and schist are nearer 0.12, and a little greyer)
    vec4 c1 = triT(uRockCol, 0.29);
    ${fine ? 'vec4 c2 = triT(uRockCol, 0.077); vec3 col = mix(c1.rgb, c2.rgb, 0.35) * (0.8 + 0.45 * c2.a); relief = mix(c1.a, c2.a, 0.3);' : 'vec3 col = c1.rgb * (0.85 + 0.35 * h1); relief = c1.a;'}
    col = mix(vec3(dot(col, vec3(0.3, 0.55, 0.15))), col, 0.75) * 2.9;
    gRN = triN(0.29);
    rock = col * (0.78 + 0.4 * shade) * (0.45 + 0.55 * gAO);      // (the cracks and hollows darker)
    ${fine ? 'gRN = gRN * 0.8 + triN(0.077) * 0.45;' : ''}
  } else {
    float h2 = tri3(0.19).b, h3 = ${fine ? 'tri3(0.8).b' : '0.5'};
    rock = mix(vec3(0.085, 0.082, 0.08), vec3(0.25, 0.24, 0.225), clamp(0.25 + shade * 0.45 + (h2 - 0.5) * 0.7 + (h3 - 0.5) * 0.3, 0.0, 1.0));
    relief = h2;
  }
  // a warm iron stain here and there, dark wet streaks running down, the cracks between the layers
  rock = mix(rock, rock * vec3(1.18, 0.98, 0.8), smoothstep(0.55, 0.75, h1) * 0.6);
  float streak = texture2D(uNoise, vec2((vWPos.x + vWPos.z) * 0.35, vWPos.y * 0.03)).b;
  rock *= 1.0 - 0.35 * smoothstep(0.55, 0.8, streak) * (1.0 - abs(wn.y));
  rock *= 0.78 + 0.22 * smoothstep(0.0, 0.12, band) * smoothstep(1.0, 0.9, band);
  // snow lying on what faces up: ledges, the tops of the beds, the photo's own shelves (its normal turned up)
  vec3 pn0 = normalize(wn + gRN * 0.9);
  gSnowR = smoothstep(0.52, 0.74, pn0.y + (relief - 0.5) * 0.5 + (h1 - 0.5) * 0.25);
  diffuseColor.rgb = mix(rock, vec3(0.9, 0.93, 0.97), gSnowR);
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(0.93, 0.8, gSnowR);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec3 wn = normalize(vWNor), pn;
  if (uRockTex > 0.5) pn = wn + gRN * (1.0 - gSnowR * 0.7);
  else {
    // bumps at two scales from the noise picture's normals, projected as the colour is
    vec2 a = texture2D(uNoise, vWPos.zy * 0.19).rg * 2.0 - 1.0, b = texture2D(uNoise, vWPos.xz * 0.19).rg * 2.0 - 1.0, c = texture2D(uNoise, vWPos.xy * 0.19).rg * 2.0 - 1.0;
    pn = wn + (vec3(0.0, a.y, a.x) * gBl.x + vec3(b.x, 0.0, b.y) * gBl.y + vec3(c.x, c.y, 0.0) * gBl.z) * (0.85 - gSnowR * 0.6);
  }
  normal = normalize((viewMatrix * vec4(normalize(pn), 0.0)).xyz);
}`)
      .replace('#include <opaque_fragment>', `outgoingLight -= (reflectedLight.directDiffuse + reflectedLight.directSpecular) * uNight * 0.7;
// the mountain's own light: behind a ridge out of the sun (not by night), a couloir's walls seeing less of the sky
outgoingLight -= (reflectedLight.directDiffuse + reflectedLight.directSpecular) * (1.0 - gFl.b) * (1.0 - uNight) * 0.95;
outgoingLight -= (reflectedLight.indirectDiffuse + reflectedLight.indirectSpecular) * (1.0 - gFl.g) * 0.8;
#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'frrock2' + (fine ? 1 : 0);
  ROCK = m;
  return m;
}

// ---- curtains ------------------------------------------------------------------------------------------------------------
// (2026-11-12: worked out in frrockgeo.js, plain arrays a module worker can make: frrockworker.js, main.js)
/* the jibs' rock slabs (a block of rock, its flat top along the top line, its sides down into the snow, a little
   uneven), as plain arrays for frrockgeo.js, which puts them in the rock mesh after the faces */
export function slabArrays(land) {
  const G = land.G, out = [];
  for (const rl of land.jibs || []) {
    if (rl.look !== 'slab') continue;
    const a = rl.P[0], b = rl.P[1], t = b.clone().sub(a), L = t.length(); t.normalize();
    const sx = -t.z, sz = t.x, sl = Math.hypot(sx, sz), hw = rl.w / 2, segs = Math.max(2, Math.round(L / 0.8)), cols = [-hw - 0.35, -hw, hw, hw + 0.35];
    const P = [], I = [];
    for (let k = 0; k <= segs; k++) {
      const c = a.clone().addScaledVector(t, L * k / segs);
      for (let j = 0; j < 4; j++) {
        const edge = j === 0 || j === 3, x = c.x + sx / sl * cols[j], z = c.z + sz / sl * cols[j];
        P.push(x, edge ? G(x, z) - 0.4 : c.y - (k === 0 || k === segs ? 0.05 : 0) + 0.03 * Math.sin(k * 2.1 + j), z);
      }
    }
    for (let k = 0; k < segs; k++) for (let j = 0; j < 3; j++) { const A = k * 4 + j, B = A + 1, C = A + 4, D = C + 1; I.push(A, B, C, B, D, C); }
    I.push(0, 3, 1, 1, 3, 2); { const A = segs * 4; I.push(A, A + 1, A + 3, A + 1, A + 2, A + 3); }
    const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); tg.setIndex(I); tg.computeVertexNormals();
    out.push({ P: new Float64Array(P), N: tg.attributes.normal.array.slice(), I });
    tg.dispose();
  }
  return out;
}
/* the rock faces (frrockgeo.js rockArrays: the curtains, worked out by a worker while the page builds the rest, or here
   when none came: pre) into one rock mesh and one snow mesh */
export function buildRock(scene, land, mats, q, pre = null) {
  const low = q.tier === 'low';
  const R = pre || rockArrays(land, low, slabArrays(land));
  const mesh = (A, snow) => {
    if (!A) return null;
    const g = new THREE.BufferGeometry(), n = A.p.length / 3;
    g.setAttribute('position', new THREE.BufferAttribute(A.p, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(A.n, 3));
    if (!snow) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    if (snow) { g.setAttribute('aGroom', new THREE.BufferAttribute(new Float32Array(n), 1)); g.setAttribute('aDye', new THREE.BufferAttribute(new Float32Array(n), 1)); }
    g.setIndex(new THREE.BufferAttribute(A.i, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  };
  const group = new THREE.Group(); group.name = 'freeride rock';
  const rockM = rockMaterial(q);
  let tris = 0;
  ZONES.forEach((name, zi) => {
    const rg = mesh(R.rock, false), sg = mesh(R.snow, true);
    if (rg) { const m = new THREE.Mesh(rg, rockM); m.name = 'rock ' + name; m.receiveShadow = true; m.castShadow = !low; m.matrixAutoUpdate = false; group.add(m); tris += rg.index.count / 3; }
    if (sg) { const m = new THREE.Mesh(sg, mats.snow); m.name = 'rock snow ' + name; m.receiveShadow = true; m.matrixAutoUpdate = false; group.add(m); tris += sg.index.count / 3; }
  });
  scene.add(group); group.updateMatrixWorld(true);
  group.userData = { elements: R.elements, rows: R.rows, tris, dropped: R.dropped };
  if (R.cover) land.cover = R.cover;
  return group;
}
// ---- the jibs: logs, the rock slab, stumps; and the start flags and the finish arch ---------------------------------------
export function buildJibs(scene, fr, mats, q) {
  const G = fr.land.G, P = [], N = [], C = [], I = [];
  const v = (x, y, z, nx, ny, nz, c) => { P.push(x, y, z); N.push(nx, ny, nz); C.push(c[0], c[1], c[2]); return P.length / 3 - 1; };
  const lin = h => { const c = new THREE.Color(h).convertSRGBToLinear(); return [c.r, c.g, c.b]; };
  const BARK = lin(0x4a3524), BARK2 = lin(0x2e2017), WOOD = lin(0xb08a5e), SNOW = [0.86, 0.89, 0.93], ORANGE = lin(0xff6a13), POLE = lin(0x24272c);
  const r = rng(77);
  // a cylinder along a -> b (radius rad, n sides), bark with its top dusted with snow, wooden ends
  const cyl = (a, b, rad, n, caps, snowTop = true) => {
    const t = b.clone().sub(a), L = t.length(); t.normalize();
    const up = Math.abs(t.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const s = new THREE.Vector3().crossVectors(t, up).normalize(), u = new THREE.Vector3().crossVectors(s, t).normalize();
    const segs = Math.max(1, Math.round(L / 1.2)), rings = [];
    for (let k = 0; k <= segs; k++) {
      const c = a.clone().addScaledVector(t, L * k / segs), ring = [];
      for (let j = 0; j <= n; j++) {
        const ang = j / n * Math.PI * 2, d = u.clone().multiplyScalar(Math.cos(ang)).addScaledVector(s, Math.sin(ang));
        const rr = rad * (1 + 0.06 * Math.sin(ang * 3 + k) + 0.03 * (r() - 0.5));
        const top = snowTop && d.y > 0.55 && r() < 0.7;
        const col = top ? SNOW : r() < 0.4 ? BARK2 : BARK;
        ring.push(v(c.x + d.x * rr, c.y + d.y * rr, c.z + d.z * rr, d.x, d.y, d.z, col));
      }
      rings.push(ring);
    }
    for (let k = 0; k < segs; k++) for (let j = 0; j < n; j++) { const A = rings[k][j], B = rings[k][j + 1], Cc = rings[k + 1][j], D = rings[k + 1][j + 1]; I.push(A, Cc, B, B, Cc, D); }
    if (caps) for (const [c, sg] of [[a, -1], [b, 1]]) {
      const m = v(c.x, c.y, c.z, t.x * sg, t.y * sg, t.z * sg, WOOD), ring = [];
      for (let j = 0; j <= n; j++) { const ang = j / n * Math.PI * 2, d = u.clone().multiplyScalar(Math.cos(ang)).addScaledVector(s, Math.sin(ang)); ring.push(v(c.x + d.x * rad, c.y + d.y * rad, c.z + d.z * rad, t.x * sg, t.y * sg, t.z * sg, WOOD)); }
      for (let j = 0; j < n; j++) { if (sg > 0) I.push(m, ring[j], ring[j + 1]); else I.push(m, ring[j + 1], ring[j]); }
    }
  };
  for (const rl of fr.rails) {
    if (rl.look === 'log') {
      const a = rl.P[0].clone(), b = rl.P[rl.P.length - 1].clone(), rad = rl.w / 2;
      // its axis a radius under the top line
      a.y -= rad; b.y -= rad;
      cyl(a, b, rad, 12, true);
      // a few stubs of branches, and where it lies on the snow a little snow heaped against it
      for (let k = 1; k < 4; k++) { const p = a.clone().lerp(b, k / 4 + (r() - 0.5) * 0.1), sd = r() < 0.5 ? -1 : 1; cyl(p, p.clone().add(new THREE.Vector3(sd * 0.45, 0.12, 0.1)), 0.05, 5, false, false); }
    } else if (rl.look === 'stump') {
      const top = rl.P[0].clone().lerp(rl.P[1], 0.5), rad = rl.w / 2, y0 = G(top.x, top.z) - 0.3;
      cyl(new THREE.Vector3(top.x, y0, top.z), new THREE.Vector3(top.x, top.y, top.z), rad, 14, true, false);
    }
  }
  // the start flags: a pair of orange-topped poles either side of each start on the summit ridge
  const pole = (x, z, hgt) => {
    const y = G(x, z);
    cyl(new THREE.Vector3(x, y - 0.3, z), new THREE.Vector3(x, y + hgt, z), 0.035, 5, false, false);
    const b = v(x, y + hgt - 0.05, z, 0, 0, 1, ORANGE), c = v(x + 0.65, y + hgt - 0.25, z, 0, 0, 1, ORANGE), d = v(x, y + hgt - 0.5, z, 0, 0, 1, ORANGE);
    I.push(b, d, c, b, c, d);
  };
  // (2026-11-10: the Peak's lines too, each with a sign beside its flags: below)
  const lineTops = fr.park.starts.filter(st => /^(Summit|Peak):/.test(st.name));
  // (the sign beside the flags, east of them, on two posts of its own: across the way in, riders and the camera behind
  // them would pass through it)
  const signAt = st => { const sx = st.x + 6.2, zs = st.z + 4, hw = 1.7; return { sx, zs, hw, hh: 0.23, y: Math.max(G(sx - hw, zs), G(sx + hw, zs)) + 1.2 }; };
  for (const st of lineTops) {
    pole(st.x - 2.4, st.z + 4, 2.2); pole(st.x + 2.4, st.z + 4, 2.2);
    const s = signAt(st);
    for (const px of [s.sx - s.hw + 0.15, s.sx + s.hw - 0.15]) cyl(new THREE.Vector3(px, G(px, s.zs) - 0.3, s.zs + 0.05), new THREE.Vector3(px, s.y + s.hh, s.zs + 0.05), 0.045, 5, false, false);
  }
  // the finish: two posts and a banner across the corral's top
  const fz = 700, fy = Math.max(G(-10, fz), G(10, fz));
  for (const x of [-10, 10]) cyl(new THREE.Vector3(x, G(x, fz) - 0.4, fz), new THREE.Vector3(x, fy + 5.6, fz), 0.18, 8, true, false);
  const group = new THREE.Group(); group.name = 'freeride jibs';
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setIndex(P.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(I, 1) : new THREE.Uint16BufferAttribute(I, 1)); g.computeBoundingSphere();
  const wood = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, side: THREE.DoubleSide });
  wood.onBeforeCompile = s => { s.uniforms.uNight = snowUniforms.uNight; s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
uniform float uNight;`).replace('#include <opaque_fragment>', `outgoingLight -= (reflectedLight.directDiffuse + reflectedLight.directSpecular) * uNight * 0.7;
#include <opaque_fragment>`); };
  wood.customProgramCacheKey = () => 'frwood';
  const m = new THREE.Mesh(g, wood); m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false; m.name = 'freeride logs'; group.add(m);
  // the finish banner
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 128; const bx = cv.getContext('2d');
  bx.fillStyle = '#0d1b2a'; bx.fillRect(0, 0, 1024, 128); bx.fillStyle = '#ff6a13'; bx.fillRect(0, 108, 1024, 20);
  bx.font = 'italic 800 84px "Barlow Condensed", Arial Narrow, sans-serif'; bx.fillStyle = '#fff'; bx.textAlign = 'center'; bx.fillText('FREERIDE  FINISH', 512, 92);
  const bt = new THREE.CanvasTexture(cv); bt.colorSpace = THREE.SRGBColorSpace;
  const bn = new THREE.Mesh(new THREE.BoxGeometry(20.5, 2.2, 0.2), new THREE.MeshStandardMaterial({ map: bt, roughness: 0.8 }));
  bn.position.set(0, fy + 4.6, fz); bn.castShadow = !(q.tier === 'low'); bn.name = 'finish banner'; bn.updateMatrix(); bn.matrixAutoUpdate = false; group.add(bn);
  /* (2026-11-10, for Leon's "unique lines which one could ride and pick a new line each time they drop") a sign at each
     line's top, beside its flags, with the line's name: on two posts, facing up the hill to the riders coming to it, its
     back the same the right way round. All the names in one canvas, all the signs one mesh */
  if (lineTops.length) {
    const names = lineTops.map(st => st.name.replace(/^(Summit|Peak):\s*(the\s+)?/i, '').replace(/\s*\(.*\)\s*$/, '').toUpperCase());
    const rowsN = Math.ceil(names.length / 2), cv = document.createElement('canvas'); cv.width = 1024; cv.height = 64 * Math.max(1, rowsN);
    const cx = cv.getContext('2d');
    names.forEach((nm, i) => {
      const x0 = (i % 2) * 512, y0 = Math.floor(i / 2) * 64;
      cx.fillStyle = '#0d1b2a'; cx.fillRect(x0, y0, 512, 64); cx.fillStyle = '#ff6a13'; cx.fillRect(x0, y0 + 56, 512, 8);
      let fs = 46; cx.font = `italic 800 ${fs}px "Barlow Condensed", Arial Narrow, sans-serif`;
      while (cx.measureText(nm).width > 480 && fs > 24) { fs -= 2; cx.font = `italic 800 ${fs}px "Barlow Condensed", Arial Narrow, sans-serif`; }
      cx.fillStyle = '#fff'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(nm, x0 + 256, y0 + 30);
    });
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const SP = [], SU = [], SN = [], SI = [];
    lineTops.forEach((st, i) => {
      const u0 = (i % 2) * 0.5, u1 = u0 + 0.5, v1 = 1 - Math.floor(i / 2) / rowsN, v0 = v1 - 1 / rowsN;
      const { sx, zs, hw, hh, y } = signAt(st);
      // (front, facing -z, up the hill: read from above; back, facing +z, mirrored so it reads the right way round too)
      for (const [nz, dz, flip] of [[-1, -0.02, false], [1, 0.02, true]]) {
        const b = SP.length / 3;
        SP.push(sx - hw, y - hh, zs + dz, sx + hw, y - hh, zs + dz, sx + hw, y + hh, zs + dz, sx - hw, y + hh, zs + dz);
        // (from -z, the sign's left is +x)
        const ua = flip ? u0 : u1, ub = flip ? u1 : u0;
        SU.push(ua, v0, ub, v0, ub, v1, ua, v1);
        for (let k = 0; k < 4; k++) SN.push(0, 0, nz);
        if (nz < 0) SI.push(b, b + 2, b + 1, b, b + 3, b + 2); else SI.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
    });
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(SP, 3)); sg.setAttribute('uv', new THREE.Float32BufferAttribute(SU, 2)); sg.setAttribute('normal', new THREE.Float32BufferAttribute(SN, 3)); sg.setIndex(SI);
    sg.computeBoundingSphere();
    const sm = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 })); sm.name = 'line signs'; sm.matrixAutoUpdate = false; sm.updateMatrix(); group.add(sm);
  }
  scene.add(group); group.updateMatrixWorld(true);
  return group;
}
