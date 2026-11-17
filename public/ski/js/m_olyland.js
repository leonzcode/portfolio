/* (O, round 12) Genting 2022: the ground round the slopestyle course built at Genting Snow Park, Chongli, for the 2022
   Winter Games.

   The elevation is AWS Terrain Tiles' (Terrarium, open data), baked into the course's own frame by
   scratchpad ski12/O/tools/bakedem2.py: data/genting2022/dem.bin holds a near grid (20 m a sample, 5.2 km square, each
   sample the mean of four, which smooths the source's own noise) and a far grid (200 m a sample, 48 km square) for the
   skyline. data/genting2022/osm.json holds the resort's runs and lifts from OpenStreetMap (ODbL) in the same frame.

   The frame: x the rider's left, z down the course (38.5 degrees east of north, the line OpenStreetMap has for the
   course), y up, metres, the origin at the top of that line. The course itself is the run profile (terrain.js setRun,
   m_olycourse.js): 198 m down over 600 m, as the official figures have it, laid along the line and set into the hill
   (the hill round it is lifted or lowered to meet it, less the further off it is, so it sits in its slope as the real
   course does on its earthworks).

   The look of the place in early February 2022: the man-made snow on the runs and round the venues, the hills between
   them dry brown grass with snow lying in the shade and in hollows, bare larch woods (red-brown), birch groves (white
   stems), young pines planted in rows across the slopes, wind turbines on the far ridges. */
import * as THREE from 'three';
import { baseLine } from './terrain.js?v=31';
import { fbm, simplex, smoothstep, clamp, rng } from './noise.js?v=31';
import { snowUniforms } from './materials.js?v=31';

const NEAR = { X0: -2600, Z0: -2300, st: 20, n: 261 };
const FAR = { X0: -24000, Z0: -23700, st: 200, n: 241 };
export const E0 = 2100;                 // (y = elevation - E0: the course starts at 2100 m, the official start elevation)
export const GEO = { lat0: 40.954681, lon0: 115.409896, bearing: 38.51 };

// the course's corridor: where the ground is the course's own profile (m_olycourse.js sets it)
export const CORRIDOR = { z0: -70, z1: 720, half: 46, blend: 44, reach: 230 };

export class Land {
  constructor(buf, osm) {
    const nn = NEAR.n * NEAR.n, nf = FAR.n * FAR.n;
    const a = new Int16Array(buf, 0, nn), b = new Int16Array(buf, nn * 2, nf);
    this.hn = new Float32Array(nn); this.hf = new Float32Array(nf);
    for (let i = 0; i < nn; i++) this.hn[i] = a[i] / 10 + 1000 - E0;
    for (let i = 0; i < nf; i++) this.hf[i] = b[i] + 1000 - E0;
    this.osm = osm;
    this.C = 0; this.warp = null;
    this.at = this.at.bind(this);
  }
  // the bare hill: the near grid (Catmull-Rom), the far one past it (bilinear), blended over the near grid's last 600 m
  dem(x, z) {
    const fx = (x - NEAR.X0) / NEAR.st, fz = (z - NEAR.Z0) / NEAR.st, n = NEAR.n;
    const m = Math.min(fx, fz, n - 1 - fx, n - 1 - fz);
    let yn = 0;
    if (m > 1.5) {
      const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, h = this.hn;
      const cr = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
      const row = jj => { const o = jj * n; return cr(h[o + i - 1], h[o + i], h[o + i + 1], h[o + i + 2], u); };
      yn = cr(row(j - 1), row(j), row(j + 1), row(j + 2), v);
      if (m > 30) return yn;
    }
    const yf = this.far(x, z);
    return m > 1.5 ? yf + (yn - yf) * smoothstep(1.5, 30, m) : yf;
  }
  far(x, z) {
    const n = FAR.n, fx = clamp((x - FAR.X0) / FAR.st, 0, n - 1.001), fz = clamp((z - FAR.Z0) / FAR.st, 0, n - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, h = this.hf, o = j * n + i;
    return h[o] * (1 - u) * (1 - v) + h[o + 1] * u * (1 - v) + h[o + n] * (1 - u) * v + h[o + n + 1] * u * v;
  }
  /* set the course into the hill: the corridor's height is the run profile (baseLine) plus C, C the level that leaves the
     hill along the course as little lifted or lowered as can be; warp(z) what the hill under the course's middle is moved
     by, which fades out across over CORRIDOR.reach */
  setCourse() {
    const K = CORRIDOR, zs = [], d = [];
    for (let z = K.z0; z <= K.z1; z += 5) {
      let s = 0; for (let x = -40; x <= 40; x += 10) s += this.dem(x, z);
      zs.push(z); d.push(s / 9 - baseLine(z));
    }
    // C: the middle of what the hill and the profile differ by (the profile's 198 m against the hill's own fall there)
    const sorted = d.slice().sort((p, q) => p - q); this.C = sorted[Math.floor(sorted.length / 2)];
    // the difference along the course, smoothed over 60 m
    const W = 6, sm = d.map((_, i) => { let s = 0, k = 0; for (let j = i - W; j <= i + W; j++) { const jj = Math.max(0, Math.min(d.length - 1, j)); s += d[jj]; k++; } return s / k; });
    this.wz = { z0: K.z0, st: 5, v: sm.map(v => this.C - v) };
    this.span = { lift: Math.max(...this.wz.v), drop: Math.min(...this.wz.v) };
  }
  warpZ(z) {
    const W = this.wz; if (!W) return 0;
    const f = clamp((z - W.z0) / W.st, 0, W.v.length - 1.001), i = Math.floor(f), t = f - i;
    return W.v[i] + (W.v[i + 1] - W.v[i]) * t;
  }
  // the course's own snow across: level, with the groomer's slight banks at its sides
  courseY(x, z) { return this.C + baseLine(z); }
  // the ground (the physics' and the terrain's): the course in its corridor, the moved hill beside it
  at(x, z) {
    const K = CORRIDOR, ax = Math.abs(x);
    // how much of the course here: across (full within half, gone by half + blend) and along (its two ends fade over 80 m)
    const along = smoothstep(K.z0 - 80, K.z0, z) * (1 - smoothstep(K.z1, K.z1 + 80, z));
    const inC = (1 - smoothstep(K.half, K.half + K.blend, ax)) * along;
    if (inC >= 1) return this.courseY(x, z);
    const fade = (1 - smoothstep(K.half, K.reach, ax)) * smoothstep(K.z0 - 260, K.z0, z) * (1 - smoothstep(K.z1, K.z1 + 260, z));
    let y = this.dem(x, z) + this.warpZ(z) * fade;
    if (inC > 0) y += (this.courseY(x, z) - y) * inC;
    return y;
  }
  /* how much snow lies here (0 bare ground, 1 snow): the course and the venues round it (made snow), the resort's runs
     (osm.json, about 25 m either side of each run's line), and the natural snow left in the shade: on slopes facing north
     and in hollows, broken up; little on the slopes facing the sun */
  buildSnow() {
    const runs = this.osm ? this.osm.runs : [];
    const segs = [];
    for (const r of runs) for (let i = 0; i < r.pts.length - 1; i++) segs.push([r.pts[i][0], r.pts[i][1], r.pts[i + 1][0], r.pts[i + 1][1], /cross|half|slope|mogul|aerial/i.test(r.name) ? 40 : 24]);
    // a grid of 64 m cells listing the segments near them
    const B = 64, grid = new Map(), key = (i, j) => i * 100003 + j;
    for (const s of segs) {
      const [x0, z0, x1, z1, w] = s;
      for (let i = Math.floor((Math.min(x0, x1) - w) / B); i <= Math.floor((Math.max(x0, x1) + w) / B); i++)
        for (let j = Math.floor((Math.min(z0, z1) - w) / B); j <= Math.floor((Math.max(z0, z1) + w) / B); j++) { const k = key(i, j); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(s); }
    }
    this.runAt = (x, z) => {
      const l = grid.get(key(Math.floor(x / B), Math.floor(z / B))); if (!l) return 0;
      let best = 0;
      for (const [x0, z0, x1, z1, w] of l) {
        const dx = x1 - x0, dz = z1 - z0, L2 = dx * dx + dz * dz || 1, t = clamp(((x - x0) * dx + (z - z0) * dz) / L2, 0, 1);
        const d = Math.hypot(x - x0 - dx * t, z - z0 - dz * t), wr = w * (0.85 + 0.3 * simplex(x * 0.02, z * 0.02));
        best = Math.max(best, 1 - smoothstep(wr - 6, wr + 4, d));
      }
      return best;
    };
  }
  snowAt(x, z) {
    // the venue: the course, its finish, the halfpipe beside it (rider's right) and the slopes round them, all made snow
    const ven = (1 - smoothstep(110, 170, Math.abs(x + (z > 300 ? 30 : 0)) - (z > 300 ? 60 * smoothstep(300, 500, z) : 0))) * smoothstep(-260, -170, z) * (1 - smoothstep(760, 840, z));
    let s = Math.max(ven, this.runAt ? this.runAt(x, z) : 0);
    if (s >= 1) return 1;
    // natural snow: where the hill faces away from the sun (north, in the world: the frame is turned 38.5 degrees) and in
    // its hollows; the noise breaks it into patches
    const e = 12, gx = (this.dem(x + e, z) - this.dem(x - e, z)) / (2 * e), gz = (this.dem(x, z + e) - this.dem(x, z - e)) / (2 * e);
    // the way the hill falls, in the world: east, north
    const B = GEO.bearing * Math.PI / 180, fe = -(gz * Math.sin(B) - gx * Math.cos(B)), fn = -(gz * Math.cos(B) + gx * Math.sin(B));
    const slope = Math.hypot(gx, gz), north = slope > 0.02 ? fn / slope : 0;
    const shade = smoothstep(-0.1, 0.8, north) * smoothstep(0.03, 0.18, slope);
    const n = fbm(x * 0.006 + 3.1, z * 0.006 - 1.7, 3) + 0.5 * fbm(x * 0.03, z * 0.03, 2);
    const near = 1 - smoothstep(500, 1500, Math.hypot(x, z - 300));
    const nat = smoothstep(0.15, 0.55, shade * 0.9 + n * 0.55 - 0.05 + near * 0.18);
    return Math.max(s, nat * 0.95);
  }
  /* what grows here: 0.5 a wood (bare larch, birch near the venue), 1 young pines planted in rows, 0 open grass; none on
     the course, the venue or a run (clear, m_oly22.js). The same noise plantTrees places its cards by. */
  vegAt(x, z) {
    if (this.clear && this.clear(x, z)) return 0;
    if (this.runAt && this.runAt(x, z) > 0.15) return 0;
    const stand = fbm(x * 0.005 + 2, z * 0.005 - 5, 3) + 0.35 * fbm(x * 0.02, z * 0.02, 2);
    if (stand > 0.2) return 0.5;
    if (stand < -0.06 && Math.hypot(x, z - 300) > 420) return 1;
    return 0;
  }
  // the snow cover as a texture for the snow shader's bare ground (m_oly22.js): 512 x 512 over 5.12 km, round the course
  snowTexture(N = 512, size = 5120, cx = 0, cz = 300) {
    const d = new Uint8Array(N * N * 4), st = size / N, x0 = cx - size / 2, z0 = cz - size / 2;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = x0 + (i + 0.5) * st, z = z0 + (j + 0.5) * st, s = this.snowAt(x, z);
      const k = (j * N + i) * 4;
      d[k] = Math.round(s * 255);
      // (g: the grass's own tone, darker scrub and lighter dry grass in patches; b: soil)
      d[k + 1] = Math.round(clamp(0.5 + 0.5 * fbm(x * 0.012 - 7, z * 0.012 + 2, 3), 0, 1) * 255);
      d[k + 2] = Math.round(clamp(0.5 + 0.6 * fbm(x * 0.05 + 11, z * 0.05, 2), 0, 1) * 255);
      d[k + 3] = Math.round(this.vegAt(x, z) * 255);
    }
    const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return { tex: t, win: new THREE.Vector4(x0, z0, 1 / size, 1) };
  }
}

export async function loadLand(base) {
  const [buf, osm] = await Promise.all([
    fetch(new URL('../data/genting2022/dem.bin?v=31', base)).then(r => { if (!r.ok) throw new Error('ground ' + r.status); return r.arrayBuffer(); }),
    fetch(new URL('../data/genting2022/osm.json?v=31', base)).then(r => r.ok ? r.json() : null).catch(() => null),
  ]);
  return new Land(buf, osm);
}

/* ---- the far hills: the far grid as one mesh out to 24 km (its middle sunk under the terrain's own patches), coloured
   as the near ground is (bare brown, snow in the shade, dark woods and planted slopes), in the air's haze. One draw. */
export function makeFarHills(scene, q, land) {
  const low = q.tier === 'low', step = low ? 2 : 1, n = Math.floor((FAR.n - 1) / step) + 1;
  const P = new Float32Array(n * n * 3), C = new Float32Array(n * n * 3), I = [];
  const BR = [0.15, 0.1, 0.068], DK = [0.07, 0.048, 0.035], SN = [0.78, 0.8, 0.84], WD = [0.085, 0.055, 0.04];   // (warm dark browns: the photos' hills)
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = FAR.X0 + i * step * FAR.st, z = FAR.Z0 + j * step * FAR.st, k = j * n + i;
    let y = land.far(x, z);
    // (under the near ground, where the terrain's patches draw: sunk out of their way)
    const r = Math.max(Math.abs(x), Math.abs(z - 300));
    y -= 60 * (1 - smoothstep(2200, 3000, r));
    P[k * 3] = x; P[k * 3 + 1] = y; P[k * 3 + 2] = z;
    const s = r < 2400 ? land.snowAt(x, z) : (() => {
      const e = 200, gx = (land.far(x + e, z) - land.far(x - e, z)) / (2 * e), gz = (land.far(x, z + e) - land.far(x, z - e)) / (2 * e);
      const B = GEO.bearing * Math.PI / 180, fn = -(gz * Math.cos(B) + gx * Math.sin(B)), sl = Math.hypot(gx, gz);
      return smoothstep(0.2, 0.75, (sl > 0.02 ? fn / sl : 0) * 0.6 + fbm(x * 0.0007, z * 0.0007, 2) * 0.5 + (y + 300) / 1600);
    })();
    const w = smoothstep(0.1, 0.5, fbm(x * 0.0011 + 5, z * 0.0011 - 2, 3)) * 0.7, g = 0.5 + 0.5 * fbm(x * 0.002, z * 0.002, 2);
    for (let c = 0; c < 3; c++) {
      const bare = BR[c] * (0.75 + 0.5 * g) * (1 - w) + WD[c] * w;
      C[k * 3 + c] = bare + (SN[c] - bare) * s * 0.85 + (DK[c] - bare) * 0.15 * (1 - g);
    }
  }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) { const a = j * n + i, b = a + 1, c = a + n, d = c + 1; I.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  g.setIndex(I); g.computeVertexNormals();
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = s => {
    s.uniforms.uHorizon = snowUniforms.uHorizon; s.uniforms.uNight = snowUniforms.uNight;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTW;').replace('#include <project_vertex>', '#include <project_vertex>\nvTW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uHorizon; uniform float uNight; varying vec3 vTW;')
      .replace('#include <opaque_fragment>', `outgoingLight -= reflectedLight.directDiffuse * uNight * 0.9;
outgoingLight += diffuseColor.rgb * vec3(0.10, 0.12, 0.16) * (1.0 - uNight);
#include <opaque_fragment>`)
      .replace('#include <fog_fragment>', `#ifdef USE_FOG
  float dd = length(vTW - cameraPosition), kk = fogDensity / 0.00028;
  float hz = 1.0 - exp(-dd * 0.00007 * kk);
  vec3 fdir = normalize(vTW - cameraPosition);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, texture2D(uHorizon, vec2(atan(fdir.z, fdir.x) * 0.1591549 + 0.5, 0.5)).rgb, clamp(hz, 0.0, 1.0));
#endif`);
  };
  m.customProgramCacheKey = () => 'gentingfar';
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'Genting far hills'; mesh.matrixAutoUpdate = false; mesh.frustumCulled = false; mesh.renderOrder = 1e5;
  scene.add(mesh); mesh.updateMatrixWorld();
  return mesh;
}

/* ---- the trees: bare larch woods, birch groves and planted rows of young pines, each a pair of crossed cards with a
   picture drawn here (an alpha test cuts out the twigs), every tree in one instanced draw; the nearest trees are
   ridden into as the Forest's are (their places go into its collision grid: m_oly22.js) */
function treeAtlas() {
  const W = 512, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), r = rng(11);
  g.clearRect(0, 0, W, H);
  // a branch: a line that splits as it goes up and out
  const branch = (x, y, a, len, w, col, depth) => {
    if (depth <= 0 || len < 2) return;
    const x2 = x + Math.cos(a) * len, y2 = y - Math.sin(a) * len;
    g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
    const n = depth > 3 ? 2 : 3;
    for (let k = 0; k < n; k++) branch(x2, y2, a + (r() - 0.5) * 1.1, len * (0.62 + r() * 0.15), Math.max(0.6, w * 0.62), col, depth - 1);
  };
  /* 0: a bare larch in winter: a straight stem, an uneven narrow crown of fine grey-brown twigs in tufts with gaps
     between them (a clean cone of haze read as a cartoon tree from afar) */
  {
    const cx = 64;
    g.strokeStyle = '#4a3a32'; g.lineWidth = 3.5; g.beginPath(); g.moveTo(cx, 254); g.lineTo(cx + 2, 8); g.stroke();
    // (tufts: clusters of short twigs along the stem, each tuft its own reach, so the outline is ragged)
    for (let y = 16; y < 228; y += 5 + r() * 6) {
      const t = (y - 10) / 220, reach = (8 + 40 * Math.pow(t, 0.8)) * (0.45 + 0.75 * r());
      for (const sg of [-1, 1]) {
        if (r() < 0.22) continue;
        const ex = cx + sg * reach, ey = y + 4 + r() * 8;
        g.strokeStyle = `rgba(${92 + r() * 22 | 0},${74 + r() * 14 | 0},${66 + r() * 12 | 0},0.92)`; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(cx, y); g.quadraticCurveTo(cx + sg * reach * 0.5, y - 1, ex, ey); g.stroke();
        for (let k = 0; k < 9; k++) {
          const t2 = 0.25 + 0.75 * r(), px = cx + sg * reach * t2, py = y + t2 * 6;
          g.fillStyle = `rgba(${98 + r() * 24 | 0},${80 + r() * 16 | 0},${72 + r() * 14 | 0},0.75)`;
          g.fillRect(px - 2 + (r() - 0.5) * 6, py - 3 + (r() - 0.5) * 8, 2 + r() * 3, 2 + r() * 2);
        }
      }
    }
  }
  // 1: a birch (a white stem with dark marks, a rounded crown of purple-brown twigs)
  {
    const cx = 192;
    for (let k = 0; k < 3; k++) {
      const bx = cx + (k - 1) * 9 + (r() - 0.5) * 4;
      g.strokeStyle = '#e8e4dc'; g.lineWidth = 5 - k; g.beginPath(); g.moveTo(bx, 254); g.lineTo(bx + (r() - 0.5) * 10, 60); g.stroke();
      g.fillStyle = '#2b2522'; for (let y = 240; y > 70; y -= 9 + r() * 10) g.fillRect(bx - 2, y, 4 + r() * 2, 2);
    }
    g.lineCap = 'round';
    for (let k = 0; k < 26; k++) branch(cx + (r() - 0.5) * 20, 150 - r() * 60, Math.PI / 2 + (r() - 0.5) * 1.6, 18 + r() * 22, 2.2, 'rgba(96,70,72,0.85)', 5);
  }
  /* 2: a young planted pine: whorls of drooping branches, each a fan of short needle strokes, dark blue-green with
     lighter tips and a little snow, the outline ragged (stacked triangles read as cartoon cones) */
  {
    const cx = 320;
    g.fillStyle = '#3a2a1c'; g.fillRect(cx - 2, 214, 4, 40);
    for (let y = 222; y > 18; y -= 7 + r() * 5) {
      const t = (y - 14) / 214, reach = (5 + 50 * t) * (0.8 + 0.35 * r());
      for (let k = 0; k < 26 + 30 * t; k++) {
        const sg = r() < 0.5 ? -1 : 1, d = Math.pow(r(), 0.7) * reach, px = cx + sg * d, py = y + d * 0.28 + (r() - 0.5) * 6;
        const tip = d / Math.max(1, reach);
        g.strokeStyle = `rgba(${18 + tip * 26 + r() * 10 | 0},${38 + tip * 30 + r() * 14 | 0},${30 + tip * 18 + r() * 10 | 0},0.95)`;
        g.lineWidth = 1.4 + r() * 1.4; g.beginPath(); g.moveTo(px, py); g.lineTo(px + sg * (3 + r() * 5), py + 2 + r() * 5); g.stroke();
      }
      if (r() < 0.5) { g.fillStyle = 'rgba(232,236,242,0.85)'; const d = r() * reach * 0.8; g.fillRect(cx + (r() < 0.5 ? -d : d) - 3, y - 2 + d * 0.28, 5 + r() * 4, 2); }
    }
  }
  // 3: a scrub bush (low, brown)
  {
    const cx = 448; g.lineCap = 'round';
    for (let k = 0; k < 30; k++) branch(cx + (r() - 0.5) * 30, 254, Math.PI / 2 + (r() - 0.5) * 1.8, 14 + r() * 16, 2, 'rgba(110,84,60,0.9)', 4);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true;
  return t;
}
// kinds: 0 larch, 1 birch, 2 young pine, 3 scrub
/* where: in stands, as the hills round the venue are wooded (larch woods in bands across the slopes, birch groves near
   the venue, open dry grass between), young pines planted in rows along the contours of the open slopes, a little scrub;
   never on the course, its finish, the halfpipe or a run */
export function plantTrees(land, q, course) {
  const out = [], r = rng(23), max = q.tier === 'low' ? 5000 : q.tier === 'medium' ? 9000 : 14000;
  const lanes = course.clear || (() => false);
  for (let tries = 0; out.length < max && tries < max * 18; tries++) {
    const x = (r() - 0.5) * 1800, z = 300 + (r() - 0.5) * 1800;
    // (what would grow here first, from the noise alone: most tries are open grass, and the ground's own sums for
    // them were most of this loop's time while loading)
    const stand = fbm(x * 0.005 + 2, z * 0.005 - 5, 3) + 0.35 * fbm(x * 0.02, z * 0.02, 2), dV = Math.hypot(x, z - 300);
    const wood = stand > 0.3, planted = !wood && stand < -0.08 && dV > 220, roll = r();
    if (!wood && !planted && roll >= 0.04) continue;
    if (lanes(x, z)) continue;
    const run = land.runAt ? land.runAt(x, z) : 0;
    if (run > 0.2) continue;
    const y = land.at(x, z), e = 6, gx = (land.at(x + e, z) - land.at(x - e, z)) / (2 * e), gz = (land.at(x, z + e) - land.at(x, z - e)) / (2 * e);
    if (Math.hypot(gx, gz) > 0.9) continue;
    let kind = -1, s = 0;
    if (wood) {
      const birch = fbm(x * 0.011 - 4, z * 0.011 + 8, 2) > 0.12 && dV < 1000;
      kind = birch ? 1 : 0; s = birch ? 8 + r() * 5 : 9 + r() * 6;
    } else if (planted) {
      // (planted rows: on the contour, the rows about 4 m apart up the slope)
      const ph = ((y / 2.0) % 1 + 1) % 1;
      if (Math.abs(ph - 0.5) < 0.1 && r() < 0.7) { kind = 2; s = 1.4 + r() * 1.4; }
    } else { kind = 3; s = 1.0 + r() * 1.2; }
    if (kind < 0) continue;
    out.push({ x, y: y - 0.2, z, s, k: kind, rot: r() * 6.283 });
  }
  return out;
}
export function makeTrees(scene, q, list) {
  const tex = treeAtlas();
  // two crossed cards, one unit tall, standing on their foot
  const P = [], U = [], N = [], I = [];
  for (const a of [0, Math.PI / 2]) {
    const cx = Math.cos(a) * 0.5, cz = Math.sin(a) * 0.5, b = P.length / 3;
    P.push(-cx, 0, -cz, cx, 0, cz, cx, 1, cz, -cx, 1, -cz); U.push(0, 0, 1, 0, 1, 1, 0, 1);
    for (let k = 0; k < 4; k++) N.push(0, 0.6, 0.8);
    I.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setIndex(I);
  const kinds = new Float32Array(list.length);
  // (each kind's width to height)
  const ASPECT = [0.9, 1.0, 0.95, 1.6];
  const mesh = new THREE.InstancedMesh(g, null, list.length);
  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  list.forEach((t, i) => { qq.setFromAxisAngle(Y, t.rot); m4.compose(ps.set(t.x, t.y, t.z), qq, sc.set(t.s * ASPECT[t.k], t.s, t.s * ASPECT[t.k])); mesh.setMatrixAt(i, m4); kinds[i] = t.k; });
  g.setAttribute('aKind', new THREE.InstancedBufferAttribute(kinds, 1));
  const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.38, side: THREE.DoubleSide });
  mat.onBeforeCompile = s => {
    s.uniforms.uHorizon = snowUniforms.uHorizon; s.uniforms.uNight = snowUniforms.uNight;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float aKind; varying vec3 vTW;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = vec2((uv.x + aKind) * 0.25, uv.y);')
      .replace('#include <project_vertex>', `#include <project_vertex>
vTW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
// (out past 2.6 km: none)
if (length(instanceMatrix[3].xz - cameraPosition.xz) > 1400.0) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);`);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uHorizon; uniform float uNight; varying vec3 vTW;')
      .replace('#include <opaque_fragment>', 'outgoingLight -= reflectedLight.directDiffuse * uNight * 0.7;\n#include <opaque_fragment>')
      .replace('#include <fog_fragment>', `#ifdef USE_FOG
  float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  vec3 fdir = normalize(vTW - cameraPosition);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, texture2D(uHorizon, vec2(atan(fdir.z, fdir.x) * 0.1591549 + 0.5, 0.5)).rgb, fogFactor);
#endif`);
  };
  mat.customProgramCacheKey = () => 'gentingtrees';
  mesh.material = mat;
  mesh.name = 'Genting trees'; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.castShadow = false; mesh.receiveShadow = true;
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh); mesh.updateMatrixWorld();
  return mesh;
}
