// Street furniture from OpenStreetMap: hydrants, street lamps, traffic lights (with working cycles), stop and
// give way signs, utility poles and power towers with sagging wires, bollards, benches, bins, bus stops and
// shelters, post boxes, phone boxes, trees (points and tree rows), fences, walls, hedges and guard rails.
// Every model is built in code to real dimensions and drawn as InstancedMeshes, one per model part per 500 m
// bin, so the draw call count stays near (parts in use) x (bins in view).
//
//   await props.preload()                                           textures, materials, model templates (no OSM data)
//   await props.build(osm, { groundAt, scene, collide, roads })   builds everything in the store off screen, yielding
//                                                                   every 8 ms, then swaps it in; returns props
//   props.update(dt, camera)                                        lens colours from signals.js (SIG.tick runs elsewhere)
//   props.signalAt(nodeId, heading) -> 'red' | 'amber' | 'green'    for traffic travelling on that heading
//   props.reheight(bbox)                                            re-sample ground heights inside {x0,z0,x1,z1}
//   props.reset() / props.dispose()                                 drop everything (a new area or origin)
// build() returns the props object (drive.js keeps it, calls update(dt, camera) and dispose()).
//
// Local frame from geo.js: +x east, +y up, +z south, metres. A model's front faces local -z and its right is +x;
// placed with yaw H (heading degrees) its front faces heading H.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { frame, dirHeading } from './geo.js?v=3';
import * as SIG from './signals.js?v=3';

const D2R = Math.PI / 180;
const BIN = 500;

// ---------------------------------------------------------------- small helpers
function rng(seed) {
  let s = (Math.floor(Math.abs(seed)) % 2147483646) + 1;
  for (let i = 0; i < 4; i++) s = s * 16807 % 2147483647;
  return () => (s = s * 16807 % 2147483647) / 2147483647;
}
const num = (v) => { if (v == null) return null; const m = /^\s*(-?[\d.]+)\s*(m|ft|')?/.exec(String(v)); if (!m) return null; const x = parseFloat(m[1]); return isFinite(x) ? (m[2] && m[2] !== 'm' ? x * 0.3048 : x) : null; };
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const angDiff = (a, b) => { let d = ((a - b) % 360 + 540) % 360 - 180; return d; };
const V = (x, y, z) => new THREE.Vector3(x, y, z);
function col(c) { if (c instanceof THREE.Color) return c; const k = new THREE.Color(); if (typeof c === 'string') { try { k.setStyle(c); } catch (e) { k.set(0xffffff); } } else k.set(c); return k; }
function tagColour(s, fallback) {
  if (!s) return col(fallback);
  const k = new THREE.Color();
  try { k.setStyle(String(s).split(';')[0].trim().replace(/_/g, '')); return k; } catch (e) { return col(fallback); }
}
function guessRegion(lat, lon) {
  if (lat > 49.8 && lat < 61 && lon > -8.7 && lon < 1.9) return 'uk';
  if (lat > 24 && lat < 46 && lon > 122.5 && lon < 146) return 'jp';
  if (lat > 14 && lat < 72 && lon > -170 && lon < -52) return 'us';
  if (lat > 34 && lat < 72 && lon > -11 && lon < 42) return 'eu';
  return 'other';
}

// Matrix from translation, Euler (YXZ) and scale.
function mat(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), V(sx, sy, sz));
}
// Matrix taking a unit cylinder along +y (0..1, radius 1) to the segment a-b with radius r.
function segMat(ax, ay, az, bx, by, bz, r, out = new THREE.Matrix4()) {
  const vx = bx - ax, vy = by - ay, vz = bz - az, L = Math.hypot(vx, vy, vz) || 1e-6;
  const yx = vx / L, yy = vy / L, yz = vz / L;
  // X = normalize(Y x ref), Z = X x Y (right handed)
  let xx, xy, xz;
  if (Math.abs(yy) < 0.9) { xx = -yz; xy = 0; xz = yx; } else { xx = 0; xy = yz; xz = -yy; }
  const xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xy /= xl; xz /= xl;
  const zx = xy * yz - xz * yy, zy = xz * yx - xx * yz, zz = xx * yy - xy * yx;
  return out.set(xx * r, vx, zx * r, ax, xy * r, vy, zy * r, ay, xz * r, vz, zz * r, az, 0, 0, 0, 1);
}

// Geometry builder: merges primitives with a per-primitive colour into one indexed geometry.
class GB {
  constructor() { this.list = []; }
  add(g, c = 0xffffff, m = null) {
    if (!g.index) { const n = g.attributes.position.count, idx = new Array(n); for (let i = 0; i < n; i++) idx[i] = i; g.setIndex(idx); }
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.color) {
      const k = col(c), n = g.attributes.position.count, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = k.r; a[i * 3 + 1] = k.g; a[i * 3 + 2] = k.b; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    }
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv' && k !== 'color') g.deleteAttribute(k);
    g.morphAttributes = {};
    if (m) g.applyMatrix4(m);
    this.list.push(g);
    return this;
  }
  build() { const g = mergeGeometries(this.list, false); g.computeBoundingSphere(); g.computeBoundingBox(); return g; }
}
const cyl = (rt, rb, h, seg = 12, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open).translate(0, h / 2, 0);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
const boxc = (w, h, d) => new THREE.BoxGeometry(w, h, d);
function tubeG(a, b, r0, r1, seg = 8, capped = false) {
  const d = new THREE.Vector3().subVectors(b, a), L = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, L, seg, 1, !capped).translate(0, L / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize());
  g.applyQuaternion(q); g.translate(a.x, a.y, a.z);
  // bark repeats about once a metre along a branch
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * L);
  return g;
}
// box with uvs scaled to metres so a tiling texture keeps its size (u along x for the long faces)
function boxM(w, h, d, sx = 1, sy = 1) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] * sx, uv.getY(i) * dims[f][1] * sy); }
  return g;
}

// ---------------------------------------------------------------- textures (drawn in code)
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function canvasTex(c, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// A canvas with alpha turned into a DataTexture whose see-through pixels keep a leafy colour (no dark mip fringes).
function alphaTex(c, fill) {
  const g = c.getContext('2d'), im = g.getImageData(0, 0, c.width, c.height), d = im.data;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] < 8) { d[i] = fill[0]; d[i + 1] = fill[1]; d[i + 2] = fill[2]; }
  const t = new THREE.DataTexture(new Uint8Array(d.buffer.slice(0)), c.width, c.height, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4; t.needsUpdate = true;
  return t;
}
function leafTexture(seed, hue = 95) {
  const S = 512, c = canvas(S, S), g = c.getContext('2d'), r = rng(seed);
  const leaf = (x, y, len, wid, ang, h, s, l) => {
    g.save(); g.translate(x, y); g.rotate(ang);
    g.beginPath(); g.moveTo(-len / 2, 0);
    g.quadraticCurveTo(-len * 0.1, -wid, len / 2, 0); g.quadraticCurveTo(-len * 0.1, wid, -len / 2, 0);
    g.fillStyle = `hsl(${h},${s}%,${l}%)`; g.fill();
    g.strokeStyle = `hsla(${h},${s - 10}%,${l + 12}%,0.55)`; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-len / 2, 0); g.lineTo(len * 0.4, 0); g.stroke();
    g.restore();
  };
  // twigs from the middle outwards, leaves along them, then a fill so the cluster reads as dense foliage
  g.lineCap = 'round';
  for (let t = 0; t < 9; t++) {
    const a = r() * Math.PI * 2, L = 140 + r() * 90;
    let x = S / 2 + (r() - 0.5) * 40, y = S / 2 + (r() - 0.5) * 40;
    g.strokeStyle = '#4a3a2a'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke();
    for (let k = 0; k < 16; k++) {
      const f = k / 16, px = x + Math.cos(a) * L * f, py = y + Math.sin(a) * L * f, side = k % 2 ? 1 : -1;
      const la = a + side * (0.6 + r() * 0.5), len = 30 + r() * 16;
      leaf(px + Math.cos(la) * len * 0.45, py + Math.sin(la) * len * 0.45, len, 10 + r() * 5, la, hue + (r() - 0.5) * 22, 40 + r() * 22, 16 + r() * 20);
    }
  }
  for (let i = 0; i < 560; i++) {
    const a = r() * Math.PI * 2, d = Math.pow(r(), 0.85) * 232;
    const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d;
    const len = 26 + r() * 18;
    leaf(x, y, len, 9 + r() * 6, a + (r() - 0.5) * 1.6, hue + (r() - 0.5) * 24, 38 + r() * 25, 15 + r() * 24);
  }
  return alphaTex(c, [52, 74, 36]);
}
function needleTexture(seed) {
  const W = 512, H = 256, c = canvas(W, H), g = c.getContext('2d'), r = rng(seed);
  g.lineCap = 'round';
  // the branch runs along u (left to right), side shoots fan out, each covered in short needles
  const shoot = (x0, y0, x1, y1, w) => {
    g.strokeStyle = '#3d3022'; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    const L = Math.hypot(x1 - x0, y1 - y0), n = Math.floor(L / 2.2), ux = (x1 - x0) / L, uy = (y1 - y0) / L;
    for (let i = 0; i < n; i++) {
      const f = i / n, px = x0 + (x1 - x0) * f, py = y0 + (y1 - y0) * f;
      for (const sd of [-1, 1]) {
        const a = Math.atan2(uy, ux) + sd * (0.9 + r() * 0.4), l = 9 + r() * 7 * (1 - f * 0.5);
        g.strokeStyle = `hsl(${118 + (r() - 0.5) * 24},${32 + r() * 20}%,${16 + r() * 16}%)`; g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); g.stroke();
      }
    }
  };
  shoot(4, H / 2, W - 10, H / 2 + (r() - 0.5) * 10, 5);
  for (let k = 0; k < 14; k++) {
    const x = 30 + k * 33 + r() * 10, sd = k % 2 ? 1 : -1, L = (H / 2 - 18) * (1 - k / 22) * (0.7 + r() * 0.3);
    shoot(x, H / 2, x + L * 0.65, H / 2 + sd * L, 2.4);
  }
  return alphaTex(c, [38, 58, 34]);
}
function barkTexture() {
  const c = canvas(256, 512), g = c.getContext('2d'), r = rng(77);
  g.fillStyle = '#5b4d40'; g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 900; i++) {
    const x = r() * 256, y = r() * 512, l = 20 + r() * 90, w = 1 + r() * 4, v = r();
    g.fillStyle = v < 0.5 ? `rgba(30,24,18,${0.25 + r() * 0.4})` : `rgba(140,128,112,${0.15 + r() * 0.3})`;
    g.fillRect(x, y, w, l); g.fillRect(x - 256, y, w, l);
  }
  return canvasTex(c, true);
}
function noiseTexture(base, spread, seed, size = 256, blobs = 2500) {
  const c = canvas(size, size), g = c.getContext('2d'), r = rng(seed);
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  for (let i = 0; i < blobs; i++) {
    const v = (r() - 0.5) * spread, a = 0.05 + r() * 0.12, s = 1 + r() * 4;
    g.fillStyle = v > 0 ? `rgba(255,255,255,${a * v / spread * 2})` : `rgba(0,0,0,${a * -v / spread * 2})`;
    g.fillRect(r() * size, r() * size, s, s);
  }
  return canvasTex(c, true);
}
function brickTexture() {
  const c = canvas(256, 256), g = c.getContext('2d'), r = rng(5);
  g.fillStyle = '#b8b2a8'; g.fillRect(0, 0, 256, 256);
  const rows = 13, rh = 256 / rows, bw = 256 / 4.4 / 1.0;
  for (let j = 0; j < rows; j++) {
    const off = (j % 2) * bw / 2;
    for (let x = -bw; x < 256 + bw; x += bw) {
      const h = 8 + r() * 14, s = 45 + r() * 20, l = 30 + r() * 14;
      g.fillStyle = `hsl(${h},${s}%,${l}%)`;
      const X = x + off;
      g.fillRect(X + 1.5, j * rh + 1.5, bw - 3, rh - 3);
      g.fillStyle = `rgba(0,0,0,${r() * 0.15})`; g.fillRect(X + 1.5, j * rh + rh * 0.6, bw - 3, rh * 0.4 - 1.5);
    }
  }
  return canvasTex(c, true);
}
function hedgeTexture() {
  const c = canvas(256, 256), g = c.getContext('2d'), r = rng(11);
  g.fillStyle = '#1f3418'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const x = r() * 256, y = r() * 256, s = 2 + r() * 5;
    g.fillStyle = `hsl(${85 + r() * 35},${30 + r() * 30}%,${12 + r() * 26}%)`;
    g.beginPath(); g.ellipse(x, y, s, s * 0.6, r() * 3, 0, Math.PI * 2); g.fill();
    if (x < 6) { g.beginPath(); g.ellipse(x + 256, y, s, s * 0.6, 0, 0, Math.PI * 2); g.fill(); }
  }
  return canvasTex(c, true);
}
function chainTexture() {
  const S = 64, c = canvas(S, S), g = c.getContext('2d');
  g.strokeStyle = '#d6d9dc'; g.lineWidth = 3.2; g.lineCap = 'square';
  for (const [a, b, cc, d] of [[0, 0, S, S], [S, 0, 0, S], [-S, 0, S, 2 * S], [0, -S, 2 * S, S]]) { g.beginPath(); g.moveTo(a, b); g.lineTo(cc, d); g.stroke(); }
  return alphaTex(c, [190, 194, 198]);
}
function haloTexture() {
  const c = canvas(64, 64), g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); return t;
}
// Sign atlas, 4 x 2 cells of 256 px: 0 STOP, 1 YIELD, 2 give way (plain), 3 GIVE WAY (UK), 4 Japanese stop,
// 5 bus stop plate, 6 sign back (bare metal), 7 shelter poster.
function signAtlas() {
  const c = canvas(1024, 512), g = c.getContext('2d');
  const cell = (k) => [(k % 4) * 256, Math.floor(k / 4) * 256];
  const poly = (cx, cy, R, n, a0) => { g.beginPath(); for (let i = 0; i < n; i++) { const a = a0 + i * 2 * Math.PI / n; const x = cx + R * Math.cos(a), y = cy - R * Math.sin(a); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); };
  const RED = '#c4122f', SANS = 'Arial, Helvetica, sans-serif';
  g.fillStyle = '#8f969c'; g.fillRect(0, 0, 1024, 512);
  { const [x, y] = cell(0), cx = x + 128, cy = y + 128;
    poly(cx, cy, 128, 8, Math.PI / 8); g.fillStyle = '#fff'; g.fill();
    poly(cx, cy, 119, 8, Math.PI / 8); g.fillStyle = RED; g.fill();
    g.fillStyle = '#fff'; g.font = `bold 78px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.save(); g.translate(cx, cy + 3); g.scale(0.92, 1.15); g.fillText('STOP', 0, 0); g.restore(); }
  const tri = (k, inner, text, tcol, font, ty) => {
    const [x, y] = cell(k), cx = x + 128, cy = y + 128;
    poly(cx, cy, 128, 3, -Math.PI / 2); g.fillStyle = '#fff'; g.fill();
    poly(cx, cy, 120, 3, -Math.PI / 2); g.fillStyle = RED; g.fill();
    if (inner) { poly(cx, cy, 72, 3, -Math.PI / 2); g.fillStyle = inner; g.fill(); }
    if (text) { g.fillStyle = tcol; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, cx, cy + ty); }
  };
  tri(1, '#fff', 'YIELD', RED, `bold 25px ${SANS}`, -20);
  tri(2, '#fff', null);
  tri(3, '#fff', 'GIVE WAY', '#111', `bold 15px ${SANS}`, -22);
  tri(4, null, '止まれ', '#fff', 'bold 50px "Yu Gothic", "Meiryo", "MS Gothic", sans-serif', -24);
  { const [x, y] = cell(5);
    g.fillStyle = '#fff'; g.fillRect(x, y, 256, 256);
    g.strokeStyle = '#0b5a2a'; g.lineWidth = 12; g.strokeRect(x + 8, y + 8, 240, 240);
    g.fillStyle = '#0b5a2a';
    // a bus, side on
    g.beginPath(); g.roundRect(x + 52, y + 46, 152, 92, 14); g.fill();
    g.fillStyle = '#fff'; for (let i = 0; i < 4; i++) g.fillRect(x + 62 + i * 35, y + 58, 28, 30);
    g.fillStyle = '#0b5a2a'; g.beginPath(); g.arc(x + 88, y + 142, 15, 0, 7); g.arc(x + 172, y + 142, 15, 0, 7); g.fill();
    g.font = `bold 44px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('BUS', x + 128, y + 198); }
  { const [x, y] = cell(6), r = rng(3);
    g.fillStyle = '#9aa1a7'; g.fillRect(x, y, 256, 256);
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},0.06)`; g.fillRect(x + r() * 256, y + r() * 256, 30 * r(), 1); } }
  { const [x, y] = cell(7), gr = g.createLinearGradient(x, y, x, y + 256);
    gr.addColorStop(0, '#1f6fb2'); gr.addColorStop(0.6, '#79c0e8'); gr.addColorStop(1, '#f2e6c8');
    g.fillStyle = gr; g.fillRect(x, y, 256, 256);
    g.fillStyle = '#f5f5f0'; g.beginPath(); g.arc(x + 170, y + 80, 34, 0, 7); g.fill();
    g.fillStyle = '#163a5c'; g.font = `bold 34px ${SANS}`; g.textAlign = 'left'; g.fillText('SUMMER', x + 20, y + 200);
    g.font = `20px ${SANS}`; g.fillText('sale now on', x + 22, y + 228); }
  const t = canvasTex(c); t.generateMipmaps = true;
  return t;
}
const CELLUV = (k) => [(k % 4) / 4, 1 - (Math.floor(k / 4) + 1) / 2];
function remapUV(g, k) { const [u0, v0] = CELLUV(k), uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) / 4 * 0.995 + 0.0006, v0 + uv.getY(i) / 2 * 0.995 + 0.0012); return g; }

// ---------------------------------------------------------------- materials
let MAT = null;
function noFlip(m) { // two-sided cards keep the normals we gave them (no flip on back faces)
  m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', '')); };
  m.customProgramCacheKey = () => 'noflip';
  return m;
}
const TEXDEF = {
  leaf: () => leafTexture(21, 98), leaf2: () => leafTexture(57, 84), needle: () => needleTexture(9), bark: () => barkTexture(),
  concrete: () => noiseTexture('#a7a59f', 60, 4), brick: () => brickTexture(), hedge: () => hedgeTexture(), chain: () => chainTexture(),
  halo: () => haloTexture(), signs: () => signAtlas(), wood: () => noiseTexture('#8a6a4a', 70, 8, 128, 900),
};
const TEX = {};
const texture = (k) => TEX[k] || (TEX[k] = TEXDEF[k]());
function materials() {
  if (MAT) return MAT;
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const tex = {};
  for (const k of Object.keys(TEXDEF)) tex[k] = texture(k);
  MAT = {
    tex,
    paint: S({ vertexColors: true, roughness: 0.5, metalness: 0.15 }),
    steel: S({ vertexColors: true, roughness: 0.42, metalness: 0.75 }),
    plastic: S({ vertexColors: true, roughness: 0.55, metalness: 0.05 }),
    wood: S({ vertexColors: true, roughness: 0.85, metalness: 0, map: tex.wood }),
    concrete: S({ vertexColors: true, roughness: 0.93, metalness: 0, map: tex.concrete }),
    brick: S({ vertexColors: true, roughness: 0.9, metalness: 0, map: tex.brick }),
    bark: S({ vertexColors: true, roughness: 0.95, metalness: 0, map: tex.bark }),
    leaves: noFlip(S({ vertexColors: true, map: tex.leaf, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.78, metalness: 0 })),
    leaves2: noFlip(S({ vertexColors: true, map: tex.leaf2, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.78, metalness: 0 })),
    needles: noFlip(S({ vertexColors: true, map: tex.needle, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 })),
    hedge: S({ vertexColors: true, map: tex.hedge, roughness: 0.95, metalness: 0 }),
    chain: S({ map: tex.chain, alphaTest: 0.4, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.45, metalness: 0.8, color: 0xc4c8cc }),
    sign: S({ vertexColors: true, map: tex.signs, roughness: 0.4, metalness: 0.1 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xd8e6ea, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }),
    wire: S({ color: 0x232323, roughness: 0.55, metalness: 0.4 }),
    lens: new THREE.MeshBasicMaterial({ toneMapped: false }),
    halo: new THREE.MeshBasicMaterial({ map: tex.halo, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xf3efe2 }),
    amber: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.55, 0.08), toneMapped: false }),
  };
  return MAT;
}

// ---------------------------------------------------------------- state
// One state per build. S is the one being built (the placing code writes into it), LIVE the one on screen.
// A build makes a whole new state off screen and swaps it in at the end, so the old props stay drawn meanwhile.
function freshState() {
  return { group: null, groundAt: null, collide: null, roads: null, region: 'other', region0: 'other', left: false,
    bins: new Map(), recs: [], done: new Set(), groups: new Map(), sigMap: new Map(), edge: null,
    wires: [], poleByNode: new Map(), lensBins: new Set(), bld: null };
}
let S = freshState(), LIVE = null, SCENE = null, TOKEN = 0;

// ---------------------------------------------------------------- parts (instanced model pieces)
// Each part: { geo, mat, cast, color (uses instance colour) }. Built on first use.
const PARTDEF = {};
const PARTS = new Map();
function part(name) {
  let p = PARTS.get(name);
  if (!p) { const d = PARTDEF[name]; if (!d) throw new Error('no part ' + name); p = d(); p.name = name; PARTS.set(name, p); }
  return p;
}
const M = () => materials();

// unit pieces used by many props
PARTDEF.tube = () => ({ geo: new GB().add(cyl(1, 1, 1, 8, true)).build(), mat: M().steel, cast: true, color: true });
PARTDEF.tubeP = () => ({ geo: new GB().add(cyl(1, 1, 1, 8, true)).build(), mat: M().paint, cast: true, color: true });
PARTDEF.wire = () => ({ geo: new GB().add(cyl(1, 1, 1, 4, true)).build(), mat: M().wire, cast: false, color: false });
PARTDEF.pole = () => ({ geo: new GB().add(cyl(0.72, 1, 1, 12, false)).build(), mat: M().steel, cast: true, color: true });
PARTDEF.lens = () => ({ geo: new GB().add(new THREE.CircleGeometry(1, 14).rotateY(Math.PI)).build(), mat: M().lens, cast: false, color: true, lens: true });
PARTDEF.halo = () => ({ geo: new GB().add(new THREE.PlaneGeometry(2, 2).rotateY(Math.PI)).build(), mat: M().halo, cast: false, color: true, lens: true });

// Fire hydrant, about 0.8 m (US pattern: barrel, bonnet, two hose outlets and a pumper outlet at the front).
PARTDEF.hydrant = () => {
  const b = new GB(), W = 0xffffff, S2 = 0xd8d8d8;
  b.add(cyl(0.15, 0.16, 0.06, 16), W);
  b.add(cyl(0.105, 0.11, 0.5, 16), W, mat(0, 0.06));
  b.add(cyl(0.135, 0.135, 0.05, 16), W, mat(0, 0.52));
  b.add(new THREE.SphereGeometry(0.12, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), W, mat(0, 0.57));
  b.add(cyl(0.03, 0.03, 0.06, 5), S2, mat(0, 0.67));
  for (const s of [-1, 1]) {
    b.add(cyl(0.04, 0.042, 0.11, 12), W, mat(s * 0.1, 0.4, 0, 0, 0, -s * Math.PI / 2));
    b.add(cyl(0.032, 0.032, 0.03, 6), S2, mat(s * 0.21, 0.4, 0, 0, 0, -s * Math.PI / 2));
  }
  b.add(cyl(0.065, 0.07, 0.12, 14), W, mat(0, 0.35, -0.08, -Math.PI / 2));
  b.add(cyl(0.05, 0.05, 0.03, 6), S2, mat(0, 0.35, -0.21, -Math.PI / 2));
  return { geo: b.build(), mat: M().paint, cast: true, color: true };
};

// Street lamps: a cobra head on a tapered pole with an outreach arm (front of the model is the road side),
// and a post top lantern for footpaths. Built 1:1 at 9 m and 4 m; scaled for other heights.
PARTDEF.lampCobra = () => {
  const b = new GB(), P = 0xffffff;
  b.add(cyl(0.16, 0.2, 0.5, 14), P);
  b.add(cyl(0.065, 0.11, 8.6, 14, true), P, mat(0, 0.5));
  // arm: up and out 2 m towards -z with a gentle rise
  const pts = [V(0, 8.9, 0), V(0, 9.15, -0.6), V(0, 9.3, -1.4), V(0, 9.35, -2.0)];
  for (let i = 0; i < 3; i++) b.add(tubeG(pts[i], pts[i + 1], 0.05, 0.045, 10), P);
  b.add(new THREE.SphereGeometry(0.07, 10, 6), P, mat(0, 8.95, 0));
  // luminaire housing
  const hg = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  b.add(hg, 0xd5d7d8, mat(0, 9.28, -2.35, 0.06, 0, 0, 0.2, 0.11, 0.42));
  b.add(boxc(0.34, 0.03, 0.75), 0x9a9c9e, mat(0, 9.27, -2.35, 0.06));
  return { geo: b.build(), mat: M().steel, cast: true, color: true };
};
// the same luminaire on a bracket arm, for lamps hung on a utility pole (origin at the pole's face, arm along -z)
PARTDEF.lampArm = () => {
  const b = new GB(), P = 0xffffff;
  const pts = [V(0, 0, 0), V(0, 0.25, -0.6), V(0, 0.4, -1.4), V(0, 0.45, -2.0)];
  for (let i = 0; i < 3; i++) b.add(tubeG(pts[i], pts[i + 1], 0.045, 0.04, 8), P);
  b.add(boxc(0.12, 0.3, 0.06), 0x777777, mat(0, 0.05, 0.02));
  b.add(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0xd5d7d8, mat(0, 0.38, -2.35, 0.06, 0, 0, 0.2, 0.11, 0.42));
  b.add(boxc(0.34, 0.03, 0.75), 0x9a9c9e, mat(0, 0.37, -2.35, 0.06));
  b.add(new THREE.CircleGeometry(1, 16).rotateX(Math.PI / 2), 0xf3efe2, mat(0, 0.35, -2.35, 0.06, 0, 0, 0.15, 1, 0.32));
  return { geo: b.build(), mat: M().steel, cast: true, color: false };
};
PARTDEF.lampCobraLens = () => ({ geo: new GB().add(new THREE.CircleGeometry(1, 16).rotateX(Math.PI / 2), 0xffffff, mat(0, 9.25, -2.35, 0.06, 0, 0, 0.15, 1, 0.32)).build(), mat: M().lamp, cast: false, color: false });
PARTDEF.lampPost = () => {
  const b = new GB(), P = 0xffffff;
  b.add(cyl(0.12, 0.16, 0.6, 12), P);
  b.add(cyl(0.05, 0.075, 3.2, 12, true), P, mat(0, 0.6));
  b.add(cyl(0.09, 0.07, 0.15, 12), P, mat(0, 3.75));
  b.add(cyl(0.22, 0.12, 0.08, 8), P, mat(0, 3.9));
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; b.add(boxc(0.015, 0.45, 0.015), P, mat(Math.cos(a) * 0.17, 4.2, Math.sin(a) * 0.17)); }
  b.add(cyl(0.02, 0.26, 0.2, 8), P, mat(0, 4.42));
  b.add(new THREE.SphereGeometry(0.04, 8, 6), P, mat(0, 4.64));
  return { geo: b.build(), mat: M().paint, cast: true, color: true };
};
PARTDEF.lampPostGlass = () => ({ geo: new GB().add(cyl(0.18, 0.13, 0.44, 8, true), 0xffffff, mat(0, 3.98)).build(), mat: M().lamp, cast: false, color: false });

// Traffic signal heads. Vertical 3-lens head (centre origin, lenses at y = +h, 0, -h, front -z) and the
// Japanese horizontal head (lenses at x = +w (green), 0, -w (red)). Lens radius r. Housing colour is the
// instance colour; visors are part of the same geometry.
function headV(r) {
  const b = new GB(), H = 0xffffff, h = r * 2.25, W = r * 2.5, D = 0.24;
  b.add(boxc(W, h * 3 + r * 0.6, D), H);
  for (const y of [h, 0, -h]) {
    const vg = new THREE.CylinderGeometry(r * 1.12, r * 1.12, 0.24, 9, 1, true, Math.PI / 2 - 0.2, Math.PI + 0.4);
    b.add(vg, H, mat(0, y + 0.01, -D / 2 - 0.12, Math.PI / 2, 0, 0));
    b.add(new THREE.RingGeometry(r * 0.98, r * 1.14, 12).rotateY(Math.PI), 0x111111, mat(0, y, -D / 2 - 0.004));
  }
  b.add(boxc(0.08, 0.12, 0.08), H, mat(0, h * 1.5 + r * 0.3 + 0.06, 0));
  return b.build();
}
function headH(r) {
  const b = new GB(), H = 0xffffff, w = r * 2.35, D = 0.2;
  b.add(boxc(w * 3 + r * 0.6, r * 2.5, D), H);
  for (const x of [w, 0, -w]) {
    const vg = new THREE.CylinderGeometry(r * 1.1, r * 1.1, 0.18, 9, 1, true, Math.PI / 2 - 0.2, Math.PI + 0.4);
    b.add(vg, H, mat(x, 0.01, -D / 2 - 0.09, Math.PI / 2, 0, 0));
    b.add(new THREE.RingGeometry(r * 0.98, r * 1.12, 12).rotateY(Math.PI), 0x111111, mat(x, 0, -D / 2 - 0.004));
  }
  return b.build();
}
PARTDEF.headUS = () => ({ geo: headV(0.15), mat: M().plastic, cast: true, color: true });
PARTDEF.headEU = () => ({ geo: headV(0.105), mat: M().plastic, cast: true, color: true });
PARTDEF.headJP = () => ({ geo: headH(0.15), mat: M().steel, cast: true, color: true });
// backboards: black with a retroreflective border (yellow in the US, white in the UK)
function backboard(r, border, h3) {
  const b = new GB(), W = r * 2.5 + 0.26, H = h3 + 0.26;
  b.add(boxc(W, H, 0.012), border, mat(0, 0, 0.13));
  b.add(boxc(W - 0.1, H - 0.1, 0.016), 0x0c0c0c, mat(0, 0, 0.128));
  return b.build();
}
PARTDEF.boardUS = () => ({ geo: backboard(0.15, 0xe2b400, 0.15 * 2.25 * 3 + 0.09), mat: M().plastic, cast: true, color: false });
PARTDEF.boardUK = () => ({ geo: backboard(0.105, 0xf2f2f2, 0.105 * 2.25 * 3 + 0.063), mat: M().plastic, cast: true, color: false });

// Signs. A face (atlas cell) with a bare metal back. Faces front -z, centre origin.
function signG(shape, size, cell) {
  const b = new GB();
  let face;
  if (shape === 'oct') face = new THREE.CircleGeometry(size / 2 / Math.cos(Math.PI / 8), 8, Math.PI / 8);
  else if (shape === 'tri') face = new THREE.CircleGeometry(size / Math.sqrt(3), 3, -Math.PI / 2);
  else face = new THREE.PlaneGeometry(size, size * 1.0);
  const back = face.clone();
  b.add(remapUV(face.rotateY(Math.PI), cell), 0xffffff, mat(0, 0, -0.004));
  b.add(remapUV(back, 6), 0xffffff, mat(0, 0, 0.004));
  return b.build();
}
PARTDEF.signStop = () => ({ geo: signG('oct', 0.76, 0), mat: M().sign, cast: true, color: false });
PARTDEF.signYield = () => ({ geo: signG('tri', 0.91, 1), mat: M().sign, cast: true, color: false });
PARTDEF.signGive = () => ({ geo: signG('tri', 0.9, 2), mat: M().sign, cast: true, color: false });
PARTDEF.signGiveUK = () => ({ geo: signG('tri', 0.9, 3), mat: M().sign, cast: true, color: false });
PARTDEF.signStopJP = () => ({ geo: signG('tri', 0.8, 4), mat: M().sign, cast: true, color: false });
PARTDEF.signBus = () => {
  const b = new GB(), f = new THREE.PlaneGeometry(0.45, 0.45), k = f.clone();
  b.add(remapUV(f.rotateY(Math.PI), 5), 0xffffff, mat(0, 0, -0.006));
  b.add(remapUV(k, 5), 0xffffff, mat(0, 0, 0.006));
  return { geo: b.build(), mat: M().sign, cast: true, color: false };
};

// Utility pole (wood or concrete, 12 m): crossarm 2.4 m across the line (local x), three pin insulators,
// a lower communications bracket. Transformer can as its own part.
function uPoleGeo() {
  const b = new GB();
  b.add(cyl(0.11, 0.16, 12, 10), 0xffffff);
  b.add(boxc(2.4, 0.1, 0.12), 0xffffff, mat(0, 11.35, 0));
  for (const s of [-1, 1]) b.add(tubeG(V(0, 10.6, 0.07), V(s * 0.75, 11.3, 0.07), 0.025, 0.025, 5), 0x6a6a6a);
  b.add(boxc(0.12, 0.25, 0.25), 0x555555, mat(0, 6.5, 0.15));
  return b.build();
}
PARTDEF.uPole = () => ({ geo: uPoleGeo(), mat: M().wood, cast: true, color: true });
PARTDEF.uPoleC = () => ({ geo: uPoleGeo(), mat: M().concrete, cast: true, color: true }); // concrete poles (Japan, Europe)
PARTDEF.insulators = () => {
  const b = new GB(), G = 0x9cb6a6;
  for (const x of [-1.05, 0, 1.05]) { b.add(cyl(0.012, 0.012, 0.1, 6), 0x777777, mat(x, 11.4)); b.add(cyl(0.035, 0.06, 0.06, 10), G, mat(x, 11.47)); b.add(cyl(0.04, 0.05, 0.05, 10), G, mat(x, 11.53)); }
  return { geo: b.build(), mat: M().plastic, cast: false, color: false };
};
PARTDEF.transformer = () => {
  const b = new GB(), G = 0x8a9094;
  b.add(cyl(0.27, 0.27, 0.9, 14), G, mat(0, 0, 0));
  b.add(cyl(0.29, 0.29, 0.05, 14), G, mat(0, 0.9));
  b.add(boxc(0.1, 0.5, 0.12), 0x666666, mat(0, 0.4, 0.28));
  for (const x of [-0.12, 0.12]) b.add(cyl(0.03, 0.04, 0.16, 8), 0x7a7a7a, mat(x, 0.95));
  return { geo: b.build(), mat: M().steel, cast: true, color: false };
};
// Lattice power tower, 32 m: four tapering legs, horizontal struts, X bracing on every face, two crossarms
// and an earth wire peak. Conductors hang on insulator strings at the arm tips.
const TOWER = { arms: [[21, 6.6], [26.5, 5.2]], top: 32 };
PARTDEF.tower = () => {
  const b = new GB(), C = 0x9a9fa3, legW = (y) => y < 20 ? 3.6 - (3.6 - 1.15) * (y / 20) : 1.15 - (y - 20) * 0.04;
  const levels = [0, 3.5, 7, 10.5, 14, 17, 20, 23, 26.5, 29.5];
  const corner = (y, i) => { const w = legW(y); return V(i & 1 ? w : -w, y, i & 2 ? w : -w); };
  const bar = (a, c, r = 0.045) => b.add(tubeG(a, c, r, r, 4), C);
  for (let i = 0; i < 4; i++) for (let l = 0; l < levels.length - 1; l++) bar(corner(levels[l], i), corner(levels[l + 1], i), 0.08);
  const faces = [[0, 1], [1, 3], [3, 2], [2, 0]];
  for (let l = 0; l < levels.length - 1; l++) for (const [i, j] of faces) {
    const a0 = corner(levels[l], i), b0 = corner(levels[l], j), a1 = corner(levels[l + 1], i), b1 = corner(levels[l + 1], j);
    bar(a0, b1); bar(b0, a1); bar(a1, b1, 0.04);
  }
  for (const [y, w] of TOWER.arms) {
    for (const s of [-1, 1]) {
      const c0 = legW(y);
      bar(V(s * c0, y, -0.8), V(s * w, y, 0), 0.06); bar(V(s * c0, y, 0.8), V(s * w, y, 0), 0.06);
      bar(V(s * c0, y + 1.6, -0.6), V(s * w, y, 0), 0.05); bar(V(s * c0, y + 1.6, 0.6), V(s * w, y, 0), 0.05);
      // insulator string
      b.add(cyl(0.09, 0.09, 2.2, 8), 0x9aa59a, mat(s * w, y - 2.2));
    }
  }
  bar(corner(29.5, 0), V(0, TOWER.top, 0)); bar(corner(29.5, 1), V(0, TOWER.top, 0)); bar(corner(29.5, 2), V(0, TOWER.top, 0)); bar(corner(29.5, 3), V(0, TOWER.top, 0));
  return { geo: b.build(), mat: M().steel, cast: true, color: false };
};

// UK Belisha beacon: a black and white banded pole with an amber globe (zebra crossings).
PARTDEF.belisha = () => {
  const b = new GB();
  b.add(cyl(0.09, 0.11, 0.25, 12), 0x111111);
  for (let i = 0; i < 9; i++) b.add(cyl(0.045, 0.045, 0.27, 10, true), i % 2 ? 0x111111 : 0xf2f2f2, mat(0, 0.25 + i * 0.27));
  b.add(cyl(0.05, 0.05, 0.08, 10), 0x111111, mat(0, 2.68));
  return { geo: b.build(), mat: M().paint, cast: true, color: false };
};
PARTDEF.belishaGlobe = () => ({ geo: new GB().add(new THREE.SphereGeometry(0.17, 16, 10), 0xffffff, mat(0, 2.92)).build(), mat: M().amber, cast: false, color: false });
// Bollard 0.9 m with a reflective band.
PARTDEF.bollard = () => {
  const b = new GB();
  b.add(cyl(0.1, 0.1, 0.82, 14), 0xffffff);
  b.add(new THREE.SphereGeometry(0.1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0xffffff, mat(0, 0.82));
  b.add(cyl(0.102, 0.102, 0.06, 14, true), 0xf0f0f0, mat(0, 0.68));
  return { geo: b.build(), mat: M().paint, cast: true, color: true };
};
// Bench 1.8 m: cast end frames and a backrest (front -z is the seat side).
PARTDEF.benchFrame = () => {
  const b = new GB(), F = 0x1d2224;
  for (const x of [-0.75, 0.75]) {
    b.add(boxc(0.05, 0.45, 0.05), F, mat(x, 0.225, -0.2));
    b.add(boxc(0.05, 0.85, 0.05), F, mat(x, 0.43, 0.24, 0.18));
    b.add(boxc(0.05, 0.05, 0.5), F, mat(x, 0.43, 0.0));
    b.add(boxc(0.05, 0.04, 0.4), F, mat(x, 0.66, -0.02));
  }
  return { geo: b.build(), mat: M().paint, cast: true, color: false };
};
function benchSlats(back) {
  const b = new GB(), r = rng(4);
  const tone = () => new THREE.Color().setHSL(0.07, 0.45, 0.32 + r() * 0.06);
  for (let i = 0; i < 4; i++) b.add(boxM(1.8, 0.035, 0.09), tone(), mat(0, 0.455, -0.17 + i * 0.105));
  if (back) for (let i = 0; i < 3; i++) b.add(boxM(1.8, 0.09, 0.03), tone(), mat(0, 0.6 + i * 0.12, 0.25 + i * 0.022, 0.18));
  return { geo: b.build(), mat: M().wood, cast: true, color: false };
}
PARTDEF.benchSlats = () => benchSlats(true);
PARTDEF.benchSeat = () => benchSlats(false);
// Litter bin, 0.9 m.
PARTDEF.bin = () => {
  const b = new GB(), C = 0xffffff;
  b.add(cyl(0.23, 0.2, 0.82, 16), C);
  b.add(cyl(0.25, 0.25, 0.08, 16), C, mat(0, 0.82));
  b.add(cyl(0.12, 0.24, 0.06, 16), C, mat(0, 0.9));
  b.add(boxc(0.2, 0.08, 0.02), 0x111111, mat(0, 0.86, -0.25));
  return { geo: b.build(), mat: M().paint, cast: true, color: true };
};
// Post boxes by country.
PARTDEF.postUS = () => {
  const b = new GB(), C = 0x0b4b8f, L = 0x16365c;
  b.add(boxc(0.5, 0.86, 0.48), C, mat(0, 0.6, 0));
  b.add(new THREE.CylinderGeometry(0.25, 0.25, 0.48, 18, 1, false, 0, Math.PI), C, new THREE.Matrix4().makeRotationZ(Math.PI / 2).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)).setPosition(0, 1.03, 0));
  for (const x of [-0.22, 0.22]) for (const z of [-0.2, 0.2]) b.add(boxc(0.04, 0.17, 0.04), L, mat(x, 0.085, z));
  b.add(boxc(0.34, 0.12, 0.08), L, mat(0, 0.96, -0.25, -0.5));
  return { geo: b.build(), mat: M().paint, cast: true, color: false };
};
PARTDEF.postUK = () => {
  const b = new GB(), C = 0xa50d18;
  b.add(cyl(0.3, 0.3, 0.12, 20), 0x1b1b1b);
  b.add(cyl(0.27, 0.27, 1.2, 20), C, mat(0, 0.12));
  b.add(cyl(0.31, 0.29, 0.08, 20), C, mat(0, 1.32));
  b.add(new THREE.SphereGeometry(0.29, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), C, mat(0, 1.4, 0, 0, 0, 0, 1, 0.45, 1));
  b.add(boxc(0.24, 0.04, 0.04), 0x111111, mat(0, 1.15, -0.26));
  b.add(boxc(0.2, 0.14, 0.02), 0xf0f0f0, mat(0, 0.92, -0.27));
  return { geo: b.build(), mat: M().paint, cast: true, color: false };
};
PARTDEF.postEU = () => {
  const b = new GB(), C = 0xf5c400;
  b.add(cyl(0.035, 0.035, 1.0, 10), 0x6d7378);
  b.add(boxc(0.46, 0.58, 0.32), C, mat(0, 0.9, 0));
  b.add(boxc(0.48, 0.05, 0.36), C, mat(0, 1.48, 0));
  b.add(boxc(0.26, 0.03, 0.03), 0x222222, mat(0, 1.34, -0.17));
  return { geo: b.build(), mat: M().paint, cast: true, color: false };
};
PARTDEF.postJP = () => {
  const b = new GB(), C = 0xd2201e;
  b.add(boxc(0.3, 0.35, 0.3), C);
  b.add(boxc(0.44, 0.9, 0.38), C, mat(0, 0.35));
  b.add(boxc(0.48, 0.06, 0.42), C, mat(0, 1.25));
  for (const z of [-0.2]) b.add(boxc(0.28, 0.04, 0.02), 0x111111, mat(0, 1.08, z));
  return { geo: b.build(), mat: M().paint, cast: true, color: false };
};
// UK K6 telephone kiosk and a plain payphone pedestal elsewhere.
PARTDEF.kiosk = () => {
  const b = new GB(), R = 0xb00e1a;
  b.add(box(1.0, 0.12, 1.0), R);
  for (const x of [-0.45, 0.45]) for (const z of [-0.45, 0.45]) b.add(box(0.1, 2.2, 0.1), R, mat(x, 0.12, z));
  for (let f = 0; f < 4; f++) {
    const a = f * Math.PI / 2, ry = a;
    for (let j = 0; j < 8; j++) b.add(boxc(0.8, 0.03, 0.04), R, mat(Math.sin(a) * 0.45, 0.4 + j * 0.24, Math.cos(a) * 0.45, 0, ry));
    for (const x of [-0.26, 0, 0.26]) b.add(boxc(0.03, 1.7, 0.04), R, new THREE.Matrix4().makeRotationY(ry).multiply(mat(x, 1.27, 0.45)));
    b.add(boxc(0.6, 0.12, 0.05), 0xf2f2f2, new THREE.Matrix4().makeRotationY(ry).multiply(mat(0, 2.2, 0.47)));
  }
  b.add(box(1.04, 0.14, 1.04), R, mat(0, 2.32));
  b.add(new THREE.SphereGeometry(0.62, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), R, mat(0, 2.46, 0, 0, Math.PI / 4, 0, 1, 0.28, 1));
  return { geo: b.build(), mat: M().paint, cast: true, color: false };
};
PARTDEF.kioskGlass = () => {
  const b = new GB();
  for (let f = 0; f < 4; f++) b.add(new THREE.PlaneGeometry(0.8, 1.75), 0xffffff, new THREE.Matrix4().makeRotationY(f * Math.PI / 2).multiply(mat(0, 1.26, 0.445)));
  return { geo: b.build(), mat: M().glass, cast: false, color: false };
};
PARTDEF.payphone = () => {
  const b = new GB();
  b.add(cyl(0.06, 0.06, 1.1, 10), 0x777b80);
  b.add(boxc(0.3, 0.55, 0.18), 0x8d9297, mat(0, 1.35, 0));
  b.add(boxc(0.42, 0.06, 0.32), 0x5d6267, mat(0, 1.66, -0.04));
  return { geo: b.build(), mat: M().steel, cast: true, color: false };
};
// Bus shelter 3.6 x 1.5 x 2.5: steel frame, roof, bench; glass panels as their own part. Open side is -z.
PARTDEF.shelter = () => {
  const b = new GB(), F = 0x50575c;
  for (const x of [-1.75, 1.75]) for (const z of [-0.65, 0.65]) b.add(box(0.07, 2.4, 0.07), F, mat(x, 0, z));
  b.add(box(0.07, 2.4, 0.07), F, mat(0, 0, 0.65));
  b.add(box(3.75, 0.1, 1.6), 0x3a3f42, mat(0, 2.4, 0));
  b.add(box(3.6, 0.05, 0.05), F, mat(0, 0.12, 0.65));
  b.add(boxc(1.6, 0.04, 0.32), 0x9a9fa3, mat(-0.6, 0.47, 0.42));
  b.add(boxc(0.04, 0.45, 0.04), F, mat(-1.3, 0.24, 0.42)); b.add(boxc(0.04, 0.45, 0.04), F, mat(0.1, 0.24, 0.42));
  b.add(boxc(0.06, 1.85, 1.2), 0x3a3f42, mat(1.77, 1.25, 0));
  return { geo: b.build(), mat: M().steel, cast: true, color: false };
};
// poster panel at the open end, both faces
PARTDEF.shelterAd = () => {
  const b = new GB();
  b.add(remapUV(new THREE.PlaneGeometry(1.15, 1.75), 7), 0xffffff, mat(1.735, 1.25, 0, 0, -Math.PI / 2));
  b.add(remapUV(new THREE.PlaneGeometry(1.15, 1.75), 7), 0xffffff, mat(1.805, 1.25, 0, 0, Math.PI / 2));
  return { geo: b.build(), mat: M().sign, cast: false, color: false };
};
PARTDEF.shelterGlass = () => {
  const b = new GB();
  for (const x of [-0.875, 0.875]) b.add(new THREE.PlaneGeometry(1.68, 2.1), 0xffffff, mat(x, 1.3, 0.65));
  b.add(new THREE.PlaneGeometry(1.25, 2.1), 0xffffff, mat(-1.75, 1.3, 0, 0, Math.PI / 2));
  return { geo: b.build(), mat: M().glass, cast: false, color: false };
};

// ---- trees. Normalised to 10 m; scaled per instance. Trunk part + crown part (instance colour tints leaves).
function crownCards(b, seed, c, R, n, size, opts = {}) {
  const r = rng(seed), pos = [], nor = [], uv = [], colr = [], idx = [];
  const nrm = new THREE.Vector3(), u = new THREE.Vector3(), v = new THREE.Vector3(), p = new THREE.Vector3(), o = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    // a point in the ellipsoid, mostly towards the shell
    let x, y, z, d;
    do { x = r() * 2 - 1; y = r() * 2 - 1; z = r() * 2 - 1; d = x * x + y * y + z * z; } while (d > 1 || d < 0.02);
    const sh = 0.5 + 0.5 * Math.pow(r(), 0.45), k = sh / Math.sqrt(d);
    o.set(x * k, y * k, z * k); // unit ellipsoid coords
    if (opts.flatBottom && o.y < -0.55) o.y = -0.55 + (o.y + 0.55) * 0.3;
    p.set(c.x + o.x * R.x, c.y + o.y * R.y, c.z + o.z * R.z);
    nrm.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize();
    u.set(0, 1, 0).cross(nrm); if (u.lengthSq() < 0.01) u.set(1, 0, 0); u.normalize(); v.copy(nrm).cross(u).normalize();
    const ang = r() * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang);
    const uu = u.clone().multiplyScalar(ca).addScaledVector(v, sa), vv = v.clone().multiplyScalar(ca).addScaledVector(u, -sa);
    const s = size * (0.75 + r() * 0.5) / 2;
    // shading normal: outward from the crown centre, a little of the card's own
    const out = new THREE.Vector3(o.x / R.x, o.y / R.y + 0.15, o.z / R.z).normalize().multiplyScalar(0.85).addScaledVector(nrm, 0.15).normalize();
    const shell = Math.min(1, o.length()), ao = clamp(0.25 + 0.75 * Math.pow(shell, 1.5) * (0.7 + 0.3 * o.y), 0.22, 1.0);
    const base = pos.length / 3;
    for (const [a, bb, tu, tv] of [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]]) {
      pos.push(p.x + uu.x * a * s + vv.x * bb * s, p.y + uu.y * a * s + vv.y * bb * s, p.z + uu.z * a * s + vv.z * bb * s);
      nor.push(out.x, out.y, out.z); uv.push(tu, tv); colr.push(ao, ao, ao);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.setIndex(idx);
  b.add(g);
}
function broadTrunk(seed, crownBase, c, R) {
  const b = new GB(), r = rng(seed), C = 0xffffff;
  const top = V((r() - 0.5) * 0.3, crownBase, (r() - 0.5) * 0.3);
  b.add(tubeG(V(0, -0.2, 0), top, 0.22, 0.15, 12), C);
  b.add(cyl(0.2, 0.3, 0.35, 12), C, mat(0, -0.1));
  const nb = 5 + Math.floor(r() * 3);
  for (let i = 0; i < nb; i++) {
    const a = i / nb * Math.PI * 2 + r() * 0.6, el = 0.75 + r() * 0.5, L = 1.8 + r() * 1.2;
    const s = top.clone().add(V(0, -r() * 0.4, 0));
    const e = s.clone().add(V(Math.cos(a) * Math.cos(el) * L * R.x / 3, Math.sin(el) * L, Math.sin(a) * Math.cos(el) * L * R.z / 3));
    b.add(tubeG(s, e, 0.09, 0.05, 7), C);
    const a2 = a + (r() - 0.5) * 1.2, e2 = e.clone().add(V(Math.cos(a2) * 1.2 * R.x / 3, 0.6 + r() * 0.9, Math.sin(a2) * 1.2 * R.z / 3));
    b.add(tubeG(e, e2, 0.05, 0.025, 5), C);
  }
  b.add(tubeG(top, V(c.x, c.y + R.y * 0.6, c.z), 0.12, 0.03, 8), C);
  return b.build();
}
const TREES = {
  // round crown street tree (plane, maple, oak)
  round: { c: V(0, 6.4, 0), R: V(3.3, 2.9, 3.3), base: 3.0, n: 230, size: 2.0, mat: 'leaves' },
  // taller oval crown (lime, ash, birch)
  oval: { c: V(0, 6.7, 0), R: V(2.3, 3.4, 2.3), base: 2.6, n: 200, size: 1.8, mat: 'leaves2' },
};
PARTDEF.trunkRound = () => ({ geo: broadTrunk(3, TREES.round.base, TREES.round.c, TREES.round.R), mat: M().bark, cast: true, color: false });
PARTDEF.trunkOval = () => ({ geo: broadTrunk(8, TREES.oval.base, TREES.oval.c, TREES.oval.R), mat: M().bark, cast: true, color: false });
PARTDEF.crownRound = () => { const b = new GB(), t = TREES.round; crownCards(b, 12, t.c, t.R, t.n, t.size, { flatBottom: true }); return { geo: b.build(), mat: M()[t.mat], cast: true, color: true }; };
PARTDEF.crownOval = () => { const b = new GB(), t = TREES.oval; crownCards(b, 31, t.c, t.R, t.n, t.size, {}); return { geo: b.build(), mat: M()[t.mat], cast: true, color: true }; };
// conifer: straight trunk, tiers of drooping branch cards
PARTDEF.trunkCone = () => ({ geo: new GB().add(tubeG(V(0, -0.2, 0), V(0, 10.2, 0), 0.24, 0.02, 10)).build(), mat: M().bark, cast: true, color: false });
PARTDEF.crownCone = () => {
  const r = rng(17), pos = [], nor = [], uv = [], colr = [], idx = [];
  for (let y = 1.4, t = 0; y < 9.9; y += 0.42, t++) {
    const R = 2.5 * Math.pow((10.2 - y) / 8.8, 1.05) + 0.25, nb = Math.max(4, Math.round(5 + R * 1.6));
    for (let k = 0; k < nb; k++) {
      const a = k / nb * Math.PI * 2 + t * 0.7 + r() * 0.4, L = R * (0.8 + r() * 0.35), w = 0.55 + 0.45 * Math.min(1, R / 2.2);
      const dx = Math.cos(a), dz = Math.sin(a), droop = 0.35 + r() * 0.2;
      const tip = V(dx * L, y - L * droop, dz * L), lat = V(-dz, 0.25, dx).normalize().multiplyScalar(w / 2);
      const n0 = V(dx * 0.6, 0.8, dz * 0.6).normalize();
      const ao = clamp(0.45 + 0.6 * (y / 10) * 0.6 + 0.25, 0.4, 1.05);
      const base = pos.length / 3, y0 = y + 0.05;
      const P = [[-lat.x * 0.4, y0 - lat.y * 0.4, -lat.z * 0.4], [lat.x * 0.4, y0 + lat.y * 0.4, lat.z * 0.4], [tip.x + lat.x, tip.y + lat.y, tip.z + lat.z], [tip.x - lat.x, tip.y - lat.y, tip.z - lat.z]];
      const U = [[0, 0.2], [0, 0.8], [1, 1], [1, 0]];
      for (let i = 0; i < 4; i++) { pos.push(...P[i]); nor.push(n0.x, n0.y, n0.z); uv.push(...U[i]); colr.push(ao * (i < 2 ? 0.7 : 1), ao * (i < 2 ? 0.7 : 1), ao * (i < 2 ? 0.7 : 1)); }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3)); g.setIndex(idx);
  return { geo: new GB().add(g).build(), mat: M().needles, cast: true, color: true };
};
// palm (Washingtonia / Phoenix): ringed trunk, a head of arching frond cards
PARTDEF.trunkPalm = () => {
  const b = new GB();
  const pts = [V(0, -0.2, 0), V(0.1, 3, 0), V(0.25, 6, 0.05), V(0.3, 9.4, 0.1)];
  for (let i = 0; i < 3; i++) b.add(tubeG(pts[i], pts[i + 1], 0.26 - i * 0.03, 0.23 - i * 0.03, 10), 0xb5a58d);
  b.add(new THREE.SphereGeometry(0.42, 10, 8), 0x6f6248, mat(0.3, 9.4, 0.1, 0, 0, 0, 1, 1.3, 1));
  return { geo: b.build(), mat: M().bark, cast: true, color: false };
};
PARTDEF.crownPalm = () => {
  const r = rng(5), pos = [], nor = [], uv = [], colr = [], idx = [];
  const top = V(0.3, 9.5, 0.1);
  for (let k = 0; k < 18; k++) {
    const a = k / 18 * Math.PI * 2 + r() * 0.3, el = 0.9 - (k % 3) * 0.45 + r() * 0.2, L = 3.2 + r() * 0.8, w = 0.75;
    const dx = Math.cos(a), dz = Math.sin(a), lat = V(-dz, 0, dx).multiplyScalar(w);
    const seg = 4;
    for (let s = 0; s < seg; s++) {
      const t0 = s / seg, t1 = (s + 1) / seg;
      const P = (t) => V(top.x + dx * L * t, top.y + Math.sin(el) * L * t - 2.6 * t * t, top.z + dz * L * t);
      const a0 = P(t0), a1 = P(t1), w0 = 1 - t0 * 0.6, w1 = 1 - t1 * 0.6;
      const base = pos.length / 3;
      const Q = [a0.clone().addScaledVector(lat, -w0), a0.clone().addScaledVector(lat, w0), a1.clone().addScaledVector(lat, w1), a1.clone().addScaledVector(lat, -w1)];
      const U = [[t0, 0], [t0, 1], [t1, 1], [t1, 0]];
      for (let i = 0; i < 4; i++) { pos.push(Q[i].x, Q[i].y, Q[i].z); nor.push(dx * 0.4, 0.9, dz * 0.4); uv.push(0.5 + (U[i][1] - 0.5) * 0.5, 0.25 + U[i][0] * 0.5); colr.push(0.9, 0.95, 0.75); }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3)); g.setIndex(idx);
  return { geo: new GB().add(g).build(), mat: M().needles, cast: true, color: true };
};

// ---- linear barriers: unit pieces Lnom long along +x from 0, height in metres, thickness along z (centred).
const LIN = {
  chain: { L: 3.0, H: 1.8 }, wood: { L: 2.4, H: 1.8 }, rail: { L: 2.0, H: 1.1 }, picket: { L: 2.4, H: 1.0 },
  wall: { L: 4.0, H: 1.0 }, hedge: { L: 3.0, H: 1.0 }, guard: { L: 1.905, H: 1.0 },
};
PARTDEF.chainPost = () => {
  const b = new GB(), C = 0xffffff;
  b.add(cyl(0.03, 0.03, 1.85, 8), C);
  b.add(cyl(0.035, 0.035, 0.04, 8), C, mat(0, 1.85));
  b.add(tubeG(V(0, 1.78, 0), V(3.0, 1.78, 0), 0.02, 0.02, 6), C);
  return { geo: b.build(), mat: M().steel, cast: true, color: false };
};
PARTDEF.chainEnd = () => ({ geo: new GB().add(cyl(0.03, 0.03, 1.85, 8)).add(cyl(0.035, 0.035, 0.04, 8), 0xffffff, mat(0, 1.85)).build(), mat: M().steel, cast: true, color: false });
PARTDEF.chainMesh = () => {
  const g = new THREE.PlaneGeometry(3.0, 1.75).translate(1.5, 0.9, 0), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3.0 / 0.06, uv.getY(i) * 1.75 / 0.06);
  return { geo: new GB().add(g).build(), mat: M().chain, cast: true, color: false };
};
PARTDEF.woodPanel = () => {
  const b = new GB(), r = rng(9);
  const tone = () => new THREE.Color().setHSL(0.075, 0.35 + r() * 0.1, 0.36 + r() * 0.1);
  b.add(box(0.1, 1.9, 0.1), tone(), mat(0.05, 0, 0.06));
  for (const y of [0.3, 1.5]) b.add(boxM(2.4, 0.09, 0.04), tone(), mat(1.2, y, 0.05));
  for (let x = 0.07; x < 2.4; x += 0.15) b.add(boxM(0.14, 1.8, 0.018), tone(), mat(x + 0.07, 0.95, 0));
  return { geo: b.build(), mat: M().wood, cast: true, color: true };
};
PARTDEF.picketPanel = () => {
  const b = new GB();
  b.add(box(0.09, 1.05, 0.09), 0xffffff, mat(0.045, 0, 0.05));
  for (const y of [0.25, 0.75]) b.add(boxM(2.4, 0.07, 0.035), 0xffffff, mat(1.2, y, 0.04));
  for (let x = 0.08; x < 2.4; x += 0.13) { b.add(box(0.075, 0.9, 0.02), 0xffffff, mat(x + 0.04, 0.02, 0)); b.add(new THREE.ConeGeometry(0.053, 0.08, 4), 0xffffff, mat(x + 0.04, 0.96, 0, 0, Math.PI / 4)); }
  return { geo: b.build(), mat: M().paint, cast: true, color: true };
};
PARTDEF.railPanel = () => {
  const b = new GB(), C = 0xffffff;
  b.add(box(0.05, 1.12, 0.05), C, mat(0.025, 0, 0));
  for (const y of [0.12, 1.02]) b.add(tubeG(V(0, y, 0), V(2.0, y, 0), 0.02, 0.02, 6), C);
  for (let x = 0.125; x < 2.0; x += 0.125) b.add(cyl(0.009, 0.009, 0.9, 5, true), C, mat(x, 0.12));
  return { geo: b.build(), mat: M().steel, cast: true, color: true };
};
PARTDEF.wallPiece = () => {
  const b = new GB();
  b.add(boxM(4.0, 1.9, 1.0).translate(2.0, 0.95, 0), 0xffffff);
  return { geo: b.build(), mat: M().concrete, cast: true, color: true };
};
PARTDEF.brickPiece = () => {
  const b = new GB();
  b.add(boxM(4.0, 1.9, 1.0).translate(2.0, 0.95, 0), 0xffffff);
  return { geo: b.build(), mat: M().brick, cast: true, color: true };
};
PARTDEF.wallCap = () => ({ geo: new GB().add(boxM(4.0, 0.06, 1.25).translate(2.0, 0.03, 0), 0xd0cdc6).build(), mat: M().concrete, cast: true, color: false });
PARTDEF.hedgePiece = () => {
  const b = new GB();
  b.add(boxM(3.0, 1.0, 1.0, 1, 1).translate(1.5, 0.5, 0), 0xffffff);
  return { geo: b.build(), mat: M().hedge, cast: true, color: true };
};
PARTDEF.hedgeFuzz = () => {
  const b = new GB();
  // cards over the top and both faces to break up the box outline
  crownCards(b, 41, V(1.5, 0.82, 0), V(1.55, 0.26, 0.55), 26, 0.9);
  crownCards(b, 42, V(1.5, 0.45, 0), V(1.55, 0.45, 0.52), 18, 0.8);
  return { geo: b.build(), mat: M().leaves2, cast: false, color: true };
};
// W-beam guard rail on steel posts every 1.905 m (rail face is +z).
PARTDEF.guardRail = () => {
  const prof = [[-0.01, -0.155], [0.05, -0.12], [0.075, -0.08], [0.03, -0.01], [0.03, 0.01], [0.075, 0.08], [0.05, 0.12], [-0.01, 0.155]];
  const pos = [], uv = [], idx = [], n = prof.length;
  for (const x of [0, 1.905]) for (let i = 0; i < n; i++) { pos.push(x, 0.55 + prof[i][1], 0.18 + prof[i][0]); uv.push(x, i / (n - 1)); }
  for (let i = 0; i < n - 1; i++) idx.push(i, i + 1, n + i + 1, i, n + i + 1, n + i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const b = new GB();
  b.add(g, 0xc9ccce);
  const back = g.clone(); back.setIndex(idx.slice().reverse()); back.computeVertexNormals(); back.translate(0, 0, -0.004);
  b.add(back, 0xb8bbbd);
  b.add(box(0.15, 0.75, 0.1), 0x9da2a5, mat(0, -0.05, 0));
  b.add(boxc(0.15, 0.36, 0.15), 0x9da2a5, mat(0, 0.55, 0.1));
  return { geo: b.build(), mat: M().steel, cast: true, color: false };
};

// ---------------------------------------------------------------- bins and records
// A record is one placed thing: anchor points (sampled for height), an emit function that writes its instances
// given the heights, and collision shapes whose height range follows the ground.
function binKey(x, z) { return Math.floor(x / BIN) + ',' + Math.floor(z / BIN); }
function getBin(k) {
  let b = S.bins.get(k);
  if (!b) { b = { key: k, recs: [], meshes: new Map(), lens: null, dirty: true }; S.bins.set(k, b); }
  return b;
}
function heightAt(x, z) {
  let h = S.groundAt ? S.groundAt(x, z) : 0;
  if (h == null || !isFinite(h)) return null;
  const r = S.roads;
  if (r && r.surfaceAt) {
    try { const s = r.surfaceAt(x, z); if (s && s.h != null && isFinite(s.h) && s.h > h && s.h - h < 0.6) h = s.h; } catch (e) {}
  }
  return h;
}
function sample(rec) {
  rec.ok = true;
  for (let i = 0; i < rec.pts.length; i++) {
    const h = heightAt(rec.pts[i][0], rec.pts[i][1]);
    if (h == null) { rec.ok = false; rec.ys[i] = rec.ys[i] ?? 0; } else rec.ys[i] = h;
  }
  if (rec.cols) for (const c of rec.cols) {
    if (!c.s) continue;
    if (rec.ok) { c.s.y0 = rec.ys[c.i] - 0.3; c.s.y1 = rec.ys[c.i] + c.h; } else { c.s.y0 = -1e4; c.s.y1 = 1e4; }
  }
}
function addRec(pts, emit, extra) {
  const rec = { pts, ys: new Array(pts.length), emit, cols: null, ok: false, ...extra };
  sample(rec);
  const k = binKey(pts[0][0], pts[0][1]);
  rec.bin = k;
  const b = getBin(k); b.recs.push(rec); b.dirty = true;
  S.recs.push(rec);
  return rec;
}
function circle(rec, x, z, r, h, i = 0) {
  const c = S.collide; if (!c || !c.addCircle) return;
  const y = rec.ok ? rec.ys[i] : null;
  const s = c.addCircle(x, z, r, y != null ? y - 0.3 : -1e4, y != null ? y + h : 1e4, 'prop');
  (rec.cols || (rec.cols = [])).push({ s, i, h });
}
function segment(rec, a, b, th, h, i = 0) {
  const c = S.collide; if (!c || !c.addSegment) return;
  const y = rec.ok ? Math.min(rec.ys[i], rec.ys[Math.min(i + 1, rec.ys.length - 1)]) : null;
  const s = c.addSegment(a, b, th, y != null ? y - 0.3 : -1e4, y != null ? y + h : 1e4, 'prop');
  (rec.cols || (rec.cols = [])).push({ s, i, h });
}

// emission into the bin being rebuilt
let OUT = null;
const _mm = new THREE.Matrix4(), _pp = new THREE.Vector3(), _qq = new THREE.Quaternion(), _ss = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);
function emit(name, m, c, meta) {
  let o = OUT.get(name);
  if (!o) { o = { m: [], c: [], meta: [] }; OUT.set(name, o); }
  const e = m.elements; for (let i = 0; i < 16; i++) o.m.push(e[i]);
  if (c) o.c.push(c.r, c.g, c.b); else o.c.push(1, 1, 1);
  if (meta) o.meta.push(meta);
}
function base(x, y, z, yaw, sx = 1, sy = sx, sz = sx, out = _mm) {
  return out.compose(_pp.set(x, y, z), _qq.setFromAxisAngle(_Y, -yaw * D2R), _ss.set(sx, sy, sz));
}
// matrix for a linear piece from a to b (heights ya, yb), height scale sy, thickness sz, nominal length L
function spanMat(ax, ya, az, bx, yb, bz, L, sy, sz, yOff = 0, out = _mm) {
  const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1e-6, nx = -dz / l, nz = dx / l;
  return out.set(dx / L, 0, nx * sz, ax, (yb - ya) / L, sy, 0, ya + yOff, dz / L, 0, nz * sz, az, 0, 0, 0, 1);
}

function rebuildBin(b) {
  b.dirty = false;
  OUT = new Map();
  for (const rec of b.recs) { try { rec.emit(rec); } catch (e) { console.warn('props emit', e); } }
  const keep = new Set();
  for (const [name, o] of OUT) {
    const p = part(name), n = o.m.length / 16;
    let mesh = b.meshes.get(name);
    if (!mesh || mesh.instanceMatrix.count < n) {
      if (mesh) { S.group.remove(mesh); mesh.dispose(); }
      mesh = new THREE.InstancedMesh(p.geo, p.mat, Math.ceil(n * 1.1) + 2);
      mesh.name = 'props:' + name; mesh.castShadow = !!p.cast; mesh.receiveShadow = !p.lens;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      if (p.color) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count * 3), 3);
      if (p.lens) mesh.renderOrder = 2;
      S.group.add(mesh); b.meshes.set(name, mesh);
    }
    mesh.instanceMatrix.array.set(o.m); mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) { mesh.instanceColor.array.set(o.c); mesh.instanceColor.needsUpdate = true; }
    mesh.count = n; mesh.boundingSphere = null; mesh.boundingBox = null;
    if (p.lens) { mesh.userData.meta = o.meta; S.lensBins.add(b); }
    keep.add(name);
  }
  for (const [name, mesh] of b.meshes) if (!keep.has(name)) { S.group.remove(mesh); mesh.dispose(); b.meshes.delete(name); }
  OUT = null;
  S.dirty = true;
}

// ---------------------------------------------------------------- roads: nearest edge (from roads.js or our own)
const VEH = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'road', 'busway']);
const DEF_LANES = { motorway: 4, trunk: 4, primary: 4, secondary: 2, tertiary: 2, unclassified: 2, residential: 2, living_street: 1.6, service: 1.4, motorway_link: 1, trunk_link: 1, primary_link: 1, secondary_link: 1, tertiary_link: 1, road: 2, busway: 2 };
function onewayOf(r) { const t = r.tags || {}; const o = t.oneway; if (o === '-1' || o === 'reverse') return -1; if (o === 'yes' || o === '1' || o === 'true') return 1; if (o === 'no') return 0; if (r.highway === 'motorway' || t.junction === 'roundabout' || t.junction === 'circular') return 1; return 0; }
function lanesOf(r) { const t = r.tags || {}; const l = parseInt(t.lanes); if (l > 0) return l; const d = DEF_LANES[r.highway] ?? 2; return onewayOf(r) ? Math.max(1, Math.ceil(d / 2)) : d; }
function halfOf(r) { const t = r.tags || {}; const w = num(t.width); if (w && w > 2 && w < 60) return w / 2; return Math.max(1.8, lanesOf(r) * (r.highway === 'service' ? 3.0 : 3.25) / 2 + 0.25); }
class EdgeIndex {
  constructor() { this.g = new Map(); this.C = 40; this.n = 0; }
  addRoads(roads) {
    for (const r of roads) {
      if (!VEH.has(r.highway) || !r.pts || r.pts.length < 2) continue;
      if ((r.tags && (r.tags.tunnel === 'yes' || r.tags.area === 'yes'))) continue;
      const hw = halfOf(r);
      for (let i = 0; i + 1 < r.pts.length; i++) {
        const a = r.pts[i], b = r.pts[i + 1], s = [a[0], a[1], b[0], b[1], hw, r];
        const x0 = Math.floor((Math.min(a[0], b[0]) - 2) / this.C), x1 = Math.floor((Math.max(a[0], b[0]) + 2) / this.C);
        const z0 = Math.floor((Math.min(a[1], b[1]) - 2) / this.C), z1 = Math.floor((Math.max(a[1], b[1]) + 2) / this.C);
        for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) { const k = x + ',' + z; let l = this.g.get(k); if (!l) this.g.set(k, l = []); l.push(s); }
        this.n++;
      }
    }
  }
  nearest(x, z) {
    const cx = Math.floor(x / this.C), cz = Math.floor(z / this.C);
    let best = null, bd = Infinity;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const l = this.g.get((cx + i) + ',' + (cz + j)); if (!l) continue;
      for (const s of l) {
        const dx = s[2] - s[0], dz = s[3] - s[1], L = dx * dx + dz * dz;
        let t = L > 0 ? ((x - s[0]) * dx + (z - s[1]) * dz) / L : 0; t = clamp(t, 0, 1);
        const px = s[0] + dx * t, pz = s[1] + dz * t, d = Math.hypot(x - px, z - pz) - s[4] * 0.0;
        if (d < bd) { bd = d; best = { x: px, z: pz, heading: dirHeading(dx, dz), dist: Math.hypot(x - px, z - pz), halfWidth: s[4], road: s[5] }; }
      }
    }
    return best;
  }
}
function nearestEdge(x, z) {
  const r = S.roads;
  if (r && typeof r.nearestEdge === 'function') { try { return r.nearestEdge(x, z); } catch (e) { return null; } }
  return S.edge ? S.edge.nearest(x, z) : null;
}
// Moves a point out of the carriageway to its edge plus margin; returns [x, z, headingTowardRoad, edge].
function curbside(x, z, margin, maxD = 25) {
  const e = nearestEdge(x, z);
  if (!e || !(e.dist < maxD + e.halfWidth)) return [x, z, null, null];
  let vx = x - e.x, vz = z - e.z, d = Math.hypot(vx, vz);
  if (d < 0.05) { const h = (e.heading + (S.left ? -90 : 90)) * D2R; vx = Math.sin(h); vz = -Math.cos(h); d = 1; }
  vx /= d; vz /= d;
  const need = e.halfWidth + margin;
  if (e.dist < need) { x = e.x + vx * need; z = e.z + vz * need; }
  return [x, z, dirHeading(-vx, -vz), e];
}

// ---------------------------------------------------------------- building footprints (to skip indoor or rooftop points)
class BuildingIndex {
  constructor() { this.g = new Map(); this.C = 50; }
  add(list) {
    for (const b of list || []) {
      if (!b.outer || b.outer.length < 3 || b.part || (b.minHeight || 0) > 1 || /roof|carport|canopy/.test(b.type || '')) continue;
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const [x, z] of b.outer) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
      if (x1 - x0 > 2000 || z1 - z0 > 2000) continue;
      const rec = { p: b.outer, x0, z0, x1, z1 };
      for (let i = Math.floor(x0 / this.C); i <= Math.floor(x1 / this.C); i++) for (let j = Math.floor(z0 / this.C); j <= Math.floor(z1 / this.C); j++) { const k = i + ',' + j; let l = this.g.get(k); if (!l) this.g.set(k, l = []); l.push(rec); }
    }
  }
  inside(x, z, pad = 0) {
    const l = this.g.get(Math.floor(x / this.C) + ',' + Math.floor(z / this.C)); if (!l) return false;
    for (const r of l) {
      if (x < r.x0 + pad || x > r.x1 - pad || z < r.z0 + pad || z > r.z1 - pad) continue;
      let c = false; const p = r.p;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const a = p[i], b = p[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; }
      if (c) return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------- traffic signals: groups and cycle
// Timing comes from signals.js (shared with the traffic); a group here only remembers what its lenses show.
function addGroup(g) {
  if (S.groups.has(g.id)) return S.groups.get(g.id);
  const G = { id: g.id, src: g, st: [2, 2], changed: true };
  S.groups.set(g.id, G);
  stepGroup(G);
  return G;
}
function phaseOf(G, heading) { return SIG.onAxis(G.src, heading) ? 0 : 1; }
// state codes: 0 green, 1 amber, 2 red, 3 red and amber (the UK's 2 s before green)
const CODE = { green: 0, amber: 1, red: 2 };
function stepGroup(G) {
  const g = G.src, ra = S.region === 'uk';
  for (let p = 0; p < 2; p++) {
    const q = SIG.state(g, p === 0 ? g.axis : g.axis + 90);
    let c = CODE[q.s] ?? 2;
    if (ra && c === 2 && q.left < 2) c = 3;
    if (c !== G.st[p]) { G.st[p] = c; G.changed = true; }
  }
}
const LIT = { r: new THREE.Color(1.0, 0.07, 0.03), a: new THREE.Color(1.0, 0.52, 0.0), g: new THREE.Color(0.08, 1.0, 0.5) };
const DIM = { r: new THREE.Color(0.11, 0.025, 0.02), a: new THREE.Color(0.11, 0.07, 0.02), g: new THREE.Color(0.02, 0.09, 0.07) };
const isLit = (st, role) => role === 'r' ? (st === 2 || st === 3) : role === 'a' ? (st === 1 || st === 3) : st === 0;
function recolourLenses(st, force) {
  for (const b of st.lensBins) for (const name of ['lens', 'halo']) {
    const mesh = b.meshes.get(name); if (!mesh || !mesh.userData.meta) continue;
    const meta = mesh.userData.meta, arr = mesh.instanceColor.array;
    let touched = false;
    for (let i = 0; i < meta.length; i++) {
      const m = meta[i], G = st.groups.get(m.g); if (!G || (!G.changed && !force)) continue;
      const lit = isLit(G.st[m.p], m.r);
      const c = name === 'lens' ? (lit ? LIT[m.r] : DIM[m.r]) : null;
      if (c) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
      else { const k = lit ? 0.55 : 0; arr[i * 3] = LIT[m.r].r * k; arr[i * 3 + 1] = LIT[m.r].g * k; arr[i * 3 + 2] = LIT[m.r].b * k; }
      touched = true;
    }
    if (touched) mesh.instanceColor.needsUpdate = true;
  }
  for (const G of st.groups.values()) G.changed = false;
}

// Groups from OSM alone, for when roads.js gives none: traffic_signals nodes within 35 m are one junction;
// each way through a node gives the approaches towards it.
function nodeWayIndex(osm) {
  const idx = new Map();
  for (const r of osm.roads) {
    if (!VEH.has(r.highway) || !r.nodes) continue;
    r.nodes.forEach((id, i) => { let l = idx.get(id); if (!l) idx.set(id, l = []); l.push({ r, i }); });
  }
  return idx;
}
function isJunction(nw, id) { const l = nw.get(id); return !!l && l.length >= 2; }
function approachesAt(nw, node, osm, dirTag) {
  const out = [], list = nw.get(node.id) || [], junc = list.length >= 2;
  for (const { r, i } of list) {
    const ow = onewayOf(r), hw = halfOf(r), lanes = lanesOf(r);
    const cands = [];
    if (i > 0 && ow >= 0) cands.push([r.pts[i - 1], 'forward']);
    if (i < r.pts.length - 1 && ow <= 0) cands.push([r.pts[i + 1], 'backward']);
    for (const [prev, dir] of cands) {
      if (!junc && dirTag && dirTag !== 'both' && dirTag !== dir) continue;
      const dx = node.x - prev[0], dz = node.z - prev[1], L = Math.hypot(dx, dz); if (L < 0.5) continue;
      const ux = dx / L, uz = dz / L, h = dirHeading(ux, uz);
      const back = junc ? Math.min(L * 0.8, 9) : 0;
      const cx = node.x - ux * back, cz = node.z - uz * back;
      const side = S.left ? -1 : 1, rx = -uz * side, rz = ux * side; // right (or left) of travel
      const half = ow ? hw : hw;
      const sx = ow ? cx : cx + rx * hw / 2, sz = ow ? cz : cz + rz * hw / 2;
      out.push({ heading: h, x: sx, z: sz, px: cx + rx * (half + 0.6), pz: cz + rz * (half + 0.6), halfWidth: hw, lanes: ow ? lanes : Math.max(1, Math.round(lanes / 2)), road: r });
    }
  }
  return out;
}
function deriveSignals(osm) {
  const nw = nodeWayIndex(osm);
  const sig = osm.points.filter(p => p.kind === 'traffic_signals' && !S.sigMap.has(p.id));
  const parent = sig.map((_, i) => i), find = (i) => parent[i] === i ? i : (parent[i] = find(parent[i]));
  for (let i = 0; i < sig.length; i++) for (let j = i + 1; j < sig.length; j++) if (Math.hypot(sig[i].x - sig[j].x, sig[i].z - sig[j].z) < 35) parent[find(i)] = find(j);
  const clusters = new Map();
  sig.forEach((s, i) => { const k = find(i); let l = clusters.get(k); if (!l) clusters.set(k, l = []); l.push(s); });
  const groups = [];
  for (const nodes of clusters.values()) {
    let aps = [];
    for (const n of nodes) {
      const t = n.tags || {}, dirTag = t['traffic_signals:direction'] || t.direction;
      aps.push(...approachesAt(nw, n, osm, dirTag));
    }
    // one approach per direction of travel per road (several signal nodes often mark one approach)
    const keep = [];
    for (const a of aps.sort((p, q) => q.lanes - p.lanes)) {
      if (keep.some(k => Math.abs(angDiff(k.heading, a.heading)) < 25 && Math.hypot(k.px - a.px, k.pz - a.pz) < 25)) continue;
      keep.push(a);
    }
    if (!keep.length) continue;
    let cx = 0, cz = 0; for (const n of nodes) { cx += n.x; cz += n.z; } cx /= nodes.length; cz /= nodes.length;
    const main = keep.slice().sort((p, q) => (q.lanes * q.halfWidth) - (p.lanes * p.halfWidth))[0];
    groups.push({ id: nodes[0].id, x: cx, z: cz, nodes: nodes.map(n => n.id), axis: main.heading % 180, approaches: keep });
  }
  return groups;
}
function deriveSigns(osm) {
  const nw = nodeWayIndex(osm), out = [];
  for (const p of osm.points) {
    if (p.kind !== 'stop' && p.kind !== 'give_way') continue;
    const t = p.tags || {}, dirTag = t.direction;
    const list = nw.get(p.id) || [];
    const push = (h, x, z, hw) => { const side = S.left ? -1 : 1, d = h * D2R, rx = Math.cos(d) * side, rz = Math.sin(d) * side; out.push({ id: p.id, kind: p.kind, x, z, heading: h, px: x + rx * (hw + 0.7), pz: z + rz * (hw + 0.7) }); };
    if (!list.length) {
      const e = nearestEdge(p.x, p.z);
      let h = num(dirTag);
      if (h == null && e) {
        // traffic for which the sign is on its near side
        const vx = p.x - e.x, vz = p.z - e.z, d = e.heading * D2R, right = vx * Math.cos(d) + vz * Math.sin(d);
        h = (right >= 0) !== S.left ? e.heading : (e.heading + 180) % 360;
      }
      if (h == null) continue;
      const d = h * D2R, side = S.left ? -1 : 1;
      out.push({ id: p.id, kind: p.kind, x: p.x, z: p.z, heading: h, px: p.x, pz: p.z });
      continue;
    }
    if (list.length >= 2) {
      // at the junction node: one sign per approach of the ways that end here (side streets), else all
      const aps = approachesAt(nw, p, osm, null);
      const ends = aps.filter(a => { const l = a.road.nodes; return l[0] === p.id || l[l.length - 1] === p.id; });
      for (const a of (ends.length && ends.length < aps.length ? ends : aps)) out.push({ id: p.id, kind: p.kind, x: a.x, z: a.z, heading: a.heading, px: a.px, pz: a.pz });
      continue;
    }
    const { r, i } = list[0];
    let fwd;
    if (dirTag === 'forward') fwd = true; else if (dirTag === 'backward') fwd = false;
    else {
      let df = Infinity, db = Infinity, acc = 0;
      for (let k = i + 1; k < r.nodes.length; k++) { acc += Math.hypot(r.pts[k][0] - r.pts[k - 1][0], r.pts[k][1] - r.pts[k - 1][1]); if (isJunction(nw, r.nodes[k]) || k === r.nodes.length - 1) { df = acc; break; } }
      acc = 0;
      for (let k = i - 1; k >= 0; k--) { acc += Math.hypot(r.pts[k][0] - r.pts[k + 1][0], r.pts[k][1] - r.pts[k + 1][1]); if (isJunction(nw, r.nodes[k]) || k === 0) { db = acc; break; } }
      fwd = df <= db;
    }
    const ow = onewayOf(r); if (ow === 1) fwd = true; if (ow === -1) fwd = false;
    const j = fwd ? Math.min(i + 1, r.pts.length - 1) : Math.max(i - 1, 0), k = fwd ? Math.max(i - 1, 0) : Math.min(i + 1, r.pts.length - 1);
    const a = r.pts[j === i ? k : i], b = r.pts[j === i ? i : j];
    let h = j === i ? dirHeading(r.pts[i][0] - r.pts[k][0], r.pts[i][1] - r.pts[k][1]) : dirHeading(b[0] - a[0], b[1] - a[1]);
    const hw = ow ? halfOf(r) : halfOf(r);
    push(h, p.x, p.z, hw);
  }
  return out;
}

// ---------------------------------------------------------------- placing things
function pointYaw(t, fallback) { const d = num(t && (t.direction || t['camera:direction'])); return d != null ? d : fallback; }

function placeHydrant(p) {
  const t = p.tags || {}, ty = t['fire_hydrant:type'] || t['fire_hydrant:position'];
  if (/underground|wall|pipe|pond|suction|in_ground/.test(t['fire_hydrant:type'] || '') || t['fire_hydrant:position'] === 'underground') return;
  if (!ty && S.region === 'uk') return; // nearly all British hydrants are under the pavement
  const [x, z, toRoad] = curbside(p.x, p.z, 0.5);
  const c = tagColour(t.colour || t['fire_hydrant:colour'], S.region === 'us' ? 0xa8180e : S.region === 'eu' ? 0xb0160e : 0xb81a10);
  const yaw = toRoad ?? (rng(p.id)() * 360), sy = S.region === 'us' ? 1 : 1.25;
  const rec = addRec([[x, z]], (r) => emit('hydrant', base(x, r.ys[0], z, yaw, 1, sy, 1), c));
  circle(rec, x, z, 0.2, 0.8);
}
function placeLamp(p) {
  const t = p.tags || {};
  if (/wall|suspended|catenary|ceiling/.test(t.support || '') || t.lamp_mount === 'wall') return;
  const e = nearestEdge(p.x, p.z);
  const nearRoad = e && e.dist - e.halfWidth < 7;
  let h = num(t.height);
  // hung on a utility pole that is mapped at (nearly) the same spot: just the bracket arm and the luminaire
  let pole = S.poleByNode.get(p.id) || null;
  if (!pole) for (const q of S.poleByNode.values()) if (q.kind === 'pole' && Math.abs(q.x - p.x) < 2 && Math.abs(q.z - p.z) < 2) { pole = q; break; }
  if (pole && nearRoad) {
    const [, , toRoad] = curbside(pole.x, pole.z, 0.6);
    const yaw = toRoad ?? 0, d = yaw * D2R, ox = Math.sin(d) * 0.15, oz = -Math.cos(d) * 0.15;
    addRec([[pole.x, pole.z]], (r) => emit('lampArm', base(pole.x + ox, r.ys[0] + 8.2, pole.z + oz, yaw)));
    return;
  }
  if (nearRoad) {
    const [x, z, toRoad] = curbside(p.x, p.z, 0.6);
    if (!h) h = S.region === 'us' ? 9 : S.region === 'jp' ? 8 : 8;
    const s = clamp(h / 9.35, 0.5, 1.6);
    const c = S.region === 'us' || S.region === 'jp' ? new THREE.Color(0.62, 0.64, 0.66) : S.region === 'uk' ? new THREE.Color(0.55, 0.57, 0.58) : new THREE.Color(0.36, 0.39, 0.4);
    const yaw = toRoad ?? 0;
    const rec = addRec([[x, z]], (r) => { const m = base(x, r.ys[0], z, yaw, s); emit('lampCobra', m, c); emit('lampCobraLens', m); });
    circle(rec, x, z, 0.12, h);
  } else {
    if (!h) h = 4.6;
    const s = clamp(h / 4.7, 0.6, 1.5), c = S.region === 'us' ? new THREE.Color(0.06, 0.07, 0.07) : new THREE.Color(0.08, 0.1, 0.09);
    const rec = addRec([[p.x, p.z]], (r) => { const m = base(p.x, r.ys[0], p.z, 0, s); emit('lampPost', m, c); emit('lampPostGlass', m); });
    circle(rec, p.x, p.z, 0.12, h);
  }
}
function signPart(kind) {
  if (kind === 'stop') return S.region === 'jp' ? ['signStopJP', 0.8] : ['signStop', 0.76];
  return S.region === 'us' ? ['signYield', 0.91] : S.region === 'uk' ? ['signGiveUK', 0.9] : ['signGive', 0.9];
}
function placeSign(sg) {
  const [name, size] = signPart(sg.kind);
  const px = sg.px ?? sg.x, pz = sg.pz ?? sg.z;
  const yaw = (sg.heading + 180) % 360;
  const bottom = S.region === 'us' ? 2.13 : 2.0, cy = bottom + size / 2;
  const postC = S.region === 'us' ? new THREE.Color(0.6, 0.62, 0.63) : new THREE.Color(0.55, 0.57, 0.58);
  const d = sg.heading * D2R, fx = Math.sin(d) * 0.04, fz = -Math.cos(d) * 0.04; // face just in front of the post
  const rec = addRec([[px, pz]], (r) => {
    const y = r.ys[0];
    emit('tube', segMat(px, y - 0.3, pz, px, y + cy + size * 0.35, pz, 0.03), postC);
    emit(name, base(px - fx, y + cy, pz - fz, yaw));
  });
  circle(rec, px, pz, 0.05, cy + size / 2);
}
function placeCrossing(p) {
  const t = p.tags || {};
  if (S.region0 !== 'uk') return;
  if (!(t.crossing === 'zebra' || t.crossing_ref === 'zebra' || t['crossing:markings'] === 'zebra' && t.crossing === 'uncontrolled')) return;
  const e = nearestEdge(p.x, p.z); if (!e || e.dist > 4) return;
  const d = e.heading * D2R, nx = Math.cos(d), nz = Math.sin(d), off = e.halfWidth + 0.55;
  for (const sd of [-1, 1]) {
    const x = e.x + nx * off * sd, z = e.z + nz * off * sd;
    const rec = addRec([[x, z]], (r) => { const m = base(x, r.ys[0], z, 0); emit('belisha', m); emit('belishaGlobe', m); });
    circle(rec, x, z, 0.1, 3);
  }
}
function placeBollard(p) {
  const t = p.tags || {}; if (/rising|removable/.test(t.bollard || '') && rng(p.id)() < 0.3) return;
  const c = tagColour(t.colour, S.region === 'uk' ? 0x1a1a1a : S.region === 'us' ? 0xd8b318 : 0x3c4044);
  const rec = addRec([[p.x, p.z]], (r) => emit('bollard', base(p.x, r.ys[0], p.z, 0), c));
  circle(rec, p.x, p.z, 0.12, 0.9);
}
function placeBench(p) {
  const t = p.tags || {};
  const [x, z, toRoad] = curbside(p.x, p.z, 1.2, 12);
  const yaw = pointYaw(t, toRoad ?? rng(p.id)() * 360);
  const slats = t.backrest === 'no' ? 'benchSeat' : 'benchSlats';
  const rec = addRec([[x, z]], (r) => { const m = base(x, r.ys[0], z, yaw); emit('benchFrame', m); emit(slats, m); });
  const d = yaw * D2R, ux = Math.cos(d) * 0.85, uz = Math.sin(d) * 0.85;
  segment(rec, [x - ux, z - uz], [x + ux, z + uz], 0.5, 0.9);
}
function placeBin(p) {
  const t = p.tags || {};
  const [x, z, toRoad] = curbside(p.x, p.z, 0.5, 10);
  const c = tagColour(t.colour, S.region === 'uk' ? 0x15171a : S.region === 'us' ? 0x2d3a2e : 0x2e4a33);
  const rec = addRec([[x, z]], (r) => emit('bin', base(x, r.ys[0], z, toRoad ?? 0), c));
  circle(rec, x, z, 0.25, 0.95);
}
function placePostBox(p) {
  const [x, z, toRoad] = curbside(p.x, p.z, 0.6, 12);
  const name = S.region === 'us' ? 'postUS' : S.region === 'uk' ? 'postUK' : S.region === 'jp' ? 'postJP' : 'postEU';
  const yaw = (toRoad ?? 0) + 180; // the slot faces the footway
  const rec = addRec([[x, z]], (r) => emit(name, base(x, r.ys[0], z, yaw)));
  circle(rec, x, z, 0.3, 1.5);
}
function placePhone(p) {
  const [x, z, toRoad] = curbside(p.x, p.z, 1.0, 12);
  const yaw = (toRoad ?? 0) + 180;
  if (S.region0 === 'uk') {
    const rec = addRec([[x, z]], (r) => { const m = base(x, r.ys[0], z, yaw); emit('kiosk', m); emit('kioskGlass', m); });
    circle(rec, x, z, 0.62, 2.8);
  } else {
    const rec = addRec([[x, z]], (r) => emit('payphone', base(x, r.ys[0], z, yaw)));
    circle(rec, x, z, 0.1, 1.7);
  }
}
function placeBusStop(p) {
  const t = p.tags || {}, shelter = t.shelter === 'yes';
  const [x, z, toRoad, e] = curbside(p.x, p.z, shelter ? 1.6 : 0.5, 15);
  const yaw = toRoad ?? 0;
  if (shelter) {
    // the shelter stands back from the curb, the sign at its upstream end
    const d = yaw * D2R, bx = x - Math.sin(d) * 0.6, bz = z + Math.cos(d) * 0.6;
    const rec = addRec([[bx, bz]], (r) => { const m = base(bx, r.ys[0], bz, yaw); emit('shelter', m); emit('shelterAd', m); emit('shelterGlass', m); });
    const fx = Math.sin(d), fz = -Math.cos(d), rx = Math.cos(d), rz = Math.sin(d);
    const back = [bx - fx * 0.65, bz - fz * 0.65];
    segment(rec, [back[0] - rx * 1.8, back[1] - rz * 1.8], [back[0] + rx * 1.8, back[1] + rz * 1.8], 0.15, 2.5);
    const sx = bx + rx * 2.4 + fx * 0.5, sz = bz + rz * 2.4 + fz * 0.5;
    signPost(sx, sz, yaw + 90);
  } else signPost(x, z, (e ? e.heading : yaw + 90));
}
function signPost(x, z, yaw) {
  const c = new THREE.Color(0.55, 0.57, 0.58);
  const rec = addRec([[x, z]], (r) => { const y = r.ys[0]; emit('tube', segMat(x, y - 0.3, z, x, y + 2.75, z, 0.035), c); emit('signBus', base(x, y + 2.45, z, yaw)); });
  circle(rec, x, z, 0.05, 2.8);
}

// trees
const PALMS = /phoenix|washingtonia|syagrus|trachycarpus|palm|arecaceae|butia|chamaerops/i;
const CONIFERS = /pinus|picea|abies|cedrus|pseudotsuga|sequoia|cupressus|larix|tsuga|thuja|juniperus|taxus|cryptomeria|chamaecyparis|metasequoia|araucaria|pine|spruce|fir|cedar|cypress|redwood/i;
function treeKind(t, r) {
  const sp = [t.genus, t.species, t.taxon, t['species:en'], t['genus:en'], t['taxon:en']].filter(Boolean).join(' ');
  if (PALMS.test(sp)) return 'palm';
  if (t.leaf_type === 'needleleaved' || CONIFERS.test(sp)) return 'cone';
  return r() < 0.55 ? 'round' : 'oval';
}
const LEAF_TINTS = [[0.82, 0.95, 0.72], [0.95, 1.0, 0.78], [0.78, 0.9, 0.62], [1.0, 1.0, 0.85], [0.86, 0.96, 0.8], [0.9, 0.92, 0.66]];
// what OSM's trees are here: 'draw' (models and a trunk to hit), 'collide' (a trunk only: Google's mesh already
// shows the tree) or 'none' (trees.js does them in the open world)
let TREE_MODE = 'draw';
function placeTree(x, z, t, seed, isRow) {
  if (TREE_MODE === 'none') return;
  const r = rng(seed);
  const kind = treeKind(t || {}, r);
  let H = num(t && t.height), D = num(t && (t.diameter_crown || t['crown:diameter']));
  if (!H || H < 2 || H > 60) H = kind === 'palm' ? 10 + r() * 6 : kind === 'cone' ? 9 + r() * 8 : (isRow ? 7 + r() * 4 : 6 + r() * 6);
  // a street tree mapped inside the carriageway goes to the verge
  const e = nearestEdge(x, z);
  if (e && e.dist < e.halfWidth + 1.0) { const [nx, nz] = curbside(x, z, 1.2, 30); x = nx; z = nz; }
  const s = H / 10;
  let sxz = s;
  if (D && D > 1 && D < 40) { const nomD = kind === 'round' ? 6.6 : kind === 'oval' ? 4.6 : kind === 'cone' ? 5 : 7; sxz = clamp(D / nomD, s * 0.6, s * 1.6); }
  sxz *= 0.9 + r() * 0.2;
  const yaw = r() * 360, tint = LEAF_TINTS[Math.floor(r() * LEAF_TINTS.length)];
  const k = 0.88 + r() * 0.24, tc = new THREE.Color(tint[0] * k, tint[1] * k, tint[2] * k);
  if (kind === 'cone') tc.multiplyScalar(0.92);
  const T = kind === 'round' ? ['trunkRound', 'crownRound'] : kind === 'oval' ? ['trunkOval', 'crownOval'] : kind === 'cone' ? ['trunkCone', 'crownCone'] : ['trunkPalm', 'crownPalm'];
  const trunkS = kind === 'palm' ? s : Math.sqrt(s * sxz);
  const rec = addRec([[x, z]], (rr) => {
    const y = rr.ys[0];
    if (TREE_MODE === 'collide') return;
    emit(T[0], base(x, y, z, yaw, trunkS, s, trunkS));
    emit(T[1], base(x, y, z, yaw, sxz, s, sxz), tc);
  });
  circle(rec, x, z, clamp(0.25 * trunkS, 0.15, 0.6), H);
}

// power: supports from points and implicit ones on line nodes, wires between consecutive supports
function supportKind(p, line) {
  if (p && p.kind === 'power_tower') return 'tower';
  if (p && (p.kind === 'power_pole' || p.kind === 'utility_pole')) return 'pole';
  if (line && line.kind === 'line') { const v = parseInt((line.tags && line.tags.voltage) || '0'); return v >= 100000 || !v ? 'tower' : 'pole'; }
  return 'pole';
}
const POLE_ATT = [[-1.05, 11.56, 0], [0, 11.56, 0], [1.05, 11.56, 0]];
const POLE_COMM = [0, 6.5, 0.28];
const TOWER_ATT = [[-TOWER.arms[0][1], TOWER.arms[0][0] - 2.2, 0], [TOWER.arms[0][1], TOWER.arms[0][0] - 2.2, 0], [-TOWER.arms[1][1], TOWER.arms[1][0] - 2.2, 0], [TOWER.arms[1][1], TOWER.arms[1][0] - 2.2, 0], [0, TOWER.top, 0]];
function placePower(osm) {
  const sup = new Map(); // node id -> { x, z, kind, dirs: [], h, p }
  const pts = new Map(); for (const p of osm.points) if (p.kind === 'power_pole' || p.kind === 'power_tower' || p.kind === 'utility_pole') pts.set(p.id, p);
  const newLines = [], bb = osm.bbox;
  for (const L of osm.lines) {
    if (S.done.has('l' + L.id)) continue; S.done.add('l' + L.id);
    const t = L.tags || {};
    if (t.location === 'underground' || t.line === 'underground' || t.tunnel === 'yes') continue;
    newLines.push(L);
    for (let i = 0; i < L.nodes.length; i++) {
      const id = L.nodes[i], n = osm.nodes.get(id); if (!n) continue;
      // a line's way runs on far past the loaded area: no supports out there
      if (bb && (n.x < bb.x0 - 150 || n.x > bb.x1 + 150 || n.z < bb.z0 - 150 || n.z > bb.z1 + 150)) continue;
      let s = sup.get(id) || S.poleByNode.get(id);
      if (!s) { s = { id, x: n.x, z: n.z, kind: supportKind(pts.get(id), L), dirs: [], p: pts.get(id) || null, rec: null, fresh: true }; sup.set(id, s); }
      const a = L.pts[Math.max(0, i - 1)], b = L.pts[Math.min(L.pts.length - 1, i + 1)];
      if (a && b) s.dirs.push(dirHeading(b[0] - a[0], b[1] - a[1]));
    }
  }
  // standalone poles
  for (const p of pts.values()) {
    if (S.done.has('n' + p.id)) continue;
    if (!sup.has(p.id) && !S.poleByNode.has(p.id)) {
      const e = nearestEdge(p.x, p.z);
      sup.set(p.id, { id: p.id, x: p.x, z: p.z, kind: supportKind(p, null), dirs: e ? [e.heading] : [0], p, rec: null, fresh: true });
    }
  }
  const woodC = S.region === 'us' ? null : new THREE.Color(0.85, 0.85, 0.82);
  for (const s of sup.values()) {
    if (!s.fresh) continue; s.fresh = false;
    S.done.add('n' + s.id);
    // yaw: the line's direction (mean of the directions through it, folded to 0..180)
    let sx = 0, sz = 0; for (const d of s.dirs) { sx += Math.cos(2 * d * D2R); sz += Math.sin(2 * d * D2R); }
    s.yaw = (Math.atan2(sz, sx) / 2 / D2R + 360) % 180;
    const t = (s.p && s.p.tags) || {};
    if (s.kind === 'tower') {
      const H = num(t.height); s.scale = H && H > 12 && H < 90 ? H / TOWER.top : 1;
      s.rec = addRec([[s.x, s.z]], (r) => emit('tower', base(s.x, r.ys[0], s.z, s.yaw, s.scale)));
      const w = 3.6 * s.scale;
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const d = s.yaw * D2R, c = Math.cos(d), sn = Math.sin(d); circle(s.rec, s.x + (a * w) * c - (b * w) * sn, s.z + (a * w) * sn + (b * w) * c, 0.35, 30); }
    } else {
      const H = num(t.height); s.scale = H && H > 5 && H < 30 ? H / 12 : 1;
      const r0 = rng(s.id);
      const pc = woodC || new THREE.Color().setHSL(0.08, 0.12 + r0() * 0.08, 0.5 + r0() * 0.12);
      const tr = t.transformer || (r0() < 0.12 ? 'yes' : null);
      s.rec = addRec([[s.x, s.z]], (r) => {
        const m = base(s.x, r.ys[0], s.z, s.yaw, 1, s.scale, 1);
        emit(S.region === 'us' && !/concrete|steel/.test(t.material || '') ? 'uPole' : 'uPoleC', m, pc); emit('insulators', m);
        if (tr) emit('transformer', base(s.x, r.ys[0] + 8.2 * s.scale, s.z, s.yaw).multiply(_tm.makeTranslation(0, 0, -0.42)));
      });
      circle(s.rec, s.x, s.z, 0.17, 12 * s.scale);
    }
    S.poleByNode.set(s.id, s);
  }
  // wires
  for (const L of newLines) {
    const ids = L.nodes.filter(id => S.poleByNode.has(id));
    for (let i = 0; i + 1 < ids.length; i++) {
      const A = S.poleByNode.get(ids[i]), B = S.poleByNode.get(ids[i + 1]);
      const span = Math.hypot(B.x - A.x, B.z - A.z); if (span < 3 || span > 700) continue;
      const w = { A, B, span, comm: A.kind === 'pole' && B.kind === 'pole' && S.region !== 'eu' };
      const k = binKey((A.x + B.x) / 2, (A.z + B.z) / 2);
      const rec = { pts: [[(A.x + B.x) / 2, (A.z + B.z) / 2]], ys: [0], ok: true, emit: (r) => emitWire(w), bin: k, wire: w };
      getBin(k).recs.push(rec); getBin(k).dirty = true; S.wires.push(rec);
    }
  }
}
const _tm = new THREE.Matrix4(), _wa = new THREE.Vector3(), _wb = new THREE.Vector3(), _seg = new THREE.Matrix4();
function attach(s, o, out) { // support s, local offset o -> world point
  const d = s.yaw * D2R, c = Math.cos(d), sn = Math.sin(d), k = s.scale || 1;
  // local +x is the support's right (cos, sin); local -z its front (sin, -cos)
  const y = s.rec ? s.rec.ys[0] : 0;
  return out.set(s.x + o[0] * c * (s.kind === 'tower' ? k : 1) - o[2] * sn, y + o[1] * k, s.z + o[0] * sn * (s.kind === 'tower' ? k : 1) + o[2] * c);
}
function emitWire(w) {
  const { A, B, span } = w;
  const attA = A.kind === 'tower' ? TOWER_ATT : POLE_ATT, attB = B.kind === 'tower' ? TOWER_ATT : POLE_ATT;
  const n = Math.min(attA.length, attB.length);
  // keep conductors from crossing: compare the supports' right vectors
  const flip = Math.cos((A.yaw - B.yaw) * D2R) < 0;
  const sag = span * (A.kind === 'tower' || B.kind === 'tower' ? 0.032 : 0.022);
  const r = A.kind === 'tower' ? 0.022 : 0.011;
  const segs = clamp(Math.round(span / 6), 6, 16);
  const one = (pa, pb, rad, sg) => {
    let px = pa.x, py = pa.y, pz = pa.z;
    for (let i = 1; i <= segs; i++) {
      const t = i / segs, x = pa.x + (pb.x - pa.x) * t, z = pa.z + (pb.z - pa.z) * t, y = pa.y + (pb.y - pa.y) * t - 4 * sg * t * (1 - t);
      emit('wire', segMat(px, py, pz, x, y, z, rad, _seg));
      px = x; py = y; pz = z;
    }
  };
  for (let i = 0; i < n; i++) {
    const j = flip ? (attB === POLE_ATT ? 2 - i : (i < 4 ? i ^ 1 : i)) : i;
    if (j < 0 || j >= attB.length) continue;
    one(attach(A, attA[i], _wa).clone(), attach(B, attB[j], _wb).clone(), r, sag);
  }
  if (w.comm) one(attach(A, POLE_COMM, _wa).clone(), attach(B, POLE_COMM, _wb).clone(), 0.022, sag * 1.2);
}

// traffic lights
function placeSignalGroup(g) {
  const G = addGroup(g);
  for (const ap of g.approaches || []) {
    const p = phaseOf(G, ap.heading);
    placeSignalApproach(G, ap, p, g);
  }
}
function placeSignalApproach(G, ap, phase, g) {
  const h = ap.heading, d = h * D2R, dx = Math.sin(d), dz = -Math.cos(d);
  const yaw = (h + 180) % 360;
  const lanes = clamp(Math.round(ap.lanes || 1), 1, 6), hw = ap.halfWidth || lanes * 1.7;
  let px = ap.px ?? ap.x, pz = ap.pz ?? ap.z;
  const R = S.region;
  const farSide = R === 'us' || R === 'jp';
  if (farSide && ap.fx != null && ap.fz != null) {
    // roads.js knows the far-side curb of the road that continues across the junction
    px = ap.fx; pz = ap.fz;
  } else if (farSide && !('fx' in ap)) {
    // no such point (our own fallback approaches): across the junction by the crossing road's width
    let cross = 0; for (const o of g.approaches || []) if (phaseOf(G, o.heading) !== phase) cross = Math.max(cross, (o.halfWidth || 3.5) * 2);
    cross = clamp((cross || 10) + 3, 8, 34);
    px += dx * cross; pz += dz * cross;
  } else { px += dx * 1.0; pz += dz * 1.0; } // near side, just past the stop line (T junctions and mid-block too)
  // which way is the road from the pole (perpendicular to travel)
  let ax = ap.x - (ap.px ?? ap.x), az = ap.z - (ap.pz ?? ap.z);
  const along = ax * dx + az * dz; ax -= along * dx; az -= along * dz;
  let al = Math.hypot(ax, az);
  if (al < 0.3) { const s = S.left ? 1 : -1; ax = -Math.cos(d) * s; az = -Math.sin(d) * s; al = 1; }
  ax /= al; az /= al;
  const lensR = R === 'us' || R === 'jp' ? 0.15 : 0.105;
  const hsp = lensR * 2.25;
  const housing = R === 'us' ? (rng(G.id)() < 0.55 ? new THREE.Color(0.85, 0.66, 0.05) : new THREE.Color(0.05, 0.05, 0.05)) : R === 'jp' ? new THREE.Color(0.72, 0.74, 0.75) : R === 'uk' ? new THREE.Color(0.04, 0.04, 0.04) : new THREE.Color(0.12, 0.13, 0.14);
  const poleC = R === 'us' ? new THREE.Color(0.6, 0.62, 0.64) : R === 'jp' ? new THREE.Color(0.66, 0.68, 0.7) : R === 'uk' ? new THREE.Color(0.06, 0.06, 0.06) : new THREE.Color(0.38, 0.4, 0.41);
  const gid = G.id;
  const lensMeta = (role) => ({ g: gid, p: phase, r: role });
  const mastArm = (R === 'us' && (lanes >= 2 || hw > 4.6)) || R === 'jp';
  const rec = addRec([[px, pz]], (r) => {
    const y = r.ys[0];
    const head = (cx, cy, cz, vertical) => {
      const m = base(cx, cy, cz, yaw);
      if (vertical) {
        emit(R === 'us' ? 'headUS' : 'headEU', m, housing);
        if (R === 'uk') emit('boardUK', m); else if (R === 'us' && mastArm) emit('boardUS', m);
        const roles = [['r', hsp], ['a', 0], ['g', -hsp]];
        for (const [role, ly] of roles) {
          const lm = base(cx, cy, cz, yaw).multiply(_tm.makeTranslation(0, ly, -0.122)).multiply(new THREE.Matrix4().makeScale(lensR * 0.97, lensR * 0.97, 1));
          emit('lens', lm, null, lensMeta(role));
          const hm = base(cx, cy, cz, yaw).multiply(_tm.makeTranslation(0, ly, -0.135)).multiply(new THREE.Matrix4().makeScale(lensR * 2.6, lensR * 2.6, 1));
          emit('halo', hm, null, lensMeta(role));
        }
      } else {
        emit('headJP', m, housing);
        const wsp = lensR * 2.35;
        for (const [role, lx] of [['g', wsp], ['a', 0], ['r', -wsp]]) {
          const lm = base(cx, cy, cz, yaw).multiply(_tm.makeTranslation(lx, 0, -0.102)).multiply(new THREE.Matrix4().makeScale(lensR * 0.97, lensR * 0.97, 1));
          emit('lens', lm, null, lensMeta(role));
          const hm = base(cx, cy, cz, yaw).multiply(_tm.makeTranslation(lx, 0, -0.115)).multiply(new THREE.Matrix4().makeScale(lensR * 2.6, lensR * 2.6, 1));
          emit('halo', hm, null, lensMeta(role));
        }
      }
    };
    if (mastArm) {
      const poleH = R === 'jp' ? 6.2 : 7.4, armY = R === 'jp' ? 5.4 : 6.5;
      emit('pole', segMat(px, y - 0.3, pz, px, y + poleH, pz, R === 'jp' ? 0.12 : 0.17), poleC);
      const laneW = 3.3;
      const nHeads = R === 'jp' ? 1 : Math.min(lanes, 4);
      const reach = R === 'jp' ? Math.min(laneW * lanes * 0.6 + 1, 7) : 0.8 + laneW * (nHeads - 0.5) + 0.8;
      emit('tube', segMat(px, y + armY, pz, px + ax * reach, y + armY + reach * 0.03, pz + az * reach, R === 'jp' ? 0.06 : 0.09), poleC);
      emit('tube', segMat(px, y + armY + 1.2, pz, px + ax * reach * 0.4, y + armY + 0.05, pz + az * reach * 0.4, 0.025), poleC);
      if (R === 'jp') {
        const hx = px + ax * (reach - 0.9), hz = pz + az * (reach - 0.9);
        head(hx, y + armY - 0.32, hz, false);
      } else {
        for (let i = 0; i < nHeads; i++) {
          const dd = 0.8 + laneW * (i + 0.5), hx = px + ax * dd, hz = pz + az * dd;
          const hy = y + armY - 0.6;
          emit('tube', segMat(hx, hy + 0.5, hz, hx, y + armY, hz, 0.02), poleC);
          head(hx, hy, hz, true);
        }
        // a pole mounted head at eye level
        head(px + ax * 0.44 - dx * 0.1, y + 3.4, pz + az * 0.44 - dz * 0.1, true);
      }
    } else {
      const top = R === 'us' ? 3.4 : 2.95;
      emit('pole', segMat(px, y - 0.3, pz, px, y + top + 0.2, pz, R === 'us' ? 0.11 : 0.065), poleC);
      head(px - dx * 0.2, y + top, pz - dz * 0.2, true);
    }
  });
  circle(rec, px, pz, mastArm ? 0.2 : 0.12, 7);
  return rec;
}

// linear barriers
function fenceType(b) {
  const t = b.tags || {}, ft = t.fence_type || t['fence:type'] || '', m = t.material || '';
  if (b.kind === 'hedge') return 'hedge';
  if (b.kind === 'guard_rail') return 'guard';
  if (b.kind === 'wall' || b.kind === 'retaining_wall' || b.kind === 'city_wall' || b.kind === 'jersey_barrier') return 'wall';
  if (b.kind === 'railing' || b.kind === 'handrail') return 'rail';
  if (b.kind !== 'fence') return null;
  if (/chain|mesh|wire|barbed|electric|split_rail/.test(ft)) return 'chain';
  if (/pale|picket/.test(ft)) return 'picket';
  if (/wood|board|panel|hit_and_miss|close_boarded|lath/.test(ft) || m === 'wood') return 'wood';
  if (/railing|metal|bars|iron|steel|guard/.test(ft) || m === 'metal') return 'rail';
  return S.region === 'us' ? (rng(b.id)() < 0.5 ? 'wood' : 'chain') : S.region === 'jp' ? 'chain' : 'rail';
}
function placeBarrier(b) {
  const ty = fenceType(b); if (!ty || !b.pts || b.pts.length < 2) return;
  const t = b.tags || {};
  const H0 = { chain: 1.8, wood: 1.8, picket: 1.0, rail: 1.1, wall: b.kind === 'retaining_wall' ? 1.2 : b.kind === 'jersey_barrier' ? 0.8 : 1.6, hedge: 1.5, guard: 0.75 }[ty];
  let H = num(t.height); if (!H || H < 0.3 || H > (ty === 'wall' ? 12 : 6)) H = H0;
  const spec = LIN[ty];
  const isBrick = ty === 'wall' && /brick/.test(t.material || t['wall:material'] || '');
  const thick = ty === 'wall' ? (num(t.width) && num(t.width) < 3 ? num(t.width) : b.kind === 'retaining_wall' ? 0.45 : b.kind === 'jersey_barrier' ? 0.6 : 0.3) : ty === 'hedge' ? (num(t.width) && num(t.width) < 6 ? num(t.width) : 1.0) : 1;
  const wallC = tagColour(t.colour, isBrick ? 0xffffff : b.kind === 'retaining_wall' ? 0xb4b0a6 : /stone/.test(t.material || '') ? 0xc3b59a : 0xc9c5bc);
  const r = rng(b.id);
  const hedgeC = new THREE.Color(0.75 + r() * 0.2, 0.9 + r() * 0.1, 0.7 + r() * 0.2);
  const paintC = ty === 'picket' ? new THREE.Color(0.93, 0.93, 0.9) : ty === 'rail' ? tagColour(t.colour, S.region === 'uk' ? 0x111111 : 0x2a2f2e) : ty === 'wood' ? new THREE.Color(0.9 + r() * 0.1, 0.85 + r() * 0.15, 0.8 + r() * 0.2) : null;
  // pieces
  const pts = b.pts.slice(); if (b.closed && pts.length > 2 && (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1])) pts.push(pts[0]);
  // guard rails face the road
  let flipAll = false;
  if (ty === 'guard') {
    let sum = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, mz = (pts[i][1] + pts[i + 1][1]) / 2, e = nearestEdge(mx, mz);
      if (!e) continue; const dx = pts[i + 1][0] - pts[i][0], dz = pts[i + 1][1] - pts[i][1];
      sum += (-dz) * (e.x - mx) + dx * (e.z - mz);
    }
    flipAll = sum < 0;
  }
  const seq = flipAll ? pts.slice().reverse() : pts;
  for (let i = 0; i + 1 < seq.length; i++) {
    const a = seq[i], c = seq[i + 1], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 0.2) continue;
    const n = Math.max(1, Math.round(L / spec.L));
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      const p0 = [a[0] + (c[0] - a[0]) * t0, a[1] + (c[1] - a[1]) * t0], p1 = [a[0] + (c[0] - a[0]) * t1, a[1] + (c[1] - a[1]) * t1];
      const last = i + 2 === seq.length && k === n - 1;
      const rec = addRec([p0, p1], (rr) => emitPiece(ty, rr, p0, p1, H, thick, spec, { isBrick, wallC, hedgeC, paintC, last }));
      segment(rec, p0, p1, ty === 'wall' ? thick : ty === 'hedge' ? thick : 0.15, H);
    }
  }
}
function emitPiece(ty, r, p0, p1, H, thick, spec, o) {
  const [ax, az] = p0, [bx, bz] = p1, ya = r.ys[0], yb = r.ys[1];
  const L = spec.L;
  if (ty === 'wall') {
    emit(o.isBrick ? 'brickPiece' : 'wallPiece', spanMat(ax, ya - 0.3, az, bx, yb - 0.3, bz, L, (H + 0.3) / 1.9, thick), o.wallC);
    emit('wallCap', spanMat(ax, ya + H, az, bx, yb + H, bz, L, 1, thick));
  } else if (ty === 'hedge') {
    const hs = H / spec.H;
    emit('hedgePiece', spanMat(ax, ya - 0.1, az, bx, yb - 0.1, bz, L, hs * 0.95, thick * 0.85), o.hedgeC);
    emit('hedgeFuzz', spanMat(ax, ya, az, bx, yb, bz, L, hs, thick), o.hedgeC);
  } else if (ty === 'guard') {
    emit('guardRail', spanMat(ax, ya, az, bx, yb, bz, L, 1, 1));
  } else if (ty === 'chain') {
    const hs = H / 1.8;
    emit('chainPost', spanMat(ax, ya, az, bx, yb, bz, L, hs, 1));
    emit('chainMesh', spanMat(ax, ya, az, bx, yb, bz, L, hs, 1));
    if (o.last) emit('chainEnd', base(bx, yb, bz, 0, 1, hs, 1));
  } else if (ty === 'wood') {
    emit('woodPanel', spanMat(ax, ya, az, bx, yb, bz, L, H / 1.8, 1), o.paintC);
  } else if (ty === 'picket') {
    emit('picketPanel', spanMat(ax, ya, az, bx, yb, bz, L, H / 1.0, 1), o.paintC);
  } else if (ty === 'rail') {
    emit('railPanel', spanMat(ax, ya, az, bx, yb, bz, L, H / 1.1, 1), o.paintC);
  }
}

// ---------------------------------------------------------------- public API
const yieldNow = () => new Promise(r => setTimeout(r, 0));
let PRELOAD = null;
// Makes every texture, material and model template without any OSM data (run it while the map downloads).
export function preload() {
  if (!PRELOAD) PRELOAD = (async () => {
    let t = performance.now();
    const step = async () => { if (performance.now() - t > 8) { await yieldNow(); t = performance.now(); } };
    for (const k of Object.keys(TEXDEF)) { texture(k); await step(); }
    materials(); await step();
    for (const name of Object.keys(PARTDEF)) { part(name); await step(); }
  })();
  return PRELOAD;
}

const POINT_KINDS = new Set(['fire_hydrant', 'street_lamp', 'bollard', 'bench', 'waste_basket', 'post_box', 'telephone', 'bus_stop', 'tree']);
export async function build(osm, opts = {}) {
  if (!osm) return props;
  const token = ++TOKEN;
  await preload();
  if (token !== TOKEN) return props;
  if (opts.scene) SCENE = opts.scene;
  TREE_MODE = opts.trees || 'draw';
  const N = freshState();
  N.groundAt = opts.groundAt || (LIVE && LIVE.groundAt) || null;
  N.collide = opts.collide || (LIVE && LIVE.collide) || null;
  N.roads = opts.roads !== undefined ? opts.roads : (LIVE ? LIVE.roads : null);
  N.region0 = (N.roads && N.roads.style && N.roads.style.region) || guessRegion(frame.lat, frame.lon);
  N.region = N.region0 === 'au' ? 'uk' : N.region0; // Australia and New Zealand: British style furniture
  N.left = N.roads && typeof N.roads.leftHand === 'boolean' ? N.roads.leftHand : (N.region === 'uk' || N.region === 'jp');
  N.group = new THREE.Group(); N.group.name = 'props'; N.group.matrixAutoUpdate = false;
  S = N;
  // give the frame loop a turn every 8 ms; a newer build makes this one stop
  let t0 = performance.now();
  const tick = async () => {
    if (performance.now() - t0 < 8) return false;
    await yieldNow(); t0 = performance.now();
    if (token !== TOKEN) return true;
    S = N; return false;
  };

  if (!N.roads || typeof N.roads.nearestEdge !== 'function') { N.edge = new EdgeIndex(); N.edge.addRoads(osm.roads); }
  if (await tick()) return props;

  // traffic signals
  const R = N.roads;
  let groups = [];
  if (R && R.signalGroups && R.signalGroups.size !== undefined) {
    groups = [...R.signalGroups.values()];
    if (R.signals) for (const [nid, gid] of R.signals) N.sigMap.set(nid, gid);
  } else groups = deriveSignals(osm);
  for (const g of groups) {
    if (N.done.has('g' + g.id)) continue;
    N.done.add('g' + g.id); for (const n of g.nodes || []) N.sigMap.set(n, g.id);
    placeSignalGroup(g);
    if (await tick()) return props;
  }

  // signs
  const signs = R && Array.isArray(R.signs) ? R.signs : deriveSigns(osm);
  for (const sg of signs) {
    const k = 's' + sg.id + ':' + Math.round(sg.heading); if (N.done.has(k)) continue; N.done.add(k);
    placeSign(sg);
    if (await tick()) return props;
  }

  // points (not those inside a building: indoor benches, roof garden trees)
  // power first, so street lamps mapped on a utility pole can hang on it
  placePower(osm);
  N.bld = new BuildingIndex(); N.bld.add(osm.buildings);
  if (await tick()) return props;
  for (const p of osm.points) {
    const k = 'n' + p.id; if (N.done.has(k)) continue;
    if (POINT_KINDS.has(p.kind) && N.bld.inside(p.x, p.z, 0.3)) { N.done.add(k); continue; }
    switch (p.kind) {
      case 'fire_hydrant': N.done.add(k); placeHydrant(p); break;
      case 'street_lamp': N.done.add(k); placeLamp(p); break;
      case 'bollard': N.done.add(k); placeBollard(p); break;
      case 'bench': N.done.add(k); placeBench(p); break;
      case 'waste_basket': N.done.add(k); placeBin(p); break;
      case 'post_box': N.done.add(k); placePostBox(p); break;
      case 'telephone': N.done.add(k); placePhone(p); break;
      case 'bus_stop': N.done.add(k); placeBusStop(p); break;
      case 'tree': N.done.add(k); placeTree(p.x, p.z, p.tags, p.id, false); break;
      case 'crossing': N.done.add(k); placeCrossing(p); break;
      default: continue;
    }
    if (await tick()) return props;
  }
  // tree rows: one tree every 8 m or so
  for (const row of osm.treeRows) {
    if (N.done.has('t' + row.id)) continue; N.done.add('t' + row.id);
    const pts = row.pts; if (!pts || pts.length < 2) continue;
    const r = rng(row.id), step = 8;
    let carry = step / 2;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let s = carry;
      while (s < L) {
        const f = s / L, j = (r() - 0.5) * 1.2;
        placeTree(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, row.tags, row.id * 131 + i * 17 + Math.round(s * 10), true);
        s += step + j;
      }
      carry = s - L;
    }
    if (await tick()) return props;
  }
  // barriers
  for (const b of osm.barriers) {
    if (N.done.has('b' + b.id)) continue; N.done.add('b' + b.id);
    placeBarrier(b);
    if (await tick()) return props;
  }
  for (const b of N.bins.values()) { rebuildBin(b); if (await tick()) return props; }
  for (const G of N.groups.values()) stepGroup(G);
  recolourLenses(N, true);
  // swap in one step
  if (LIVE) retire(LIVE);
  if (SCENE) SCENE.add(N.group);
  LIVE = N;
  return props;
}

function retire(st) {
  if (st.group && st.group.parent) st.group.parent.remove(st.group);
  for (const b of st.bins.values()) for (const m of b.meshes.values()) m.dispose();
  // its collision shapes go too (harmless when the store was cleared for the new build)
  if (st.collide && st.collide.remove) for (const r of st.recs) if (r.cols) for (const c of r.cols) if (c.s) st.collide.remove(c.s);
}

const _cam = new THREE.Vector3();
export function update(dt, camera) {
  const st = LIVE; if (!st) return;
  // bins far from the camera are hidden (fog has them by then)
  if (camera && camera.isObject3D) {
    camera.getWorldPosition(_cam);
    for (const b of st.bins.values()) {
      const [i, j] = b.key.split(',').map(Number), cx = (i + 0.5) * BIN, cz = (j + 0.5) * BIN;
      const vis = Math.hypot(_cam.x - cx, _cam.z - cz) < 1400;
      if (b.vis !== vis) { b.vis = vis; for (const m of b.meshes.values()) m.visible = vis; }
    }
  }
  const keep = S; S = st;
  let any = false;
  for (const G of st.groups.values()) { stepGroup(G); if (G.changed) any = true; }
  if (any) recolourLenses(st, false);
  S = keep;
}

export function signalAt(nodeId, heading) {
  const st = LIVE || S, R = st.roads;
  let gid = R && R.signals ? R.signals.get(nodeId) : undefined;
  let g = gid != null && R.signalGroups ? R.signalGroups.get(gid) : null;
  if (!g) { gid = st.sigMap.get(nodeId); const G = gid != null ? st.groups.get(gid) : null; g = G ? G.src : null; }
  return g ? SIG.state(g, heading).s : 'green';
}

export function reheight(bbox) {
  const st = LIVE; if (!st) return 0;
  const keep = S; S = st;
  try {
    const x0 = (bbox ? bbox.x0 : -Infinity) - 1, x1 = (bbox ? bbox.x1 : Infinity) + 1, z0 = (bbox ? bbox.z0 : -Infinity) - 1, z1 = (bbox ? bbox.z1 : Infinity) + 1;
    const touched = new Set(), moved = new Set();
    for (const rec of st.recs) {
      let hit = false;
      for (const p of rec.pts) if (p[0] >= x0 && p[0] <= x1 && p[1] >= z0 && p[1] <= z1) { hit = true; break; }
      if (!hit) continue;
      const before = rec.ys.slice();
      sample(rec);
      let ch = false; for (let i = 0; i < before.length; i++) if (Math.abs(before[i] - rec.ys[i]) > 0.005) ch = true;
      if (ch) { touched.add(rec.bin); moved.add(rec); }
    }
    if (moved.size) for (const w of st.wires) if (moved.has(w.wire.A.rec) || moved.has(w.wire.B.rec)) touched.add(w.bin);
    for (const k of touched) { const b = st.bins.get(k); if (b) rebuildBin(b); }
    if (touched.size) recolourLenses(st, true);
    return touched.size;
  } finally { S = keep; }
}

// Records still standing on a guessed height (no ground there yet).
export function pending() { let n = 0; if (LIVE) for (const r of LIVE.recs) if (!r.ok) n++; return n; }

export function reset() {
  TOKEN++;
  if (LIVE) retire(LIVE);
  LIVE = null; S = freshState();
}

export function stats() {
  const st = LIVE || S;
  let meshes = 0, inst = 0; const byPart = {};
  for (const b of st.bins.values()) for (const [n, m] of b.meshes) { meshes++; inst += m.count; byPart[n] = (byPart[n] || 0) + m.count; }
  return { bins: st.bins.size, meshes, instances: inst, records: st.recs.length, groups: st.groups.size, wires: st.wires.length, region: st.region, leftHand: st.left, byPart };
}

export const props = { preload, build, update, signalAt, reheight, reset, dispose: reset, pending, stats, get groups() { return (LIVE || S).groups; }, get group() { return LIVE ? LIVE.group : null; } };
export default props;
