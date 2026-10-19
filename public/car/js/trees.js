// Trees for the open world: OSM's trees (natural=tree nodes, tree rows, woods and parks) and the trees the
// satellite picture shows (dark, textured green outside buildings and roads, split into crowns at the peaks of a
// distance transform, so each crown is placed and sized where it really is). Drawn cheaply: crowns are clusters
// of leaf sprites that turn to face the camera (and the sun, for their shadows), palms are drooping frond cards,
// trunks are tapered prisms; every kind is one InstancedMesh, so all the trees are a handful of draw calls.
//
//   const t = trees.build(osmData or { points, areas, treeRows }, { groundAt, scene, imagery, collide,
//                         roadsMask, buildings, roads, centre: [x, z], radius, lean: [kx, kz] })
//   t.group, t.ready (Promise of stats), t.dispose()
import * as THREE from 'three';
import { frame } from './geo.js?v=2';

const D2R = Math.PI / 180;
function hashf(n, salt = 0) {
  let h = (Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x632be5ab, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }
function inRing(x, z, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
const num = (v) => { if (v == null) return null; const m = /^\s*([\d.]+)/.exec(String(v)); return m ? parseFloat(m[1]) : null; };

// ---------- textures, drawn once ----------
let TEX = null;
const TEXMEAN = {};
function textures() {
  if (TEX) return TEX;
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  // a cluster of leaves, light in the middle, darker leaves behind
  const leaf = (dark) => {
    const c = mk(256, 256), g = c.getContext('2d'), r = rng(dark ? 7 : 3);
    // clumps of leaves round the middle, so the sprite's edge is ragged rather than a disc
    const clumps = [];
    for (let i = 0; i < 9; i++) { const a = r() * Math.PI * 2, d = i === 0 ? 0 : 30 + r() * 52; clumps.push([128 + Math.cos(a) * d, 128 + Math.sin(a) * d * 0.9, 26 + r() * 22]); }
    for (let layer = 0; layer < 3; layer++) {
      const n = [900, 700, 500][layer];
      for (let i = 0; i < n; i++) {
        const cl = clumps[Math.floor(r() * clumps.length)];
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * cl[2] * (1 - layer * 0.12);
        const x = cl[0] + Math.cos(a) * d, y = cl[1] + Math.sin(a) * d;
        if ((x - 128) ** 2 + (y - 128) ** 2 > 124 * 124) continue;
        const l = (dark ? 20 : 26) + layer * 9 + r() * 12 - (y - 128) * 0.04;
        const hue = dark ? 125 + r() * 25 : 78 + r() * 30;
        g.fillStyle = `hsl(${hue}, ${dark ? 22 : 30 + r() * 12}%, ${l}%)`;
        g.save(); g.translate(x, y); g.rotate(r() * Math.PI);
        g.beginPath();
        if (dark) g.ellipse(0, 0, 6 + r() * 4, 1.6, 0, 0, Math.PI * 2);
        else g.ellipse(0, 0, 3.5 + r() * 3, 2 + r() * 1.5, 0, 0, Math.PI * 2);
        g.fill(); g.restore();
      }
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  };
  // a palm frond: a midrib with leaflets
  const frond = () => {
    const c = mk(256, 64), g = c.getContext('2d'), r = rng(11);
    g.strokeStyle = 'hsl(80, 30%, 30%)'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 32); g.lineTo(256, 32); g.stroke();
    for (let i = 0; i < 70; i++) {
      const x = 6 + i * 3.5, len = 28 * Math.sin(Math.min(1, x / 256) * Math.PI) + 4;
      for (const s of [-1, 1]) {
        g.strokeStyle = `hsl(${80 + r() * 25}, ${35 + r() * 15}%, ${22 + r() * 14}%)`; g.lineWidth = 2;
        g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 10, 32 + s * len * (0.8 + r() * 0.2)); g.stroke();
      }
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const bark = () => {
    const c = mk(64, 256), g = c.getContext('2d'), r = rng(5);
    g.fillStyle = '#5a4a3c'; g.fillRect(0, 0, 64, 256);
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${30 + r() * 60},${25 + r() * 45},${20 + r() * 35},0.5)`; g.fillRect(r() * 64, r() * 256, 1 + r() * 3, 6 + r() * 30); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };
  TEX = { broad: leaf(false), conifer: leaf(true), frond: frond(), bark: bark() };
  // mean linear colour of the opaque leaves, to turn a target colour into a tint
  for (const k of ['broad', 'conifer']) {
    const c = TEX[k].image, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 16) if (d[i + 3] > 128) { r += (d[i] / 255) ** 2.2; g += (d[i + 1] / 255) ** 2.2; b += (d[i + 2] / 255) ** 2.2; n++; }
    TEXMEAN[k] = [r / n, g / n, b / n];
  }
  return TEX;
}

// ---------- crown geometry: sprites around a unit crown, each turned to the view in the vertex shader ----------
function spriteCrown(kind) {
  const r = rng(kind === 'conifer' ? 21 : 13);
  const pos = [], nrm = [], corner = [], uv = [], idx = [], sid = [];
  const n = kind === 'conifer' ? 11 : 9;
  for (let i = 0; i < n; i++) {
    let x, y, z, s;
    if (kind === 'conifer') {
      // a cone: y from -1 (base) to 1 (tip), narrowing
      y = -0.9 + 1.7 * (i / (n - 1)) + (r() - 0.5) * 0.1;
      const w = 0.95 * (1 - (y + 1) / 2.05);
      const a = r() * Math.PI * 2; x = Math.cos(a) * w * 0.45; z = Math.sin(a) * w * 0.45;
      s = 0.3 + w * 0.85;
    } else {
      // a ball, mostly near its surface
      let d; do { x = r() * 2 - 1; y = r() * 2 - 1; z = r() * 2 - 1; d = Math.hypot(x, y, z); } while (d > 1 || d < 0.2);
      const k = (0.35 + 0.35 * r()) / d; x *= k; y *= k * 0.9; z *= k;
      s = 0.74 + r() * 0.3;
    }
    const rot = r() * Math.PI * 2;
    const nl = Math.hypot(x, y + 0.25, z) || 1;
    const base = pos.length / 3;
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const ca = Math.cos(rot), sa = Math.sin(rot);
      pos.push(x, y, z); nrm.push(x / nl, (y + 0.25) / nl, z / nl);
      corner.push((cx * ca - cy * sa) * s, (cx * sa + cy * ca) * s);
      uv.push((cx + 1) / 2, (cy + 1) / 2);
      sid.push(i);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute(corner, 2));
  g.setAttribute('aSid', new THREE.Float32BufferAttribute(sid, 1));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2.2);
  return g;
}

const SPRITE_VERT = /* glsl */`
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
mvPosition = instanceMatrix * mvPosition;
float spS = length( instanceMatrix[ 0 ].xyz );
#else
float spS = 1.0;
#endif
mvPosition = modelViewMatrix * mvPosition;
#ifdef SPRITE_LOD
// far away a crown is its first sprite, grown to cover it: a fraction of the overdraw
float spFar = smoothstep( 110.0, 170.0, -mvPosition.z );
float spK = aSid < 0.5 ? 1.0 + 0.7 * spFar : 1.0 - spFar;
#else
float spK = 1.0;
#endif
mvPosition.xy += aCorner * spS * spK;
gl_Position = projectionMatrix * mvPosition;
`;
function spritePatch(m, key, lod = true) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aCorner;\nattribute float aSid;' + (lod ? '\n#define SPRITE_LOD' : ''))
      .replace('#include <project_vertex>', SPRITE_VERT);
    if (sh.fragmentShader.includes('#include <lights_fragment_end>')) {
      // light through the leaves: never quite black on the shaded side
      sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.indirectDiffuse += diffuseColor.rgb * 0.06;');
    }
  };
  m.customProgramCacheKey = () => 'sprite-' + key;
  return m;
}

function frondCrown() {
  // drooping fronds from the top, each a bent strip of three quads
  const pos = [], nrm = [], uv = [], idx = [];
  const n = 11, r = rng(9);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.3, up = 0.5 - r() * 0.4, len = 1.0 + r() * 0.2;
    const dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx;
    const base = pos.length / 3;
    for (let k = 0; k <= 3; k++) {
      const t = k / 3, d = t * len, y = up * d - 0.9 * d * d;
      for (const s of [-1, 1]) {
        const w = 0.22 * Math.sin(Math.min(1, t * 1.1 + 0.08) * Math.PI) + 0.03;
        pos.push(dx * d + px * s * w, y, dz * d + pz * s * w);
        nrm.push(0, 1, 0);
        uv.push(t, s < 0 ? 0 : 1);
      }
    }
    for (let k = 0; k < 3; k++) { const b = base + k * 2; idx.push(b, b + 1, b + 3, b, b + 3, b + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function trunkGeo() {
  // unit trunk: height 1 from y 0, radius 1 at the foot tapering to 0.6, six sides
  const g = new THREE.CylinderGeometry(0.6, 1, 1, 6, 1, true);
  g.translate(0, 0.5, 0);
  return g;
}

// ---------- finding trees in the satellite picture ----------
async function treesFromImagery(imagery, box, opts, stats) {
  const px = await Promise.race([
    imagery.pixels(box.x0, box.z0, box.x1, box.z1, { zoom: opts.zoom ?? 18, maxSize: 4096, slice: opts.slice }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('imagery timeout')), 25000)),
  ]);
  const { data, w, h } = px;
  let tp = performance.now(); const ph = stats.phase || (stats.phase = {});
  const mark = (k) => { const n = performance.now(); ph[k] = Math.max(ph[k] || 0, Math.round(n - tp)); tp = n; };
  const slice = opts.slice || (async () => {});
  mark('L207'); await slice('L207'); tp = performance.now();
  const sx = w / (px.x1 - px.x0), sz = h / (px.z1 - px.z0);
  const G = 1.0;                                  // grid cell, metres
  const gw = Math.ceil((px.x1 - px.x0) / G), gh = Math.ceil((px.z1 - px.z0) / G);
  const exg = new Float32Array(gw * gh), lum = new Float32Array(gw * gh), lum2 = new Float32Array(gw * gh);
  const gbS = new Float32Array(gw * gh), grS = new Float32Array(gw * gh);
  const cnt = new Float32Array(gw * gh);
  for (let j = 0; j < h; j++) {
    const gz = Math.min(gh - 1, Math.floor(j / sz / G));
    for (let i = 0; i < w; i++) {
      const k = (j * w + i) * 4, r = data[k], g = data[k + 1], b = data[k + 2];
      const c = gz * gw + Math.min(gw - 1, Math.floor(i / sx / G));
      const l = 0.3 * r + 0.59 * g + 0.11 * b;
      const sum = r + g + b + 30;
      exg[c] += (2 * g - r - b) / sum; gbS[c] += (g - b) / sum; grS[c] += (g - r) / sum; lum[c] += l; lum2[c] += l * l; cnt[c]++;
    }
    if ((j & 31) === 31) await slice('acc');
  }
  mark('L224'); await slice('L224'); tp = performance.now();
  // blocked cells: buildings, roads, water
  const blocked = new Uint8Array(gw * gh);
  const fillPoly = (ring, v) => {
    let z0 = Infinity, z1 = -Infinity;
    for (const p of ring) { z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    const j0 = Math.max(0, Math.floor((z0 - px.z0) / G)), j1 = Math.min(gh - 1, Math.floor((z1 - px.z0) / G));
    for (let j = j0; j <= j1; j++) {
      const z = px.z0 + (j + 0.5) * G, xs = [];
      for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
        const p = ring[a], q = ring[b];
        if ((p[1] > z) !== (q[1] > z)) xs.push(p[0] + (z - p[1]) / (q[1] - p[1]) * (q[0] - p[0]));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - px.x0) / G - 0.5)), i1 = Math.min(gw - 1, Math.floor((xs[k + 1] - px.x0) / G - 0.5));
        for (let i = i0; i <= i1; i++) blocked[j * gw + i] = v;
      }
    }
  };
  { let n = 0; for (const b of opts.buildings || []) { if (b.outer && b.outer.length > 2) fillPoly(b.outer, 1); if ((++n & 63) === 0) await slice('bld'); } }
  for (const a of opts.areas || []) if (a.kind === 'water' && a.outer) fillPoly(a.outer, 1);
  const RW = { motorway: 7, trunk: 7, primary: 6, secondary: 5, tertiary: 4.5, unclassified: 3.5, residential: 3.5, service: 2.2, living_street: 3, motorway_link: 3.5, trunk_link: 3.5, primary_link: 3.5, secondary_link: 3, tertiary_link: 3 };
  let nr = 0;
  for (const r of opts.roads || []) {
    if ((++nr & 15) === 0) await slice('roads');
    const hw = RW[r.highway]; if (!hw || !r.pts) continue;
    const t = r.tags || {};
    if (t.tunnel && t.tunnel !== 'no') continue;
    const half = (num(t.width) ? num(t.width) / 2 : hw * (num(t.lanes) ? Math.max(1, num(t.lanes)) / 2 : 1)) - 0.5;
    for (let k = 0; k + 1 < r.pts.length; k++) {
      const [ax, az] = r.pts[k], [bx, bz] = r.pts[k + 1];
      const len = Math.hypot(bx - ax, bz - az), steps = Math.ceil(len / 0.7);
      for (let s = 0; s <= steps; s++) {
        const x = ax + (bx - ax) * s / steps, z = az + (bz - az) * s / steps;
        const rr = Math.ceil(half / G);
        const ci = Math.floor((x - px.x0) / G), cj = Math.floor((z - px.z0) / G);
        for (let dj = -rr; dj <= rr; dj++) for (let di = -rr; di <= rr; di++) {
          if (di * di + dj * dj > (half / G) * (half / G)) continue;
          const i = ci + di, j = cj + dj; if (i >= 0 && j >= 0 && i < gw && j < gh) blocked[j * gw + i] = 1;
        }
      }
    }
  }

  mark('L267'); await slice('L267'); tp = performance.now();
  // canopy: green beyond grey, not bright like a lawn, textured
  const can = new Uint8Array(gw * gh);
  let nc = 0;
  const L1 = new Float32Array(gw * gh);
  for (let c = 0; c < gw * gh; c++) L1[c] = cnt[c] ? lum[c] / cnt[c] : 0;
  for (let j = 1; j < gh - 1; j++) for (let i = 1; i < gw - 1; i++) {
    if (i === 1 && (j & 31) === 0) await slice('class');
    const c = j * gw + i;
    if (!cnt[c] || blocked[c]) continue;
    const n = cnt[c], l = L1[c], gb = gbS[c] / n, gr = grS[c] / n;
    if (!(l > 12 && l < 130 && gr > 0.02)) continue;
    const sd = Math.sqrt(Math.max(0, lum2[c] / n - l * l));
    // crowns are lumpy (lit tops, shaded sides) over a few metres, lawns, fields and shade on pavement are smooth
    let s1 = 0, s2 = 0;
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const q = L1[c + b * gw + a]; s1 += q; s2 += q * q; }
    const nsd = Math.sqrt(Math.max(0, s2 / 9 - (s1 / 9) ** 2));
    let tree = false;
    if (gb > 0.07) tree = nsd > (opts.rough ?? 6.5) || (l < 60 && sd > 2.5 && gb > 0.095);
    // foliage in shade: the picture tints it blue, so ask for red well under green and real texture
    else if (gb > -0.08) tree = l < 80 && gr > 0.05 && sd > 4 && nsd > 4;
    if (tree) { can[c] = 1; nc++; }
  }
  // the caller's road mask, asked only where there is canopy
  if (opts.roadsMask) {
    const m = typeof opts.roadsMask === 'function' ? opts.roadsMask : (opts.roadsMask.at ? (x, z) => opts.roadsMask.at(x, z) : null);
    if (m) for (let c = 0; c < gw * gh; c++) if (can[c]) { try { if (m(px.x0 + (c % gw + 0.5) * G, px.z0 + (((c / gw) | 0) + 0.5) * G)) { can[c] = 0; blocked[c] = 1; nc--; } } catch (e) {} }
  }
  // close small gaps (a crown seen in pieces between its own shadows): dilate twice, erode twice
  const morph = (src, grow) => {
    const out = new Uint8Array(gw * gh);
    for (let j = 1; j < gh - 1; j++) for (let i = 1; i < gw - 1; i++) {
      const c = j * gw + i;
      if (grow) out[c] = src[c] | src[c - 1] | src[c + 1] | src[c - gw] | src[c + gw];
      else out[c] = src[c] & src[c - 1] & src[c + 1] & src[c - gw] & src[c + gw];
    }
    return out;
  };
  {
    let m = morph(morph(can, true), true);
    for (let c = 0; c < gw * gh; c++) if (blocked[c]) m[c] = 0;
    m = morph(morph(m, false), false);
    for (let c = 0; c < gw * gh; c++) can[c] = can[c] | m[c];
  }
  // drop specks: a canopy cell needs 3 canopy neighbours
  const can2 = new Uint8Array(gw * gh);
  for (let j = 1; j < gh - 1; j++) for (let i = 1; i < gw - 1; i++) {
    const c = j * gw + i; if (!can[c]) continue;
    const n = can[c - 1] + can[c + 1] + can[c - gw] + can[c + gw] + can[c - gw - 1] + can[c - gw + 1] + can[c + gw - 1] + can[c + gw + 1];
    if (n >= 3) can2[c] = 1;
  }
  mark('L317'); await slice('L317'); tp = performance.now();
  // distance to the canopy's edge (chamfer 3-4), in metres
  const INF = 1e9, dist = new Float32Array(gw * gh);
  for (let c = 0; c < gw * gh; c++) dist[c] = can2[c] ? INF : 0;
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const c = j * gw + i; if (!dist[c]) continue;
    let d = dist[c];
    if (i > 0) d = Math.min(d, dist[c - 1] + 1); else d = Math.min(d, 1);
    if (j > 0) { d = Math.min(d, dist[c - gw] + 1); if (i > 0) d = Math.min(d, dist[c - gw - 1] + 1.414); if (i < gw - 1) d = Math.min(d, dist[c - gw + 1] + 1.414); } else d = Math.min(d, 1);
    dist[c] = d;
  }
  for (let j = gh - 1; j >= 0; j--) for (let i = gw - 1; i >= 0; i--) {
    const c = j * gw + i; if (!dist[c]) continue;
    let d = dist[c];
    if (i < gw - 1) d = Math.min(d, dist[c + 1] + 1); else d = Math.min(d, 1);
    if (j < gh - 1) { d = Math.min(d, dist[c + gw] + 1); if (i < gw - 1) d = Math.min(d, dist[c + gw + 1] + 1.414); if (i > 0) d = Math.min(d, dist[c + gw - 1] + 1.414); } else d = Math.min(d, 1);
    dist[c] = d;
  }
  mark('L335'); await slice('L335'); tp = performance.now();
  // crowns: greedy from the deepest cells
  const cand = [];
  for (let c = 0; c < gw * gh; c++) if (dist[c] >= 1.4) cand.push(c);
  cand.sort((a, b) => dist[b] - dist[a]);
  const out = [], grid = new Map(), GC = 8;
  // the crown's mean colour in the picture (sRGB 0..1), from the pixels inside 70% of its radius
  const crownColour = (x, z, r) => {
    let R = 0, Gs = 0, B = 0, n = 0;
    const rr = r * 0.7, i0 = Math.floor((x - rr - px.x0) * sx), i1 = Math.ceil((x + rr - px.x0) * sx), j0 = Math.floor((z - rr - px.z0) * sz), j1 = Math.ceil((z + rr - px.z0) * sz);
    const step = Math.max(1, Math.floor((i1 - i0) / 8));
    for (let j = Math.max(0, j0); j < Math.min(h, j1); j += step) for (let i = Math.max(0, i0); i < Math.min(w, i1); i += step) {
      const dx = (i / sx + px.x0) - x, dz = (j / sz + px.z0) - z; if (dx * dx + dz * dz > rr * rr) continue;
      const k = (j * w + i) * 4; R += data[k]; Gs += data[k + 1]; B += data[k + 2]; n++;
    }
    return n ? [R / n / 255, Gs / n / 255, B / n / 255] : null;
  };
  const key = (x, z) => Math.floor(x / GC) + ',' + Math.floor(z / GC);
  const lean = opts.lean || [0, 0];
  let nci = 0;
  for (const c of cand) {
    if ((++nci & 1023) === 0) await slice('crowns');
    const i = c % gw, j = (c / gw) | 0;
    let x = px.x0 + (i + 0.5) * G, z = px.z0 + (j + 0.5) * G;
    const r = Math.min(dist[c] * G + 0.8, 5.0 + hashf(c, 3) * 2.5);
    let ok = true;
    const kx = Math.floor(x / GC), kz = Math.floor(z / GC);
    for (let a = -1; a <= 1 && ok; a++) for (let b = -1; b <= 1 && ok; b++) {
      const l = grid.get((kx + a) + ',' + (kz + b)); if (!l) continue;
      for (const t of l) if (Math.hypot(t.x - x, t.z - z) < (t.r + r) * 0.72) { ok = false; break; }
    }
    if (!ok) continue;
    const t = { x, z, r, src: 'img', c: (opts.idBase || 0) + c, col: null };
    const k = key(x, z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(t);
    out.push(t);
  }
  // only this block's own crowns (the margin is there for the distance transform)
  const core = opts.core;
  const own = core ? out.filter(t => t.x >= core.x0 && t.x < core.x1 && t.z >= core.z0 && t.z < core.z1) : out;
  out.length = 0; out.push(...own);
  for (const t of out) t.col = crownColour(t.x, t.z, t.r);
  // the picture shows a crown displaced by its height times the lean; put the trunk back under it
  for (const t of out) { const hc = 2.0 * t.r + 1.5; t.x -= lean[0] * hc; t.z -= lean[1] * hc; }
  stats.canopyCells = (stats.canopyCells || 0) + nc; stats.imageTrees = (stats.imageTrees || 0) + out.length;
  if (opts.debug) {
    // the picture with the canopy (green), blocked cells (blue) and the crowns (red rings), one pixel a cell
    const c = document.createElement('canvas'); c.width = gw; c.height = gh;
    const g = c.getContext('2d'), id = g.createImageData(gw, gh);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const k = (j * gw + i) * 4, cc = j * gw + i, l = cnt[cc] ? lum[cc] / cnt[cc] : 0;
      let r = l, gg = l, b = l;
      if (blocked[cc]) { b = 0.6 * b + 90; }
      if (can2[cc]) { gg = 0.5 * gg + 120; r *= 0.5; b *= 0.5; }
      id.data[k] = r; id.data[k + 1] = gg; id.data[k + 2] = b; id.data[k + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    g.strokeStyle = '#f00';
    for (const t of out) { g.beginPath(); g.arc((t.x + lean[0] * (2 * t.r + 1.5) - px.x0) / G, (t.z + lean[1] * (2 * t.r + 1.5) - px.z0) / G, t.r / G, 0, 7); g.stroke(); }
    stats.debugCanvas = c;
    stats.cellAt = (i, j) => { const cc = j * gw + i, n = cnt[cc] || 1; return [+(lum[cc] / n).toFixed(1), +(Math.sqrt(Math.max(0, lum2[cc] / n - (lum[cc] / n) ** 2))).toFixed(1), +(gbS[cc] / n).toFixed(3), +(grS[cc] / n).toFixed(3), can2[cc], blocked[cc]]; };
    stats.grid = [gw, gh];
    const raw = document.createElement('canvas'); raw.width = w; raw.height = h;
    const rg = raw.getContext('2d'), rd = rg.createImageData(w, h); rd.data.set(data); rg.putImageData(rd, 0, 0);
    stats.rawCanvas = raw;
  }
  return { list: out, has: (x, z) => { const i = Math.floor((x - px.x0) / G), j = Math.floor((z - px.z0) / G); return i >= 0 && j >= 0 && i < gw && j < gh ? can2[j * gw + i] : 0; }, dist: (x, z) => { const i = Math.floor((x - px.x0) / G), j = Math.floor((z - px.z0) / G); return i >= 0 && j >= 0 && i < gw && j < gh ? dist[j * gw + i] * G : 0; } };
}

// ---------- species ----------
function kindOf(tags, h, region) {
  const t = tags || {};
  const g = String(t.genus || t.species || t.taxon || '').toLowerCase();
  if (/phoenix|washingtonia|syagrus|palm|trachycarpus|archontophoenix|butia|chamaerops/.test(g) || /palm/i.test(t['species:en'] || '')) return 'palm';
  if (t.leaf_type === 'needleleaved' || /pinus|picea|abies|cedrus|sequoia|cupressus|thuja|juniperus|taxus|pseudotsuga|metasequoia|cryptomeria|chamaecyparis/.test(g)) return 'conifer';
  if (t.leaf_type === 'broadleaved' || g) return 'broad';
  if (region === 'ca') return h < 0.03 ? 'palm' : h < 0.16 ? 'conifer' : 'broad';
  return h < 0.12 ? 'conifer' : 'broad';
}

// ---------- the public builder ----------
// The picture's crowns by block, kept for the visit: a rebuild over the same ground finds them done.
const BLOCK = 300, MARGIN = 16;
const blockCache = new Map(); // key -> Promise<{ list, has, dist } | null>
let retiring = [];            // groups of disposed builds, kept on screen until the next build is ready

export function build(src, opts = {}) {
  const { scene, imagery, collide } = opts;
  const groundAt = opts.groundAt || (() => 0);
  const parent = opts.parent || scene;
  const group = new THREE.Group(); group.name = 'trees';
  const stats = { osmTrees: 0, rowTrees: 0, areaTrees: 0, imageTrees: 0, total: 0, blocks: 0, reusedBlocks: 0, ms: 0 };
  const objs = [], handles = [];
  let disposed = false, done = false;
  const adopted = retiring; retiring = [];
  const region = (frame.lon < -114 && frame.lon > -125 && frame.lat > 32 && frame.lat < 42) ? 'ca' : 'other';
  const S = src || {};
  const points = (S.points || []).filter(p => p.kind === 'tree');
  const rows = S.treeRows || [];
  const areas = S.areas || [];
  const buildingsList = opts.buildings || S.buildings || [];
  const roads = Array.isArray(opts.roads) ? opts.roads : (S.roads || []);
  // a roads object (roads.js) gives a better mask than the OSM lines: no trunk on a carriageway
  let roadsMask = opts.roadsMask || null;
  if (!roadsMask && opts.roads && typeof opts.roads.surfaceAt === 'function') roadsMask = (x, z) => { const r = opts.roads.surfaceAt(x, z); return !!(r && r.onRoad); };

  let t0 = performance.now();
  const slice = async (where) => { const d = performance.now() - t0; if (d > 8) { if (d > 40) (stats.slow || (stats.slow = [])).push((where || '?') + ':' + Math.round(d)); await new Promise(r => setTimeout(r, 0)); t0 = performance.now(); } };

  const ready = (async () => {
    await null;
    const tStart = performance.now();
    const list = [];
    for (const p of points) {
      const t = p.tags || {};
      const hgt = num(t.height), dc = num(t.diameter_crown);
      list.push({ x: p.x, z: p.z, r: dc ? dc / 2 : null, h: hgt, tags: t, src: 'osm', id: p.id });
    }
    stats.osmTrees = list.length;
    for (const row of rows) {
      const pts = row.pts || [];
      for (let k = 0; k + 1 < pts.length; k++) {
        const [ax, az] = pts[k], [bx, bz] = pts[k + 1], len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 8));
        for (let s = 0; s < n; s++) list.push({ x: ax + (bx - ax) * s / n, z: az + (bz - az) * s / n, r: null, h: null, tags: row.tags, src: 'row', id: row.id * 31 + k * 7 + s });
        stats.rowTrees += n;
      }
    }
    // the box the trees may cover
    let box = null;
    if (opts.centre || opts.radius) {
      const c = opts.centre || [0, 0], R = opts.radius || 600;
      box = { x0: c[0] - R, z0: c[1] - R, x1: c[0] + R, z1: c[1] + R };
    } else if (S.bbox) box = { ...S.bbox };
    // the picture's crowns, block by block, nearest first
    const crowns = [], probes = [];
    if (imagery && imagery.pixels && box && opts.fromImagery !== false) {
      const cam = opts.world && opts.world.camera;
      const fx = opts.focus ? opts.focus[0] : cam ? cam.position.x : (box.x0 + box.x1) / 2, fz = opts.focus ? opts.focus[1] : cam ? cam.position.z : (box.z0 + box.z1) / 2;
      const B = opts.debug ? Math.max(box.x1 - box.x0, box.z1 - box.z0) : BLOCK;
      const blocks = [];
      for (let bz = Math.floor(box.z0 / B); bz * B < box.z1; bz++) for (let bx = Math.floor(box.x0 / B); bx * B < box.x1; bx++) blocks.push([bx, bz, Math.hypot((bx + 0.5) * B - fx, (bz + 0.5) * B - fz)]);
      blocks.sort((a, b) => a[2] - b[2]);
      const lean = opts.lean || [0, 0];
      if (opts.debug) { blocks.length = 0; blocks.push([0, 0, 0]); }
      for (const [bx, bz] of blocks) {
        if (disposed) return stats;
        const core = opts.debug ? { ...box } : { x0: Math.max(box.x0, bx * B), z0: Math.max(box.z0, bz * B), x1: Math.min(box.x1, (bx + 1) * B), z1: Math.min(box.z1, (bz + 1) * B) };
        if (core.x1 - core.x0 < 1 || core.z1 - core.z0 < 1) continue;
        const key = (opts.zoom ?? 18) + '|' + B + '|' + bx + ',' + bz + '|' + [core.x0, core.z0, core.x1, core.z1].map(v => Math.round(v)).join(',') + '|' + lean[0].toFixed(2) + ',' + lean[1].toFixed(2) + (opts.debug ? '|d' : '');
        let pr = blockCache.get(key);
        if (pr) stats.reusedBlocks++;
        else {
          const ob = { x0: core.x0 - MARGIN, z0: core.z0 - MARGIN, x1: core.x1 + MARGIN, z1: core.z1 + MARGIN };
          const inBox = (pts) => {
            let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
            for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1]; }
            return x1 > ob.x0 - 10 && x0 < ob.x1 + 10 && z1 > ob.z0 - 10 && z0 < ob.z1 + 10;
          };
          const bl = buildingsList.filter(b => b.outer && inBox(b.outer));
          const rl = roads.filter(r => r.pts && inBox(r.pts));
          const al = areas.filter(a => a.kind === 'water' && a.outer && inBox(a.outer));
          pr = treesFromImagery(imagery, ob, { ...opts, core, slice, buildings: bl, roads: rl, areas: al, roadsMask, idBase: (bx * 7919 + bz * 104729) * 1000003 }, stats)
            .catch(e => { console.warn('trees: imagery', e); return null; });
          blockCache.set(key, pr);
          pr.then(v => { if (!v) blockCache.delete(key); });
        }
        const res = await pr;
        t0 = performance.now();
        stats.blocks++;
        if (res) { for (const t of res.list) crowns.push(t); probes.push({ core, res }); }
        await slice('L496');
      }
    }
    if (disposed) return stats;
    const probeAt = (x, z) => { for (const p of probes) if (x >= p.core.x0 && x < p.core.x1 && z >= p.core.z0 && z < p.core.z1) return p.res; return null; };
    // woods and parks: scattered where the picture could not say (no imagery)
    if (!probes.length) {
      for (const a of areas) {
        if (!a.outer || a.outer.length < 3) continue;
        const wood = a.kind === 'wood', park = a.kind === 'park';
        if (!wood && !park && a.kind !== 'scrub') continue;
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (const p of a.outer) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
        if (box) { x0 = Math.max(x0, box.x0); z0 = Math.max(z0, box.z0); x1 = Math.min(x1, box.x1); z1 = Math.min(z1, box.z1); }
        if (x1 <= x0 || z1 <= z0) continue;
        const step = wood ? 7 : 15, r = rng((a.id | 0) + 99);
        for (let z = z0; z < z1; z += step) for (let x = x0; x < x1; x += step) {
          const px = x + r() * step, pz = z + r() * step;
          if (!inRing(px, pz, a.outer)) continue;
          if (a.holes && a.holes.some(h => inRing(px, pz, h))) continue;
          if (park && r() > 0.45) continue;
          list.push({ x: px, z: pz, r: null, h: null, tags: a.tags, src: 'area', id: (px * 73856093) ^ (pz * 19349663) });
          stats.areaTrees++;
        }
        await slice('L520');
      }
    }
    // OSM trees take their crown size from the picture; the picture's crowns fill in where OSM has none
    if (probes.length) {
      const near = new Map(), GC = 6;
      for (const t of list) {
        const k = Math.floor(t.x / GC) + ',' + Math.floor(t.z / GC); if (!near.has(k)) near.set(k, []); near.get(k).push(t);
        const p = t.r == null ? probeAt(t.x, t.z) : null;
        if (p && p.has(t.x, t.z)) t.r = Math.max(1.5, Math.min(6, p.dist(t.x, t.z) + 0.8));
      }
      for (const t of crowns) {
        let clash = false;
        const kx = Math.floor(t.x / GC), kz = Math.floor(t.z / GC);
        for (let a = -1; a <= 1 && !clash; a++) for (let b = -1; b <= 1 && !clash; b++) {
          const l = near.get((kx + a) + ',' + (kz + b)); if (!l) continue;
          for (const o of l) if (Math.hypot(o.x - t.x, o.z - t.z) < Math.max(3.5, t.r * 0.8)) { clash = true; break; }
        }
        if (!clash) list.push({ x: t.x, z: t.z, r: t.r, h: null, tags: null, src: 'img', id: t.c, col: t.col });
      }
      await slice('L540');
    }
    // inside a building is never right
    if (buildingsList.length) {
      const bgrid = new Map(), GB = 50;
      for (const b of buildingsList) {
        if (!b.outer || b.outer.length < 3 || (b.minHeight || 0) > 3) continue;
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (const p of b.outer) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
        for (let i = Math.floor(x0 / GB); i <= Math.floor(x1 / GB); i++) for (let j = Math.floor(z0 / GB); j <= Math.floor(z1 / GB); j++) { const k = i + ',' + j; if (!bgrid.has(k)) bgrid.set(k, []); bgrid.get(k).push(b); }
      }
      await slice('L551');
      for (let i = list.length - 1; i >= 0; i--) {
        const t = list[i], l = bgrid.get(Math.floor(t.x / GB) + ',' + Math.floor(t.z / GB));
        if (l && l.some(b => inRing(t.x, t.z, b.outer))) list.splice(i, 1);
        if ((i & 255) === 0) await slice('L555');
      }
    }
    if (disposed) return stats;
    await makeMeshes(list);
    if (disposed) return stats;
    // the programs built off the main thread before the trees show (first time only, then they are cached)
    const renderer = opts.renderer || (opts.world && opts.world.renderer), cam = opts.camera || (opts.world && opts.world.camera);
    if (renderer && cam && renderer.compileAsync) { try { await renderer.compileAsync(group, cam, parent); } catch (e) {} }
    if (disposed) return stats;
    // swap: the new trees in, the old ones out, in one step
    parent.add(group);
    for (const g of adopted) g.release();
    done = true;
    stats.total = list.length;
    stats.ms = Math.round(performance.now() - tStart);
    return stats;
  })();

  async function makeMeshes(list) {
    const T = textures();
    const groups = { broad: [], conifer: [], palm: [] };
    for (let n = 0; n < list.length; n++) {
      const t = list[n];
      const h0 = hashf(t.id | 0, 1), h1 = hashf(t.id | 0, 2), h2 = hashf(t.id | 0, 3);
      const kind = kindOf(t.tags, h0, region);
      let r = t.r, H = t.h;
      if (kind === 'palm') { r = r || 2.6 + h1 * 1.2; H = H || 9 + h1 * 9; }
      else if (kind === 'conifer') { r = r || 2.2 + h1 * 1.8; H = H || Math.max(8, r * 3.2 + h2 * 4); }
      else { r = r || 2.6 + h1 * 2.2; H = H || r * 2.0 + 2.0 + h2 * 2; }
      r = Math.min(r, 9); H = Math.min(Math.max(H, r * 1.4), 45);
      const g = groundAt(t.x, t.z);
      if (g == null) continue;
      groups[kind].push({ x: t.x, z: t.z, g, r, H, h1, h2, rot: h0 * Math.PI * 2, col: t.col });
      if ((n & 255) === 0) await slice('L585');
    }
    const dummy = new THREE.Object3D(), col = new THREE.Color();
    const crownMat = (tex, key) => {
      const m = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.42, side: THREE.DoubleSide });
      spritePatch(m, key);
      return m;
    };
    const depthMat = (tex, key) => {
      const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.42 });
      spritePatch(m, key + '-d', false);
      return m;
    };
    const addCrowns = async (kind, arr, geo, tex) => {
      if (!arr.length) return;
      const mesh = new THREE.InstancedMesh(geo, crownMat(tex, kind), arr.length);
      mesh.customDepthMaterial = depthMat(tex, kind);
      for (let i = 0; i < arr.length; i++) {
        const t = arr[i], rc = t.r;
        const cy = kind === 'conifer' ? t.g + t.H * 0.5 + 0.8 : t.g + t.H - t.r * 0.92;
        dummy.position.set(t.x, cy, t.z);
        dummy.rotation.set(0, t.rot, 0);
        if (kind === 'conifer') dummy.scale.set(rc, (t.H * 0.92 - 1) / 2, rc);
        else dummy.scale.set(rc * (1.05 + t.h2 * 0.2), rc * (0.8 + t.h1 * 0.2), rc * (1.05 + t.h1 * 0.2));
        dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
        if (t.col) {
          // match the picture: the crown's brightness, and its warmth (yellow, autumn red, olive) seen from
          // above; never its blue, which is the picture's shade, not the leaves
          const lin = (v) => Math.pow(v, 2.2);
          const m = kind === 'conifer' ? TEXMEAN.conifer : TEXMEAN.broad;
          const [r0, g0, b0] = t.col, lumI = 0.3 * lin(r0) + 0.59 * lin(g0) + 0.11 * lin(b0), lumT = 0.3 * m[0] + 0.59 * m[1] + 0.11 * m[2];
          const k = Math.min(1.7, Math.max(0.55, lumI / lumT * 1.25));
          const warm = Math.max(-0.15, Math.min(0.25, (r0 - g0) / Math.max(0.05, g0)));
          col.setRGB(k * (1 + warm * 0.9), k, k * (0.85 - Math.max(0, warm) * 0.5));
        } else if (kind === 'conifer') col.setRGB(0.6 + t.h1 * 0.2, 0.7 + t.h2 * 0.2, 0.62 + t.h1 * 0.15);
        else col.setRGB(0.7 + t.h1 * 0.3, 0.75 + t.h2 * 0.2, 0.55 + t.h2 * 0.25);
        mesh.setColorAt(i, col);
        if ((i & 511) === 0) await slice('L618');
      }
      // crowns cast shadows but do not take them (a shadow lookup on every leaf pixel costs more than it shows)
      mesh.castShadow = true; mesh.receiveShadow = false; mesh.name = 'crowns ' + kind;
      mesh.computeBoundingSphere();
      group.add(mesh); objs.push(mesh);
    };
    await addCrowns('broad', groups.broad, spriteCrown('broad'), T.broad);
    await addCrowns('conifer', groups.conifer, spriteCrown('conifer'), T.conifer);
    if (groups.palm.length) {
      const m = new THREE.MeshLambertMaterial({ map: T.frond, alphaTest: 0.4, side: THREE.DoubleSide });
      const mesh = new THREE.InstancedMesh(frondCrown(), m, groups.palm.length);
      mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: T.frond, alphaTest: 0.4 });
      groups.palm.forEach((t, i) => {
        dummy.position.set(t.x, t.g + t.H, t.z); dummy.rotation.set(0, t.rot, 0); dummy.scale.set(t.r * 1.6, t.r * 1.1, t.r * 1.6);
        dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
        col.setRGB(0.85 + t.h1 * 0.3, 0.9 + t.h2 * 0.2, 0.8); mesh.setColorAt(i, col);
      });
      mesh.castShadow = true; mesh.receiveShadow = false; mesh.name = 'palms';
      mesh.computeBoundingSphere();
      group.add(mesh); objs.push(mesh);
    }
    // trunks, all kinds in one mesh
    const all = [...groups.broad.map(t => ['b', t]), ...groups.conifer.map(t => ['c', t]), ...groups.palm.map(t => ['p', t])];
    if (all.length) {
      const m = new THREE.MeshLambertMaterial({ map: T.bark });
      const mesh = new THREE.InstancedMesh(trunkGeo(), m, all.length);
      for (let i = 0; i < all.length; i++) {
        const [k, t] = all[i];
        let rad, top;
        if (k === 'p') { rad = 0.22; top = t.H + 0.2; }
        else if (k === 'c') { rad = 0.12 + t.r * 0.05; top = t.H * 0.5; }
        else { rad = 0.1 + t.r * 0.045; top = t.H - t.r * 0.9; }
        dummy.position.set(t.x, t.g - 0.3, t.z); dummy.rotation.set(0, t.rot, 0); dummy.scale.set(rad, top + 0.3, rad);
        dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
        const v = 0.85 + t.h1 * 0.25;
        if (k === 'p') col.setRGB(1.0, 0.95, 0.85); else col.setRGB(v, v * 0.97, v * 0.95);
        mesh.setColorAt(i, col);
        if (collide && collide.addCircle && !disposed) { try { const h = collide.addCircle(t.x, t.z, Math.max(0.25, rad), t.g - 0.5, t.g + top, 'tree'); if (h != null) handles.push(h); } catch (e) {} }
        if ((i & 511) === 0) await slice('L657');
      }
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'trunks';
      mesh.computeBoundingSphere();
      group.add(mesh); objs.push(mesh);
    }
    stats.broad = groups.broad.length; stats.conifer = groups.conifer.length; stats.palm = groups.palm.length;
  }

  function release() {
    if (group.parent) group.parent.remove(group);
    for (const o of objs) { o.geometry.dispose(); o.material.dispose(); if (o.customDepthMaterial) o.customDepthMaterial.dispose(); o.dispose && o.dispose(); }
    objs.length = 0;
  }
  const self = { release };
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (collide && collide.remove) for (const h of handles) { try { collide.remove(h); } catch (e) {} }
    // what is on screen stays until the next build is ready (or none follows straight away)
    let keep;
    if (done) keep = [self];
    else { release(); keep = adopted; }
    retiring.push(...keep);
    setTimeout(() => {
      const left = retiring.filter(h => keep.includes(h));
      if (!left.length) return;
      retiring = retiring.filter(h => !keep.includes(h));
      for (const h of left) h.release();
    }, 0);
  }
  return { group, ready, dispose, stats };
}

export const trees = { build };
export default trees;
