// Sky, sun and the mountain around the park: a physical sky, the sun's light and shadow following the rider, a
// reflection map from the sky, conifers (detailed near, flat cards far), the far ranges, a chairlift, park
// fencing, flags and the start arch.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { height, ground, runHalf, baseLine, normal } from './terrain.js?v=5';
import { fbm, ridged, rng, smoothstep } from './noise.js?v=5';
import { snowUniforms } from './materials.js?v=5';

export function makeSky(scene, renderer, q, wide) {
  const sky = new Sky(); sky.scale.setScalar(45000); sky.name = 'sky';
  const u = sky.material.uniforms;
  u.turbidity.value = 3.2; u.rayleigh.value = 1.1; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 30), THREE.MathUtils.degToRad(118));
  u.sunPosition.value.copy(sunDir);
  scene.add(sky);
  snowUniforms.uSunDir.value.copy(sunDir);
  // the sun: warm, with a shadow box that follows the rider
  const sun = new THREE.DirectionalLight(0xfff1df, 3.1);
  sun.position.copy(sunDir).multiplyScalar(120);
  const shadowRes = q.tier === 'low' ? 1024 : 2048, box = q.tier === 'low' ? 26 : 34;
  sun.castShadow = q.shadows;
  sun.shadow.mapSize.set(shadowRes, shadowRes);
  Object.assign(sun.shadow.camera, { left: -box, right: box, top: box, bottom: -box, near: 1, far: 300 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  // sky light: blue from above, bright bounce off the snow from below
  const hemi = new THREE.HemisphereLight(0xa9c8ef, 0xf2f4f6, 1.05);
  scene.add(hemi);
  // reflections of the sky for helmets, goggles and rails
  const pm = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene(); const sky2 = new Sky(); sky2.scale.setScalar(1000); sky2.material.uniforms.sunPosition.value.copy(sunDir);
  for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) sky2.material.uniforms[k].value = u[k].value;
  envScene.add(sky2);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(900, 24), new THREE.MeshBasicMaterial({ color: 0xdfe6ee })); floor.rotation.x = -Math.PI / 2; floor.position.y = -20; envScene.add(floor);
  const env = pm.fromScene(envScene, 0.02, 1, 2000).texture;
  scene.environment = env; scene.environmentIntensity = 0.55;
  pm.dispose();
  const fogCol = new THREE.Color(0xc6d7e8);
  scene.fog = new THREE.FogExp2(fogCol, wide ? (q.tier === 'low' ? 0.00016 : 0.00011) : q.tier === 'low' ? 0.00042 : 0.00028);
  return {
    sky, sun, hemi, sunDir,
    follow(p) { sun.position.copy(p).addScaledVector(sunDir, 120); sun.updateMatrixWorld(); sun.target.position.copy(p); sun.target.updateMatrixWorld(); sky.position.copy(p); sky.updateMatrixWorld(); },
  };
}

// ---- trees ----------------------------------------------------------------------------------------------------------
function coniferGeometry(r) {
  // tiers of drooping, ragged cones, snow lying on their upper faces (vertex colours)
  const parts = [];
  const tiers = 9;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers, y0 = 0.1 + t * 0.8, rad = 0.34 * (1 - t * 0.85) * (0.9 + r() * 0.2) + 0.03, h = 0.22 * (1 - t * 0.35);
    const seg = 11;
    const g = new THREE.ConeGeometry(rad, h, seg, 1, true);
    const pos = g.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      if (pos.getY(k) < 0) { const a = Math.atan2(pos.getZ(k), pos.getX(k)); const j = 1 + (r() - 0.5) * 0.6; pos.setX(k, Math.cos(a) * rad * j); pos.setZ(k, Math.sin(a) * rad * j); pos.setY(k, pos.getY(k) - r() * 0.07 - (j - 1) * 0.05); }
    }
    g.translate(0, y0 + h / 2, 0); g.rotateY(r() * 6);
    parts.push(g);
  }
  const trunk = new THREE.CylinderGeometry(0.018, 0.03, 0.3, 5); trunk.translate(0, 0.15, 0); parts.push(trunk);
  let n = 0; for (const g of parts) n += g.index ? g.index.count : g.attributes.position.count;
  const pos = [], col = [];
  const green = new THREE.Color(0x1f3a28), dark = new THREE.Color(0x10201a), snow = new THREE.Color(0xeef3f8), bark = new THREE.Color(0x3a2a1e);
  parts.forEach((g, gi) => {
    const ng = g.toNonIndexed(); ng.computeVertexNormals();
    const p = ng.attributes.position, nn = ng.attributes.normal;
    for (let k = 0; k < p.count; k++) {
      pos.push(p.getX(k), p.getY(k), p.getZ(k));
      const isTrunk = gi === parts.length - 1;
      let c = isTrunk ? bark : green.clone().lerp(dark, r() * 0.6);
      // snow lies in patches on the branches' tops; the tips and the rest stay dark green
      if (!isTrunk) { const up = nn.getY(k), tip = p.getY(k) < (gi + 0.5) / parts.length - 0.02 ? 1 : 0; const lay = r() < 0.6 && up > 0.45 ? smoothstep(0.45, 0.8, up) : 0; c = c.clone().lerp(snow, lay * (0.85 - tip * 0.35)); }
      col.push(c.r, c.g, c.b);
    }
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.computeVertexNormals();
  return out;
}
function cardTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256; const x = c.getContext('2d');
  const r = rng(11);
  for (let i = 0; i < 9; i++) {
    const t = i / 9, y = 240 - (0.12 + t * 0.78) * 230, w = 52 * (1 - t * 0.82) + 4;
    x.fillStyle = '#1a2e21'; x.beginPath(); x.moveTo(64 - w, y); x.lineTo(64, y - 46); x.lineTo(64 + w, y); x.closePath(); x.fill();
    x.fillStyle = 'rgba(232,238,245,0.85)'; x.beginPath(); x.moveTo(64 - w * 0.7, y - 10); x.lineTo(64, y - 44); x.lineTo(64 + w * 0.5, y - 14); x.closePath(); x.fill();
    for (let k = 0; k < 6; k++) { x.fillStyle = r() < 0.5 ? '#15261b' : '#e6ecf3'; x.fillRect(64 - w + r() * w * 2, y - r() * 30, 3, 3); }
  }
  x.fillStyle = '#3a2a1e'; x.fillRect(61, 230, 6, 26);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export class Forest {
  constructor(scene, q, mtn) {
    const r = rng(5);
    this.trees = [];
    const max = q.tier === 'low' ? 2600 : q.tier === 'medium' ? 5000 : 8000;
    // on a real mountain: below the treeline, thinning as it nears, on ground not too steep
    if (mtn) for (let tries = 0; this.trees.length < max && tries < max * 12; tries++) {
      const a = r() * Math.PI * 2, d = 30 + Math.sqrt(r()) * 2600, x = Math.cos(a) * d, z = Math.sin(a) * d;
      const y = height(x, z), line = mtn.spot.treeline + 60 * fbm(x * 0.004, z * 0.004, 2);
      if (y > line || r() < smoothstep(line - 150, line, y) * 0.9) continue;
      if (fbm(x * 0.01 + 3, z * 0.01, 3) < -0.15) continue;
      const n = normal(x, z); if (n.y < 0.8) continue;
      this.trees.push({ x, y: y - 0.3, z, s: 6 + r() * 11, rot: r() * 6.28 });
    }
    // scattered in clumps beside the run and up the valley sides
    if (!mtn) for (let tries = 0; this.trees.length < max && tries < max * 8; tries++) {
      const z = -300 + r() * 1900, side = r() < 0.5 ? -1 : 1;
      const d = 4 + Math.pow(r(), 1.6) * 360;
      const x = side * (runHalf(z) + d);
      const clump = fbm(x * 0.012, z * 0.012, 3);
      if (clump < -0.05 + d * 0.0008) continue;
      const n = normal(x, z); if (n.y < 0.8) continue;
      if (ground(x, z) - baseLine(z) > 140) continue;
      const s = 6 + r() * 10 + (d < 30 ? 0 : r() * 6);
      this.trees.push({ x, y: height(x, z) - 0.3, z, s, rot: r() * 6.28 });
    }
    // a grid of the trees for collisions (8 m cells)
    this.grid = new Map();
    for (const t of this.trees) { const k = Math.floor(t.x / 8) + ',' + Math.floor(t.z / 8); if (!this.grid.has(k)) this.grid.set(k, []); this.grid.get(k).push(t); }
    const near = q.tier === 'low' ? 260 : 520;
    this.geo = coniferGeometry(r);
    const tm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, side: THREE.DoubleSide });
    // the undersides of the branches are in their own shade
    tm.onBeforeCompile = s => { s.fragmentShader = s.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
 if (!gl_FrontFacing) diffuseColor.rgb = vec3(0.045, 0.075, 0.055);`); };
    tm.customProgramCacheKey = () => 'conifer';
    this.near = new THREE.InstancedMesh(this.geo, tm, near);
    this.near.castShadow = q.tier !== 'low'; this.near.receiveShadow = true; this.near.frustumCulled = false;
    const card = new THREE.PlaneGeometry(1, 1); card.translate(0, 0.5, 0);
    const card2 = card.clone().rotateY(Math.PI / 2);
    const cards = new THREE.BufferGeometry();
    const cp = [...card.toNonIndexed().attributes.position.array, ...card2.toNonIndexed().attributes.position.array];
    const cu = [...card.toNonIndexed().attributes.uv.array, ...card2.toNonIndexed().attributes.uv.array];
    cards.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3)); cards.setAttribute('uv', new THREE.Float32BufferAttribute(cu, 2));
    cards.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(cp.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    this.far = new THREE.InstancedMesh(cards, new THREE.MeshLambertMaterial({ map: cardTexture(), alphaTest: 0.5, side: THREE.DoubleSide }), this.trees.length);
    this.far.frustumCulled = false;
    scene.add(this.near, this.far);
    this.at = new THREE.Vector3(1e9, 0, 0); this.nearR = q.tier === 'low' ? 70 : 110;
    this.m = new THREE.Matrix4(); this.qq = new THREE.Quaternion(); this.sc = new THREE.Vector3(); this.pp = new THREE.Vector3();
  }
  update(cam) {
    if (cam.distanceTo(this.at) < 15) return;
    this.at.copy(cam);
    let ni = 0, fi = 0;
    const R2 = this.nearR * this.nearR, nMax = this.near.count;
    this.near.count = nMax;
    for (const t of this.trees) {
      const d2 = (t.x - cam.x) ** 2 + (t.z - cam.z) ** 2;
      this.qq.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, t.rot); this.pp.set(t.x, t.y, t.z);
      if (d2 < R2 && ni < this.nearCap()) {
        this.sc.set(t.s * 0.9, t.s, t.s * 0.9); this.m.compose(this.pp, this.qq, this.sc); this.near.setMatrixAt(ni++, this.m);
      } else {
        this.sc.set(t.s * 0.75, t.s, t.s * 0.75); this.m.compose(this.pp, this.qq, this.sc); this.far.setMatrixAt(fi++, this.m);
      }
    }
    this.near.count = ni; this.far.count = fi;
    this.near.instanceMatrix.needsUpdate = true; this.far.instanceMatrix.needsUpdate = true;
  }
  nearCap() { return this.near.instanceMatrix.count; }
  // the tree whose trunk (and lower branches) a body of radius r at x, z touches, or null
  hit(x, z, r) {
    const cx = Math.floor(x / 8), cz = Math.floor(z / 8);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const l = this.grid.get((cx + i) + ',' + (cz + j)); if (!l) continue;
      for (const t of l) { const d = Math.hypot(t.x - x, t.z - z), R = 0.18 + t.s * 0.035 + r; if (d < R) return { t, d, R, nx: (x - t.x) / (d || 1), nz: (z - t.z) / (d || 1) }; }
    }
    return null;
  }
}

// ---- the far ranges ------------------------------------------------------------------------------------------------
// the horizon round a real mountain: the coarse elevation grid as one mesh, sunk under the fine terrain near the start
export function makeMountainRanges(scene, q, mtn) {
  const e = mtn.farExtent(), N = q.tier === 'low' ? 140 : 220;
  const pos = [], col = [], idx = [];
  const fe = mtn.ext, inFine = (x, z, m) => x > fe.x0 + m && x < fe.x1 - m && z > fe.z0 + m && z < fe.z1 - m;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const x = e.x0 + (e.x1 - e.x0) * i / N, z = e.z0 + (e.z1 - e.z0) * j / N;
    let y = mtn.farAt(x, z); if (inFine(x, z, 150)) y -= 40;
    pos.push(x, y, z);
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const nn = g.attributes.normal, snow = new THREE.Color(0xf2f5f9), rockC = new THREE.Color(0x5b5d62), forestC = new THREE.Color(0x26392d);
  for (let k = 0; k < nn.count; k++) {
    const ny = nn.getY(k), y = pos[k * 3 + 1], x = pos[k * 3], z = pos[k * 3 + 2], n = fbm(x * 0.003, z * 0.003, 2);
    const c = snow.clone().lerp(rockC, smoothstep(0.7, 0.45, ny + n * 0.1) * 0.85);
    const line = mtn.spot.treeline;
    if (y < line) c.lerp(forestC, smoothstep(line, line - 200, y + n * 80) * 0.8 * smoothstep(0.6, 0.85, ny));
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  m.name = 'ranges'; m.matrixAutoUpdate = false; scene.add(m);
  return m;
}

export function makeRanges(scene, q, snowMat) {
  const segA = q.tier === 'low' ? 160 : 280, segR = q.tier === 'low' ? 18 : 32;
  const pos = [], col = [], idx = [];
  const cx = 0, cz = 700, r0 = 2100, r1 = 11000;
  for (let j = 0; j <= segR; j++) for (let i = 0; i <= segA; i++) {
    const a = i / segA * Math.PI * 2, t = j / segR, r = r0 + (r1 - r0) * Math.pow(t, 1.7);
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    // broad massifs with sharper summits: a smooth base and a ridged top
    const base = 0.5 + 0.5 * fbm(x * 0.00018 + 9, z * 0.00018, 3);
    const peak = Math.pow(ridged(x * 0.00036 + 5, z * 0.00036, 4), 1.6);
    const h = baseLine(Math.max(-900, Math.min(2600, z))) * 0.3 + 150 + base * 700 + peak * (650 + 500 * smoothstep(0.05, 0.6, t)) - smoothstep(0.85, 1, t) * 600;
    pos.push(x, h, z);
  }
  for (let j = 0; j < segR; j++) for (let i = 0; i < segA; i++) { const a = j * (segA + 1) + i, b = a + 1, c = a + segA + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const nn = g.attributes.normal;
  const snow = new THREE.Color(0xf2f5f9), rockC = new THREE.Color(0x5b5d62), forestC = new THREE.Color(0x2a3d31);
  for (let k = 0; k < nn.count; k++) {
    const ny = nn.getY(k), y = pos[k * 3 + 1], x = pos[k * 3], z = pos[k * 3 + 2];
    const n = fbm(x * 0.004, z * 0.004, 2);
    const rock = smoothstep(0.66, 0.42, ny + n * 0.12);
    const c = snow.clone().lerp(rockC, rock * 0.85);
    if (y < 330) c.lerp(forestC, smoothstep(330, 160, y + n * 60) * 0.75);
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  m.name = 'ranges'; m.matrixAutoUpdate = false; scene.add(m);
  return m;
}

// ---- lift, fences, flags, the start arch ----------------------------------------------------------------------------
export function makeProps(scene, park, q) {
  const group = new THREE.Group(); group.name = 'props';
  const M = {
    steel: new THREE.MeshStandardMaterial({ color: 0x8b9096, metalness: 0.7, roughness: 0.45 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.6 }),
    orange: new THREE.MeshStandardMaterial({ color: 0xff6a13, roughness: 0.75, side: THREE.DoubleSide }),
  };
  // everything of one material goes into one mesh
  const buckets = { steel: [], dark: [], orange: [] };
  const _m = new THREE.Matrix4(), _e = new THREE.Euler();
  const add = (geo, key, x, y, z, ry = 0, rx = 0) => {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone());
    g.deleteAttribute('uv');
    g.applyMatrix4(_m.makeRotationFromEuler(_e.set(rx, ry, 0)).setPosition(x, y, z));
    buckets[key].push(g);
  };
  // chairlift up the right side of the run
  const lx = 64, towers = [];
  for (let z = 1400; z >= -60; z -= 85) {
    const y = height(lx, z);
    add(new THREE.CylinderGeometry(0.35, 0.45, 12, 8), 'steel', lx, y + 6, z);
    add(new THREE.BoxGeometry(5.2, 0.4, 0.5), 'steel', lx, y + 12, z);
    towers.push(new THREE.Vector3(lx, y + 11.6, z));
  }
  const cable = [];
  for (const sx of [-2.4, 2.4]) for (let i = 0; i < towers.length - 1; i++) {
    const a = towers[i].clone(), b = towers[i + 1].clone(); a.x += sx; b.x += sx;
    for (let k = 0; k < 8; k++) { const t0 = k / 8, t1 = (k + 1) / 8; const p0 = a.clone().lerp(b, t0), p1 = a.clone().lerp(b, t1); p0.y -= Math.sin(Math.PI * t0) * 1.2; p1.y -= Math.sin(Math.PI * t1) * 1.2; cable.push(p0, p1); }
  }
  group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(cable), new THREE.LineBasicMaterial({ color: 0x2a2d31 })));
  const chairG = new THREE.BoxGeometry(1.6, 0.12, 0.6), backG = new THREE.BoxGeometry(1.6, 0.7, 0.08), hangG = new THREE.CylinderGeometry(0.03, 0.03, 2.2, 4);
  for (const sx of [-2.4, 2.4]) for (let i = 0; i < towers.length - 1; i++) for (let k = 1; k < 4; k++) {
    const p = towers[i].clone().lerp(towers[i + 1], k / 4); p.x += sx; p.y -= Math.sin(Math.PI * k / 4) * 1.2;
    add(hangG, 'steel', p.x, p.y - 1.1, p.z); add(chairG, 'dark', p.x, p.y - 2.2, p.z); add(backG, 'dark', p.x, p.y - 1.85, p.z - 0.28);
  }
  // the start arch
  const sy = height(0, -20);
  add(new THREE.BoxGeometry(0.5, 6, 0.5), 'dark', -9, sy + 3, -20); add(new THREE.BoxGeometry(0.5, 6, 0.5), 'dark', 9, sy + 3, -20);
  const banner = document.createElement('canvas'); banner.width = 1024; banner.height = 128; const bx = banner.getContext('2d');
  bx.fillStyle = '#0d1b2a'; bx.fillRect(0, 0, 1024, 128); bx.fillStyle = '#ff6a13'; bx.fillRect(0, 108, 1024, 20);
  bx.font = 'italic 800 84px "Barlow Condensed", Arial Narrow, sans-serif'; bx.fillStyle = '#fff'; bx.textAlign = 'center'; bx.fillText('LEON FREESKI  PARK', 512, 92);
  const bt = new THREE.CanvasTexture(banner); bt.colorSpace = THREE.SRGBColorSpace;
  const bn = new THREE.Mesh(new THREE.BoxGeometry(18.5, 2.2, 0.2), new THREE.MeshStandardMaterial({ map: bt, roughness: 0.8 })); bn.position.set(0, sy + 5.6, -20); bn.castShadow = true; group.add(bn);
  // orange fences beside the jump line and the pipe
  const postG = new THREE.CylinderGeometry(0.04, 0.04, 1.3, 5);
  const fence = (x0, z0, x1, z1) => {
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.round(L / 3));
    const pts = [];
    for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * i / n, z = z0 + (z1 - z0) * i / n, y = height(x, z); add(postG, 'dark', x, y + 0.6, z); pts.push(new THREE.Vector3(x, y + 1.05, z), new THREE.Vector3(x, y + 0.5, z)); }
    const tri = [];
    for (let i = 0; i < n; i++) { const a = pts[i * 2], b = pts[i * 2 + 2], c = pts[i * 2 + 1], d = pts[i * 2 + 3]; tri.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry().setFromPoints(tri); g.computeVertexNormals(); buckets.orange.push(g);
  };
  fence(-30, 40, -30, 330); fence(-2.5, 60, -2.5, 320);
  const pp = park.pipe, px = pp.F + pp.R + pp.deck + 9;
  fence(pp.x - px, pp.z0, pp.x - px, pp.z1); fence(pp.x + px, pp.z0, pp.x + px, pp.z1);
  // flags on the knuckles
  const flagG = new THREE.PlaneGeometry(0.7, 0.45), poleG = new THREE.CylinderGeometry(0.025, 0.025, 2.2, 5);
  for (const k of park.kickers) for (const s of [-1, 1]) {
    const x = k.x + s * (k.wD + 1.2), z = k.K.z, y = height(x, z);
    add(poleG, 'dark', x, y + 1.1, z); add(flagG, 'orange', x + 0.36, y + 1.95, z);
  }
  for (const key in buckets) {
    if (!buckets[key].length) continue;
    const g = mergeGeometries(buckets[key], false); if (!g) continue;
    const m = new THREE.Mesh(g, M[key]); m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false; group.add(m);
  }
  scene.add(group);
  return group;
}
