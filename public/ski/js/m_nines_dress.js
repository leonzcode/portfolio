/* (N, round 12) The Nines map's surroundings and event structures, drawn in code (no model or picture of anyone else's):
   - the skyline: the far elevation grid as one mesh out to 20 km (the Jungfrau, Eiger and Moench, the Lauterbrunnen wall,
     the Bluemlisalp), snow where it can lie, rock where it is steep, forest below the treeline, in the air's haze;
   - the Schilthorn's summit buildings and the Birg station as plain masses in their colours, and the Birg to Schilthorn
     cableway's track ropes and a cabin over the venue;
   - the event's own: banners (white with plain words of our own, no marks), fences, flag poles, the riders' village's
     tents, the start hut, parked snowcats and excavators as simple shapes.
   Everything that never moves is merged by material: a handful of draw calls. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { smoothstep, fbm } from './noise.js?v=33';
import { snowUniforms } from './materials.js?v=33';

// ---- a merging kit: shapes go into buckets by material, each bucket one mesh ---------------------------------------
export class Kit {
  constructor() { this.b = new Map(); this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3(); }
  add(key, g, x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
    const t = (g.index ? g.toNonIndexed() : g.clone());
    for (const k of Object.keys(t.attributes)) if (k !== 'position' && k !== 'normal') t.deleteAttribute(k);
    this._q.setFromEuler(this._e.set(rx, ry, rz, 'YXZ'));
    t.applyMatrix4(this._m.compose(this._p.set(x, y, z), this._q, this._s.set(sx, sy, sz)));
    if (!this.b.has(key)) this.b.set(key, []);
    this.b.get(key).push(t);
    return t;
  }
  // a box from its foot's middle (w across x, h up, d along z) turned by ry
  box(key, x, y, z, w, h, d, ry = 0) { return this.add(key, BOX, x, y + h / 2, z, ry, w, h, d); }
  cyl(key, x, y, z, r, h, n = 10, ry = 0) { return this.add(key, cylG(n), x, y + h / 2, z, ry, r, h, r); }
  // a pole between two points (radius r)
  pole(key, a, b, r, n = 6) {
    const d = new THREE.Vector3().subVectors(b, a), L = d.length(), g = cylG(n).clone();
    g.scale(r, L, r); g.translate(0, L / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())); g.translate(a.x, a.y, a.z);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    const t = g.index ? g.toNonIndexed() : g;
    if (!this.b.has(key)) this.b.set(key, []);
    this.b.get(key).push(t);
  }
  build(group, mats, shadow = true) {
    for (const [key, list] of this.b) {
      const g = mergeGeometries(list, false); if (!g) continue;
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mats[key]); m.name = 'nines ' + key; m.castShadow = shadow && key !== 'glass'; m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix();
      group.add(m);
    }
  }
}
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new Map();
const cylG = n => CYL.get(n) || (CYL.set(n, new THREE.CylinderGeometry(1, 1, 1, n)), CYL.get(n));

// ---- the skyline --------------------------------------------------------------------------------------------------------
export function makeSkyline(scene, q, land) {
  const F = land.far, low = q.tier === 'low';
  const R0 = 1500, R1 = Math.min(F.x1, -F.x0, F.z1, -F.z0) - 60;
  // (about 50 m between points out to the Jungfrau, 9 km off, where the middle grid is: m_nines_land.js)
  const rings = low ? 72 : 104, segs = low ? 400 : 640;
  const P = [], K = [], I = [];
  const rad = j => R0 * Math.pow(R1 / R0, j / (rings - 1));
  for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) {
    const a = i / segs * Math.PI * 2, r = rad(j), x = Math.cos(a) * r, z = Math.sin(a) * r;
    // (sunk under the terrain's own patches near the venue, where they draw the ground)
    const sink = (1 - smoothstep(1800, 2500, r)) * 40;
    P.push(x, land.farAt(x, z) - sink, z);
  }
  for (let j = 0; j < rings - 1; j++) for (let i = 0; i < segs; i++) {
    const a = j * segs + i, b = j * segs + (i + 1) % segs, c = a + segs, d = b + segs;
    I.push(a, b, c, b, d, c);      // (wound to face up: radial x tangential pointed down)
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals();
  const nn = g.attributes.normal.array, tl = land.meta.treeline - land.y0, snowL = land.meta.snowline - land.y0;
  // (round 1 of the comparisons: the rock was near black and the valley floors a green smear; the photos' far rock is a
  // grey-brown under blue haze, the valley sides dark)
  // (second pass, review round 3: still too neutral and green; the valley sides read as streaks: darker, bluer, nearer
  // one another, so the long triangles' blends do not show)
  const SNOW = [0.9, 0.92, 0.96], ROCK = [0.13, 0.14, 0.16], WOOD = [0.04, 0.05, 0.06], MEADOW = [0.09, 0.1, 0.11];
  // (the forest and the bare valley floors are worked out per pixel too, below: as colours at the points, blended along
  // the far rings' long triangles, they showed as streaks down the valley sides; second pass)
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
  /* per pixel: each face lit by its own slope (the derivatives of the place: crisp ridges and gullies, not the smoothed
     vertex normals), rock where the face is steeper than about 36 degrees above the snow line, broken by noise into
     bands as the Jungfrau's and the Lauterbrunnen wall's faces are; and the air's haze, more the further, as the far
     snow fades (env.js's fog density), in the horizon's colour that way */
  m.onBeforeCompile = s => {
    s.uniforms.uHorizon = snowUniforms.uHorizon; s.uniforms.uNight = snowUniforms.uNight; s.uniforms.uNoise = snowUniforms.uNoise;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTW;').replace('#include <project_vertex>', '#include <project_vertex>\nvTW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uHorizon; uniform float uNight; uniform sampler2D uNoise; varying vec3 vTW; vec3 gWN;')
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  gWN = normalize(cross(dFdx(vTW), dFdy(vTW))); if (gWN.y < 0.0) gWN = -gWN;
  // (mostly the smooth normal: the faces' own slope alone showed every triangle as a facet)
  vec3 sWN = inverseTransformDirection(normalize(vNormal), viewMatrix); if (sWN.y < 0.0) sWN = -sWN;
  gWN = normalize(mix(sWN, gWN, 0.15));
  float nz = texture2D(uNoise, vTW.xz * 0.0013).b * 0.6 + texture2D(uNoise, vTW.xz * 0.0051 + 0.3).b * 0.4;
  float hi = smoothstep(${(snowL - 250).toFixed(1)}, ${(snowL + 150).toFixed(1)}, vTW.y);
  float wood = (1.0 - smoothstep(${(tl - 120).toFixed(1)}, ${(tl + 40).toFixed(1)}, vTW.y + (nz - 0.5) * 140.0)) * smoothstep(0.55, 0.8, gWN.y);
  float bare = 1.0 - smoothstep(${(snowL - 250).toFixed(1)}, ${(snowL + 50).toFixed(1)}, vTW.y + (nz - 0.5) * 160.0);
  diffuseColor.rgb = mix(mix(vec3(${SNOW.join(', ')}), vec3(${MEADOW.join(', ')}), bare * 0.8), vec3(${WOOD.join(', ')}), wood * 0.88);
  // (decided from the smooth slope with coarser noise: from the faces' own slopes the rock hung in vertical streaks)
  float rk = smoothstep(0.84, 0.7, sWN.y + (nz - 0.5) * 0.45) * hi;
  // (glaciers: the high snow on the gentler slopes lies whole over the rock, a little blue in its hollows: the saddles and
  // icefalls of the massif across the valley in 006, above about 3000 m)
  float gl = smoothstep(${(3000 - land.y0).toFixed(1)}, ${(3250 - land.y0).toFixed(1)}, vTW.y + (nz - 0.5) * 120.0) * smoothstep(0.62, 0.8, gWN.y);
  rk *= 1.0 - gl;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.84, 0.9, 0.98), gl * 0.5 * smoothstep(0.35, 0.65, nz));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${ROCK.join(', ')}) * (0.8 + 0.4 * nz), rk);
}`)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(gWN, 0.0)).xyz);')
      .replace('#include <opaque_fragment>', `outgoingLight -= reflectedLight.directDiffuse * uNight * 0.9;
outgoingLight += diffuseColor.rgb * vec3(0.12, 0.15, 0.21) * (1.0 - uNight);
#include <opaque_fragment>`)
      .replace('#include <fog_fragment>', `#ifdef USE_FOG
  float dd = length(vTW - cameraPosition), kk = fogDensity / 0.00016;
  float hz = 1.0 - exp(-dd * 0.000055 * kk);
  vec3 fdir = normalize(vTW - cameraPosition);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, texture2D(uHorizon, vec2(atan(fdir.z, fdir.x) * 0.1591549 + 0.5, 0.5)).rgb * vec3(0.76, 0.88, 1.06), clamp(hz, 0.0, 0.82));   // (the air's blue: the photos' far rock is a hazed blue, 65 109 155)
#endif`);
  };
  m.customProgramCacheKey = () => 'ninessky6';
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'nines skyline'; mesh.matrixAutoUpdate = false; mesh.frustumCulled = false; mesh.renderOrder = 1e5;
  scene.add(mesh);
  return mesh;
}

// ---- materials ------------------------------------------------------------------------------------------------------------
export function dressMats() {
  const std = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.75, metalness: 0.05 }, o));
  return {
    concrete: std(0xb9b6ae, { roughness: 0.9 }), glass: std(0x2a3540, { roughness: 0.15, metalness: 0.6 }), steel: std(0x8a8f95, { metalness: 0.7, roughness: 0.4 }),
    dark: std(0x24272c, { roughness: 0.6 }), white: std(0xf2f2ef, { roughness: 0.7, side: THREE.DoubleSide }), black: std(0x18191b, { roughness: 0.6, side: THREE.DoubleSide }),
    red: std(0xc8202a, { roughness: 0.5 }), yellow: std(0xe8b311, { roughness: 0.5 }), orange: std(0xff6a13, { roughness: 0.75, side: THREE.DoubleSide }),
    grey: std(0x4a4d52, { roughness: 0.7, side: THREE.DoubleSide }), blue: std(0x1f2f5e, { roughness: 0.7, side: THREE.DoubleSide }), wood: std(0xa8743f, { roughness: 0.85 }), shade: std(0xb3c0cf, { roughness: 0.9, side: THREE.DoubleSide }), tunnel: std(0x7a8696, { roughness: 0.95, side: THREE.DoubleSide }), rope: new THREE.LineBasicMaterial({ color: 0x2a2c30 }),
  };
}

// ---- the event's things, plain shapes (positions and sizes from the feature sheet, scratchpad ski12/N/measure) ----------
const CONE4 = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4);
const HALF = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
// a pagoda tent: w x w, walls h high, its peaked roof r high; key: the cloth's colour bucket
export function tent(kit, key, x, y, z, w, h, r, ry = 0) {
  kit.box(key, x, y, z, w, h, w, ry);
  kit.add(key, CONE4, x, y + h + r / 2, z, ry, w * 1.04, r, w * 1.04);
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const c = Math.cos(ry), s = Math.sin(ry), dx = (a * c + b * s) * w / 2, dz = (-a * s + b * c) * w / 2; kit.cyl('steel', x + dx, y, z + dz, 0.05, h, 5); }
}
// a dome tent of radius r
export function domeTent(kit, key, x, y, z, r) { kit.add(key, HALF, x, y, z, 0, r, r * 0.85, r); }
// a snowcat: its body, cab, tracks, blade and tiller, facing ry (the blade towards +z when ry is 0)
export function snowcat(kit, x, y, z, ry = 0) {
  const c = Math.cos(ry), s = Math.sin(ry), at = (u, v) => [x + u * c + v * s, z - u * s + v * c];
  for (const u of [-1.6, 1.6]) { const [px, pz] = at(u, 0); kit.box('black', px, y, pz, 0.95, 0.75, 5.0, ry); }
  { const [px, pz] = at(0, -0.2); kit.box('red', px, y + 0.7, pz, 2.4, 0.9, 4.2, ry); }
  { const [px, pz] = at(0, 0.7); kit.box('red', px, y + 1.6, pz, 2.0, 1.2, 1.9, ry); kit.box('glass', px, y + 1.75, pz, 2.05, 0.75, 1.95, ry); }
  { const [px, pz] = at(0, 3.0); kit.box('grey', px, y, pz, 5.2, 1.0, 0.35, ry); }
  { const [px, pz] = at(0, -3.4); kit.box('grey', px, y, pz, 5.6, 0.55, 1.1, ry); }
}
// an excavator on tracks: its tracks, the turning body, its cab and the arm reaching out along +z
export function excavator(kit, x, y, z, ry = 0) {
  const c = Math.cos(ry), s = Math.sin(ry), at = (u, v) => [x + u * c + v * s, z - u * s + v * c];
  for (const u of [-1.1, 1.1]) { const [px, pz] = at(u, 0); kit.box('black', px, y, pz, 0.6, 0.7, 3.4, ry); }
  { const [px, pz] = at(0, -0.3); kit.box('yellow', px, y + 0.7, pz, 2.5, 1.0, 3.0, ry); }
  { const [px, pz] = at(-0.6, 0.5); kit.box('yellow', px, y + 1.7, pz, 1.0, 1.4, 1.2, ry); kit.box('glass', px, y + 1.9, pz, 1.05, 0.9, 1.25, ry); }
  const [ax, az] = at(0.4, 1.0), [bx, bz] = at(0.4, 3.6), [ex, ez] = at(0.4, 5.2);
  kit.pole('yellow', new THREE.Vector3(ax, y + 1.6, az), new THREE.Vector3(bx, y + 3.6, bz), 0.22, 4);
  kit.pole('yellow', new THREE.Vector3(bx, y + 3.6, bz), new THREE.Vector3(ex, y + 0.6, ez), 0.16, 4);
}
// a banner: a board w x h, its foot at y, facing ry (its front towards +z when ry is 0), with words of our own
export function banner(group, text, x, y, z, w, h, ry, o = {}) {
  const cv = document.createElement('canvas'), H = 128, W = Math.max(128, Math.min(2048, Math.round(H * w / h / 64) * 64));
  cv.width = W; cv.height = H; const g = cv.getContext('2d');
  g.fillStyle = o.bg || '#f4f4f1'; g.fillRect(0, 0, W, H);
  g.fillStyle = o.fg || '#1b1d22'; g.font = `800 ${Math.round(H * 0.56)}px "Barlow Condensed", Arial Narrow, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, W / 2, H * 0.54, W * 0.92);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, side: THREE.DoubleSide }));
  m.position.set(x, y + h / 2, z); m.rotation.y = ry; m.name = 'banner ' + text; m.updateMatrix(); m.matrixAutoUpdate = false;
  group.add(m); return m;
}
// a fence of posts and a net strip between a and b (key: the net's colour bucket)
export function fence(kit, key, pts, H, h0 = 0.1, every = 2.5) {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.round(L / every));
    for (let k = 0; k <= n; k++) {
      if (k === n && i < pts.length - 2) continue;
      const t = k / n, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, y = a.y + (b.y - a.y) * t;
      kit.cyl('dark', x, y - 0.2, z, 0.025, H + 0.2, 5);
    }
    const ry = Math.atan2(b.x - a.x, b.z - a.z), g = new THREE.PlaneGeometry(L, H * 0.75).rotateY(Math.PI / 2);
    kit.add(key, g, (a.x + b.x) / 2, (a.y + b.y) / 2 + h0 + H * 0.4, (a.z + b.z) / 2, ry, 1, 1, 1, 0, 0);
  }
}
