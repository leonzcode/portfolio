/* (O, round 12) Genting 2022: what stands on and round the course, drawn. The Great Wall of snow bricks with its
   crenellations, the watchtowers (white plaster, a hipped grey roof with dark upturned eaves), the gate bastion with its
   arched door, the rails (black round tops on blue printed panels, the tank, the mailboxes, the cannon), the start, the
   finish corral, the grandstand and its container stacks, the windbreak, the camera scaffolds and the judges' tower, the
   snow guns, two telephone masts dressed as pines, wind turbines on the far ridges.

   No logo, emblem, ring or brand anywhere: the panels, boards, banners and windbreak carry the colours of the 2022 Games'
   look (its ice blues) in waves drawn here, and the map's own words (GENTING 2022, START, FINISH).

   Everything is merged by material: the bricks (one draw), the painted things (one, colours in the vertices), the printed
   things (one, one picture for all of them), the dark rails (one), the turbines (one). */
import * as THREE from 'three';
import { height, ground } from './terrain.js?v=33';
import { rng, smoothstep } from './noise.js?v=33';

// ---- a geometry builder (positions, normals, uvs, colours) -------------------------------------------------------
class Geo {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; }
  v(x, y, z, nx, ny, nz, u = 0, w = 0, c = null) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.u.push(u, w); const k = c || this.col || [1, 1, 1]; this.c.push(k[0], k[1], k[2]); return this.p.length / 3 - 1; }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  // a flat quad from four corners (counter-clockwise seen from where its normal points), one uv rectangle
  face(P, uv, col) {
    const [a, b, c] = P, ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    // (no uv given: from the world, for a picture that repeats every 2.4 m: the bricks)
    const wu = p => Math.abs(ny) > 0.7 ? [p[0] / 2.4, p[2] / 2.4] : [(Math.abs(nx) > Math.abs(nz) ? p[2] : p[0]) / 2.4, p[1] / 2.4];
    const k = P.map((p, j) => { const t = uv ? uv[j] : this.wuv ? wu(p) : [0, 0]; return this.v(p[0], p[1], p[2], nx, ny, nz, t[0], t[1], col); });
    this.quad(k[0], k[1], k[2], k[3]);
  }
  // a box from its 8 corners: [x0..x1] x [y0..y1] x [z0..z1] axis aligned, coloured
  box(x0, y0, z0, x1, y1, z1, col, uvs = 1) {
    const F = (P, s) => this.face(P, s ? P.map(p => [(p[0] + p[2]) / uvs, p[1] / uvs]) : null, col);
    F([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], 1); F([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], 1);
    F([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], 1); F([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], 1);
    F([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], 0); F([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], 0);
  }
  // a box turned about y by yaw round its middle (cx, cz), w across, d along, from y0 to y1
  obox(cx, cz, yaw, w, d, y0, y1, col) {
    const s = Math.sin(yaw), c = Math.cos(yaw), P = (u, v, y) => [cx + u * c + v * s, y, cz - u * s + v * c];
    const a = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
    for (let k = 0; k < 4; k++) { const [u0, v0] = a[k], [u1, v1] = a[(k + 1) % 4]; this.face([P(u0, v0, y0), P(u1, v1, y0), P(u1, v1, y1), P(u0, v0, y1)], null, col); }
    this.face([P(-w / 2, d / 2, y1), P(w / 2, d / 2, y1), P(w / 2, -d / 2, y1), P(-w / 2, -d / 2, y1)], null, col);
  }
  // a tube along points P (THREE.Vector3s), radius r, n sides
  tube(P, r, n, col, caps = true) {
    const rings = [];
    for (let i = 0; i < P.length; i++) {
      const t = new THREE.Vector3(); if (i > 0) t.add(P[i].clone().sub(P[i - 1]).normalize()); if (i < P.length - 1) t.add(P[i + 1].clone().sub(P[i]).normalize()); t.normalize();
      const up = Math.abs(t.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const s = new THREE.Vector3().crossVectors(t, up).normalize(), u = new THREE.Vector3().crossVectors(s, t).normalize(), ring = [];
      for (let k = 0; k <= n; k++) { const a = k / n * Math.PI * 2, dx = u.x * Math.cos(a) + s.x * Math.sin(a), dy = u.y * Math.cos(a) + s.y * Math.sin(a), dz = u.z * Math.cos(a) + s.z * Math.sin(a); ring.push(this.v(P[i].x + dx * r, P[i].y + dy * r, P[i].z + dz * r, dx, dy, dz, k / n, i, col)); }
      rings.push({ ring, t });
    }
    for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < n; k++) this.quad(rings[i].ring[k], rings[i + 1].ring[k], rings[i + 1].ring[k + 1], rings[i].ring[k + 1]);
    if (caps) for (const [e, sg, p] of [[rings[0], -1, P[0]], [rings[rings.length - 1], 1, P[P.length - 1]]]) {
      const nx = e.t.x * sg, ny = e.t.y * sg, nz = e.t.z * sg, m = this.v(p.x, p.y, p.z, nx, ny, nz, 0.5, 0.5, col);
      const cap = e.ring.map(q => this.v(this.p[q * 3], this.p[q * 3 + 1], this.p[q * 3 + 2], nx, ny, nz, 0, 0, col));
      for (let k = 0; k < n; k++) if (sg > 0) this.i.push(m, cap[k], cap[k + 1]); else this.i.push(m, cap[k + 1], cap[k]);
    }
  }
  geometry() {
    if (!this.i.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}
const lin = h => { const c = new THREE.Color(h).convertSRGBToLinear(); return [c.r, c.g, c.b]; };

// ---- the pictures ----------------------------------------------------------------------------------------------
/* the snow bricks: about 0.6 x 0.3 m each (the footage shows bricks about 30 cm high), white, a little uneven, the
   joints a pale blue-grey; the picture covers 2.4 m square */
function brickTexture() {
  const N = 512, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), r = rng(31);
  g.fillStyle = '#c9d0d8'; g.fillRect(0, 0, N, N);
  const bw = N / 4, bh = N / 8;
  for (let row = 0; row < 8; row++) for (let k = -1; k < 5; k++) {
    const x = k * bw + (row % 2 ? bw / 2 : 0), y = row * bh, v = 236 + r() * 14 | 0;
    const grd = g.createLinearGradient(x, y, x, y + bh); grd.addColorStop(0, `rgb(${v},${v + 2},${v + 5})`); grd.addColorStop(1, `rgb(${v - 10},${v - 7},${v - 3})`);
    g.fillStyle = grd; g.fillRect(x + 3, y + 3, bw - 6, bh - 6);
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x + 3, y + 3, bw - 6, 3);
    for (let s = 0; s < 14; s++) { g.fillStyle = `rgba(150,160,175,${0.05 + r() * 0.08})`; g.fillRect(x + 4 + r() * (bw - 12), y + 4 + r() * (bh - 10), 2 + r() * 6, 1 + r() * 3); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
/* the printed things, one picture: rows of 256 px:
   0: the rail panels (deep to bright ice blue, white and pale blue waves, GENTING 2022 small)
   1: the fence boards (blue, a pale band of waves, GENTING)
   2: the windbreak (white, broad blue waves, GENTING 2022 large)
   3: the banners (START on the left half, FINISH on the right) */
function printTexture() {
  const W = 2048, H = 1024, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const waves = (y0, h, cols, amp, k, alpha) => {
    for (let j = 0; j < cols.length; j++) {
      g.strokeStyle = cols[j]; g.globalAlpha = alpha; g.lineWidth = h * (0.05 + 0.03 * j);
      g.beginPath();
      for (let x = 0; x <= W; x += 8) { const y = y0 + h * (0.35 + 0.12 * j) + Math.sin(x * k + j * 1.7) * amp * h + Math.sin(x * k * 2.3 + j) * amp * 0.4 * h; if (x === 0) g.moveTo(x, y); else g.lineTo(x, y); }
      g.stroke();
    }
    g.globalAlpha = 1;
  };
  const font = (px, w = 800) => `italic ${w} ${px}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
  // 0: panels
  { const grd = g.createLinearGradient(0, 0, 0, 256); grd.addColorStop(0, '#0f5aa8'); grd.addColorStop(0.5, '#1d8fd2'); grd.addColorStop(1, '#5cc8ee'); g.fillStyle = grd; g.fillRect(0, 0, W, 256);
    waves(0, 256, ['#9fd8f5', '#e8f6ff', '#5fc0ee'], 0.12, 0.004, 0.75);
    g.fillStyle = '#ffffff'; g.font = font(64); g.textBaseline = 'middle';
    for (let x = 120; x < W; x += 1024) g.fillText('GENTING 2022', x, 92);
    g.fillStyle = '#0a2c66'; g.fillRect(0, 0, W, 10); }
  // 1: boards
  { const y = 256, grd = g.createLinearGradient(0, y, 0, y + 256); grd.addColorStop(0, '#1554b0'); grd.addColorStop(1, '#2d8fdc'); g.fillStyle = grd; g.fillRect(0, y, W, 256);
    waves(y + 40, 180, ['#bfe6fa', '#ffffff'], 0.16, 0.006, 0.55);
    g.fillStyle = '#ffffff'; g.font = font(110); g.textBaseline = 'middle'; for (let x = 60; x < W; x += 680) g.fillText('GENTING', x, y + 128); }
  // 2: windbreak
  { const y = 512; g.fillStyle = '#f3f5f7'; g.fillRect(0, y, W, 256);
    waves(y + 40, 220, ['#2d84d2', '#7cc4ee', '#0f4c9e'], 0.18, 0.0032, 0.9);
    g.fillStyle = '#16408c'; g.font = font(120); g.textBaseline = 'middle'; g.fillText('GENTING 2022', 1100, y + 96);
    g.fillStyle = '#c5ccd4'; for (let x = 0; x < W; x += 256) g.fillRect(x, y, 4, 256); }
  // 3: banners
  { const y = 768; for (const [x0, txt] of [[0, 'START'], [1024, 'FINISH']]) {
      const grd = g.createLinearGradient(x0, y, x0 + 1024, y); grd.addColorStop(0, '#0d3f8f'); grd.addColorStop(1, '#2a8ad8'); g.fillStyle = grd; g.fillRect(x0, y, 1024, 256);
      g.save(); g.beginPath(); g.rect(x0, y, 1024, 256); g.clip(); waves(y + 20, 220, ['#8fd0f2', '#ffffff'], 0.15, 0.006, 0.45); g.restore();
      g.fillStyle = '#ffffff'; g.font = font(170); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, x0 + 512, y + 132); g.textAlign = 'left';
    } }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.wrapS = THREE.RepeatWrapping;
  return t;
}
const ROW = { panel: 0, board: 1, wind: 2, banner: 3 };
// a printed strip: uv u along (repeats each `rep` metres of length over the picture's width), v within its row
const rowV = (row, f) => 1 - (row * 256 + 256 * (1 - f)) / 1024;

// ---- the build ---------------------------------------------------------------------------------------------------
export function buildVenue(scene, park, q, land) {
  const C = park.course, low = q.tier === 'low';
  const bricks = new Geo(), paint = new Geo(), prints = new Geo(), dark = new Geo();
  bricks.wuv = true;
  const H = (x, z) => height(x, z), Gd = (x, z) => ground(x, z);
  // (v32, for "the house is kind of submerged": a box's floor at the highest snow under its footprint, its walls down to
  // the lowest: placed at its centre's height, on a slope its uphill side was buried and its downhill side stood on air)
  const seat = (x0, z0, x1, z1) => { let lo = Infinity, hi = -Infinity; for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) { const y = H(x0 + (x1 - x0) * i / 4, z0 + (z1 - z0) * j / 4); lo = Math.min(lo, y); hi = Math.max(hi, y); } return { lo, hi }; };
  const WHITE = lin(0xf3f1ec), PLASTER = lin(0xf1eee6), ROOF = lin(0x8c939b), TRIM = lin(0x24272b), STEEL = lin(0x8d949c), DK = lin(0x2d3136);
  const BLUE = lin(0x1f62bd), TEAL = lin(0x1aa3a8), YEL = lin(0xe8b424), WOOD = lin(0x9b6b3d), CREAM = lin(0xd9cfb7), RED = lin(0xb23a2a);

  // ---- the walls: each Block of the Great Wall, standing on the ground under it, its top H over it, crenellations on top
  const wall = (b, step) => {
    const dx = Math.sin(b.yaw), dz = Math.cos(b.yaw), sx = dz, sz = -dx, h = b.t / 2, L = b.L, n = Math.max(1, Math.ceil(L / 2.6));
    const MER = b.H > 2.5 ? 1.4 : 0.6, body = b.H - MER;
    const at = (s, u) => [b.x + dx * s + sx * u, b.z + dz * s + sz * u];
    // (its foot, as the physics has it: the snow it stands on, held level over each merlon's length on a stepped wall)
    const gy = s => { const [x, z] = at(s, 0), g = Gd(x, z); return b.base ? b.base(x, z, g) : g; };
    const uvs = (s, y) => [s / 2.4, y / 2.4];
    for (let i = 0; i < n; i++) {
      const s0 = L * i / n, s1 = L * (i + 1) / n;
      const g0 = step ? gy((s0 + s1) / 2) : gy(s0), g1 = step ? g0 : gy(s1);
      for (const sg of [-1, 1]) {
        const [ax, az] = at(s0, sg * h), [bx, bz] = at(s1, sg * h);
        const P = sg > 0 ? [[ax, g0 - 0.6, az], [bx, g1 - 0.6, bz], [bx, g1 + body, bz], [ax, g0 + body, az]] : [[bx, g1 - 0.6, bz], [ax, g0 - 0.6, az], [ax, g0 + body, az], [bx, g1 + body, bz]];
        bricks.face(P, P.map((p, j) => uvs(j === 0 || j === 3 ? (sg > 0 ? s0 : s1) : (sg > 0 ? s1 : s0), p[1] - g0 + (sg > 0 ? 0 : 0.1))));
      }
      // the walk on top
      const [a0x, a0z] = at(s0, -h), [a1x, a1z] = at(s1, -h), [b0x, b0z] = at(s0, h), [b1x, b1z] = at(s1, h);
      bricks.face([[a0x, g0 + body, a0z], [a1x, g1 + body, a1z], [b1x, g1 + body, b1z], [b0x, g0 + body, b0z]], [[s0 / 2.4, 0], [s1 / 2.4, 0], [s1 / 2.4, b.t / 2.4], [s0 / 2.4, b.t / 2.4]]);
      // the merlons: on both edges, 0.9 m long, 0.45 m deep
      const sm = (s0 + s1) / 2, gm = (g0 + g1) / 2;
      { const [mx, mz] = at(sm, 0); bricks.obox(mx, mz, b.yaw + Math.PI / 2, Math.min(1.6, (s1 - s0) * 0.62), b.t + 0.04, gm + body - 0.05, gm + b.H, null); }
      if (step && i < n - 1) {        // (a stepped wall: the riser between two steps)
        const g2 = gy((s1 + L * (i + 2) / n) / 2), [ex, ez] = at(s1, -h), [fx, fz] = at(s1, h);
        const lo = Math.min(g0, g2) + body, hi = Math.max(g0, g2) + body;
        bricks.face([[ex, lo, ez], [fx, lo, fz], [fx, hi, fz], [ex, hi, ez]], [[0, 0], [b.t / 2.4, 0], [b.t / 2.4, (hi - lo) / 2.4], [0, (hi - lo) / 2.4]]);
      }
    }
    // the two ends
    for (const [s, sg] of [[0, -1], [L, 1]]) {
      const g = gy(s), [ax, az] = at(s, -h), [bx, bz] = at(s, h);
      const P = sg > 0 ? [[ax, g - 0.6, az], [bx, g - 0.6, bz], [bx, g + body, bz], [ax, g + body, az]] : [[bx, g - 0.6, bz], [ax, g - 0.6, az], [ax, g + body, az], [bx, g + body, bz]];
      bricks.face(P, P.map(p => [(p[0] + p[2]) / 2.4, (p[1] - g) / 2.4]));
    }
  };
  for (const w of C.walls) wall(w, !!w.step);
  // the ledge under the gap rail: a plain brick block
  for (const b of C.blocks) {
    if (/cannon/.test(b.name)) {
      // (the cannon's ledge: a plain flat-topped brick block, its top where the physics has it)
      const dx = Math.sin(b.yaw), dz = Math.cos(b.yaw), sx = dz, sz = -dx, h = b.t / 2, at = (sv, u) => [b.x + dx * sv + sx * u, b.z + dz * sv + sz * u];
      const top = sv => { const [x, z] = at(sv, 0); return b.base(x, z, 0) + b.H; }, y0 = Math.min(top(0), top(b.L)) - b.H - 0.6;
      const c = [at(0, -h), at(b.L, -h), at(b.L, h), at(0, h)], T = [top(0), top(b.L), top(b.L), top(0)];
      const Fb = P => bricks.face(P, P.map(p => [(p[0] + p[2]) / 2.4, (p[1] - y0) / 2.4]));
      for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; Fb([[c[i][0], y0, c[i][1]], [c[j][0], y0, c[j][1]], [c[j][0], T[j], c[j][1]], [c[i][0], T[i], c[i][1]]]); }
      Fb([[c[0][0], T[0], c[0][1]], [c[1][0], T[1], c[1][1]], [c[2][0], T[2], c[2][1]], [c[3][0], T[3], c[3][1]]]);
    } else if (/Ledge/.test(b.name)) wall(Object.assign(Object.create(b), { H: b.H + 0.62 - 0.3 }), false);
  }
  // ---- the gate bastion: a brick block with a battered front, crenellated, an arched door on its downhill face
  for (const gb of C.decor.gates) {
    const x0 = gb.x - gb.t / 2, x1 = gb.x + gb.t / 2, z0 = gb.z0, z1 = gb.z1, y0 = Math.min(Gd(x0, z0), Gd(x1, z1), Gd(x0, z1), Gd(x1, z0)) - 0.5, y1 = Gd(gb.x, (z0 + z1) / 2) + gb.H - 0.6;
    const F = (P) => bricks.face(P, P.map(p => [(p[0] + p[2]) / 2.4, p[1] / 2.4]));
    F([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]); F([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]);
    F([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]); F([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]);
    F([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]);
    for (let x = x0 + 0.5; x < x1 - 0.4; x += 1.6) for (const z of [z0 + 0.25, z1 - 0.25]) bricks.obox(x + 0.45, z, 0, 0.9, 0.5, y1 - 0.05, y1 + 0.62, null);
    // the arched door: a dark recess on the downhill face (z1), 2 m wide, 2.8 m tall
    paint.col = lin(0x3a3f47);
    const yd = Gd(gb.x, z1), dz1 = z1 + 0.02, P = [];
    for (let k = 0; k <= 12; k++) { const a = Math.PI * k / 12; P.push([gb.x + Math.cos(a), yd + 1.8 + Math.sin(a) * 1.0]); }
    const m = paint.v(gb.x, yd + 1.2, dz1, 0, 0, 1);
    const ring = [[gb.x + 1, yd - 0.2], ...P, [gb.x - 1, yd - 0.2]].map(([x, y]) => paint.v(x, y, dz1, 0, 0, 1));
    for (let k = 0; k < ring.length - 1; k++) paint.i.push(m, ring[k], ring[k + 1]);
  }
  // ---- the watchtowers: white plaster bodies under a curved roof (snow white on top, thick black rims, the eaves swept
  // up at the corners, as the photos show the gatehouse), on a crenellated terrace with a blue light strip along its front
  for (const T of C.decor.towers) {
    const h = T.w / 2, e = T.eave, x0 = T.x - h, x1 = T.x + h, z0 = T.z0, z1 = T.z1;
    const yb0 = (T.yLow != null ? Math.min(T.yLow, T.y0, T.y1) : Math.min(T.y0, T.y1)) - 0.6, yE0 = T.y0 + T.H, yE1 = T.y1 + T.H;
    // (its base course: a brick plinth from below the snow to the floor, 0.12 m proud of the walls, level)
    if (T.base) bricks.box(x0 - 0.12, yb0, z0 - 0.12, x1 + 0.12, Math.min(T.y0, T.y1), z1 + 0.12, null, 2.4);
    const ye = (z) => yE0 + (yE1 - yE0) * (z - z0) / (z1 - z0);
    // (the body: its top follows the snow it stands on, so the eaves are level with it front and back as the physics has it)
    const F = (P) => paint.face(P, null, PLASTER);
    const yw = T.base ? Math.min(T.y0, T.y1) : yb0;
    F([[x0, yw, z1], [x1, yw, z1], [x1, yE1, z1], [x0, yE1, z1]]); F([[x1, yw, z0], [x0, yw, z0], [x0, yE0, z0], [x1, yE0, z0]]);
    F([[x1, yw, z1], [x1, yw, z0], [x1, yE0, z0], [x1, yE1, z1]]); F([[x0, yw, z0], [x0, yw, z1], [x0, yE1, z1], [x0, yE0, z0]]);
    // a grey door on the downhill face, on the base course
    paint.face([[T.x - 0.6, T.y1, z1 + 0.02], [T.x + 0.6, T.y1, z1 + 0.02], [T.x + 0.6, T.y1 + 2.0, z1 + 0.02], [T.x - 0.6, T.y1 + 2.0, z1 + 0.02]], null, lin(0x8e959c));
    /* the roof: a grid over each side, from the ridge (a 0) out to the eaves (a 1) and along (b 0..1): concave (steep by
       the ridge, flattening to the eaves), the eaves turned up a little all along and much more at the four corners */
    const ez0 = z0 - e, ez1 = z1 + e, w = h + e, NA = low ? 5 : 8, NB = low ? 6 : 10, up = 0.75;
    const roofY = (a, b) => { const z = ez0 + (ez1 - ez0) * b; return ye(z) + T.roof * Math.pow(1 - a, 1.7) + up * (0.12 * Math.pow(a, 2) + Math.pow(a, 2.5) * Math.pow(Math.abs(2 * b - 1), 4)); };
    const RP = (sg, a, b) => [T.x + sg * a * w, roofY(a, b), ez0 + (ez1 - ez0) * b];
    const SNOW = lin(0xf6f7f8);
    for (const sg of [-1, 1]) for (let i = 0; i < NA; i++) for (let j = 0; j < NB; j++) {
      const a0 = i / NA, a1 = (i + 1) / NA, b0 = j / NB, b1 = (j + 1) / NB;
      const Q = [RP(sg, a0, b0), RP(sg, a1, b0), RP(sg, a1, b1), RP(sg, a0, b1)];
      paint.face(sg > 0 ? Q : [Q[1], Q[0], Q[3], Q[2]], null, SNOW);
    }
    // the gable ends: plaster up to the roof's line, between the eaves' height and the curve
    for (const [b, z] of [[e / (ez1 - ez0), z0], [1 - e / (ez1 - ez0), z1]]) for (const sg of [-1, 1]) for (let i = 0; i < NA; i++) {
      const a0 = i / NA, a1 = Math.min((i + 1) / NA, h / w);
      if (a0 * w >= h) break;
      const xA = T.x + sg * a0 * w, xB = T.x + sg * a1 * w, P = [[xA, ye(z), z], [xB, ye(z), z], [xB, roofY(a1, b) - 0.05, z], [xA, roofY(a0, b) - 0.05, z]];
      paint.face(P, null, PLASTER);
    }
    // the rims: thick black tubes along the eaves and up the gable edges, the ridge a thick black beam with curled ends
    const V = p => new THREE.Vector3(p[0], p[1], p[2]);
    for (const sg of [-1, 1]) {
      const eave = [], gA = [], gB = [];
      for (let j = 0; j <= NB; j++) eave.push(V(RP(sg, 1, j / NB)).setY(roofY(1, j / NB) - 0.06));
      for (let i = 0; i <= NA; i++) { gA.push(V(RP(sg, i / NA, 0)).setY(roofY(i / NA, 0) + 0.04)); gB.push(V(RP(sg, i / NA, 1)).setY(roofY(i / NA, 1) + 0.04)); }
      dark.tube(eave, 0.2, low ? 6 : 8, TRIM, true); dark.tube(gA, 0.16, 6, TRIM, true); dark.tube(gB, 0.16, 6, TRIM, true);
    }
    { const yR0 = roofY(0, 0), yR1 = roofY(0, 1);
      // (its top at the ridge rail's line, so a rider slides on it, not in it)
      dark.tube([V([T.x, yR0 + 0.3, ez0 - 0.25]), V([T.x, yR0 - 0.14, ez0 + 0.2]), V([T.x, yR1 - 0.14, ez1 - 0.2]), V([T.x, yR1 + 0.3, ez1 + 0.25])], 0.2, 8, TRIM, true); }
    // the low crenellated parapet round its terrace's front, a blue light strip along its foot
    const zp = z1 + 1.4;
    for (let x = x0 - 1.2; x <= x1 + 1.2; x += 1.6) bricks.obox(x, zp, 0, 0.95, 0.5, H(x, zp) - 0.3, H(x, zp) + 0.9, null);
    paint.box(x0 - 1.7, H(T.x, zp) + 0.02, zp + 0.26, x1 + 1.7, H(T.x, zp) + 0.2, zp + 0.3, lin(0x2fa8ff));
  }
  // ---- the rails ---------------------------------------------------------------------------------------------------
  const BLACK = lin(0x15171a);
  const under = (x, z) => H(x, z);
  for (const r of park.rails) {
    if (!r.ownMesh || r.look === 'ridge') continue;
    const P = r.P;
    // the top line, subdivided every 0.5 m
    const pts = []; for (let s = 0; s <= r.len + 1e-6; s += Math.min(0.5, r.len / 2)) pts.push(r.at(Math.min(s, r.len)).clone());
    if (pts[pts.length - 1].distanceTo(P[P.length - 1]) > 0.01) pts.push(P[P.length - 1].clone());
    if (r.look === 'tube') { dark.tube(pts.map(p => p.clone().setY(p.y - r.w / 2)), r.w / 2, 20, BLACK, true); }
    else if (r.look === 'cannon') {
      dark.tube(pts.map(p => p.clone().setY(p.y - r.w / 2)), r.w / 2, 12, BLACK, true);
      const e = pts[pts.length - 1].clone().setY(pts[pts.length - 1].y - r.w / 2), d = e.clone().sub(pts[pts.length - 2].clone().setY(pts[pts.length - 2].y - r.w / 2)).normalize();
      dark.tube([e.clone().addScaledVector(d, -0.35), e.clone().addScaledVector(d, 0.05)], r.w / 2 + 0.07, 12, BLACK, true);
      // its post down to the ramp
      const m = r.at(r.len * 0.35); paint.obox(m.x, m.z, 0, 0.1, 0.1, under(m.x, m.z) - 0.3, m.y - r.w, DK);
    } else if (r.look === 'mailbox') {
      // a box: a dark rounded top plate w wide, on the panel
      dark.tube(pts.map(p => p.clone().setY(p.y - 0.04)), 0.045, 8, BLACK, true);
      const w = r.w / 2;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1], d = b.clone().sub(a), l = Math.hypot(d.x, d.z) || 1, sx = d.z / l, sz = -d.x / l;
        const A0 = [a.x - sx * w, a.y, a.z - sz * w], A1 = [a.x + sx * w, a.y, a.z + sz * w], B0 = [b.x - sx * w, b.y, b.z - sz * w], B1 = [b.x + sx * w, b.y, b.z + sz * w];
        dark.face([A0, B0, B1, A1], null, BLACK);
      }
    } else { const rr = Math.max(r.w / 2, 0.1); dark.tube(pts.map(p => p.clone().setY(p.y - rr)), rr, low ? 8 : 12, BLACK, true); }   // (the footage's round tops are about 0.2 m across)
    // the printed panel under it, down to the snow (both faces, 0.05 m apart), the picture along its length
    if (r.panel === false || r.look === 'cannon' || r.look === 'tube') continue;
    const half = r.look === 'mailbox' ? r.w / 2 - 0.02 : 0.03;
    let s = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], d = b.clone().sub(a), l = Math.hypot(d.x, d.z) || 1, sx = d.z / l, sz = -d.x / l, sl = a.distanceTo(b);
      const top = r.look === 'mailbox' ? 0.06 : r.w;
      const ya = a.y - top, yb = b.y - top, ga = under(a.x, a.z) - 0.08, gb = under(b.x, b.z) - 0.08;
      const fa = Math.max(0.05, ya - ga), fb = Math.max(0.05, yb - gb);
      for (const sg of [-1, 1]) {
        const o = sg * half, A = [a.x + sx * o, ya, a.z + sz * o], B = [b.x + sx * o, yb, b.z + sz * o], Bl = [b.x + sx * o, gb, b.z + sz * o], Al = [a.x + sx * o, ga, a.z + sz * o];
        // (v: the top of the picture at the panel's top, down to where the snow cuts it, the picture's lower part)
        const va = Math.min(1, fa / 1.0), vb = Math.min(1, fb / 1.0), u0 = s / 9, u1 = (s + sl) / 9;
        const uv = [[u0, rowV(ROW.panel, 1)], [u1, rowV(ROW.panel, 1)], [u1, rowV(ROW.panel, 1 - vb)], [u0, rowV(ROW.panel, 1 - va)]];
        // (the face for the viewer with B on the left reads with u running from B to A: its own copy, u negated)
        if (sg > 0) prints.face([A, B, Bl, Al], uv.map(([u, v]) => [-u, v])); else prints.face([B, A, Al, Bl], [uv[1], uv[0], uv[3], uv[2]]);
      }
      s += sl;
    }
  }
  // ---- the start: a deck, a hut, the start gate's two posts and its banner -----------------------------------------
  {
    const z = -6, yS = H(0, z);
    paint.box(-9, yS - 0.4, -16, 9, yS + 0.05, -10, lin(0x9aa2ab));
    const hx = 15, hz = -22, st = seat(hx - 1.3, hz - 3.1, hx + 1.3, hz + 3.1), hy = st.hi;
    paint.box(hx - 1.3, st.lo - 0.3, hz - 3.1, hx + 1.3, hy + 2.6, hz + 3.1, WHITE);
    paint.box(hx - 1.31, hy + 1.9, hz - 3.11, hx + 1.31, hy + 2.25, hz + 3.11, BLUE);
    for (const x of [-4.2, 4.2]) paint.obox(x, z, 0, 0.25, 0.25, yS - 0.3, yS + 3.4, STEEL);
    bannerAt(prints, -4.2, 4.2, z, yS + 2.4, yS + 3.3, 0);
  }
  // ---- the finish: the corral's boards, the finish banner on its gantry, the grandstand, the container stacks ------------
  const F = C.finish;
  {
    const yF = H(0, F.z0);
    for (const x of [F.x0 - 1, F.x1 + 1]) paint.obox(x, F.z0, 0, 0.35, 0.35, yF - 0.3, yF + 5.2, STEEL);
    paint.box(F.x0 - 1.2, yF + 4.6, F.z0 - 0.25, F.x1 + 1.2, yF + 5.2, F.z0 + 0.25, STEEL);
    bannerAt(prints, -9, 9, F.z0 - 0.3, yF + 3.3, yF + 4.6, 1);
    // the boards round the corral, 1.1 m tall, and down both sides of the jump sections
    boards(prints, paint, [[F.x0, F.z0 - 2], [F.x0, F.z1], [F.x1, F.z1], [F.x1, F.z0 - 2]], H, STEEL);
    // the grandstand: facing up the course at the corral's end, 13 rows of blue seats on a grey frame
    // (the footage's stands are big: about 100 m across and 18 rows, under a white canopy)
    const sz0 = F.z1 + 3, sy = H(0, sz0), SW = 50, NR = 18;
    for (let k = 0; k < NR; k++) {
      const y = sy + 0.45 * k, z = sz0 + 0.85 * k;
      paint.box(-SW, y, z, SW, y + 0.45, z + 0.85, lin(0x7c838c));
      paint.box(-SW + 0.4, y + 0.45, z + 0.15, SW - 0.4, y + 0.62, z + 0.55, k % 5 === 4 ? lin(0xe8eef4) : lin(0x2f8fd8));
    }
    const zb = sz0 + 0.85 * NR, yb = sy + 0.45 * NR;
    paint.box(-SW - 0.5, Math.min(sy, H(-SW, zb), H(SW, zb)) - 1, zb, SW + 0.5, yb + 1.2, zb + 0.4, lin(0x7c838c));
    for (let x = -SW; x <= SW + 0.1; x += 12.5) paint.obox(x, zb + 0.2, 0, 0.3, 0.3, sy - 0.5, yb + 4.5, STEEL);
    paint.box(-SW - 1, yb + 4.3, sz0 - 1, SW + 1, yb + 4.6, zb + 1, lin(0xe9edf1));
    // the container stacks either side (teal and yellow, two high), as the venue's stands and rooms were built
    for (const [x0, cols] of [[-50, [TEAL, YEL, TEAL, BLUE]], [36, [YEL, TEAL, YEL, BLUE]]]) {
      for (let k = 0; k < 5; k++) for (let lv = 0; lv < 3; lv++) {
        const z = F.z0 + 18 + k * 6.6, st = seat(x0, z, x0 + 12.2, z + 2.45), y = st.hi + lv * 2.6;
        paint.box(x0, lv ? y - 0.2 : st.lo - 0.3, z, x0 + 12.2, y + 2.6, z + 2.45, cols[(k + lv) % 4]);
        paint.box(x0 + 0.3, y + 1.0, z - 0.01, x0 + 11.9, y + 1.9, z, lin(0x203a4a));
      }
    }
  }
  // ---- the windbreak: white printed fabric 9 m tall on truss frames every 12 m, down the rider's left of the jumps and
  // round behind the finish
  {
    const line = [[-52, 262], [-52, F.z0 + 30], [-40, F.z1 + 40], [36, F.z1 + 40]];
    let s = 0;
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, az] = line[i], [bx, bz] = line[i + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 12));
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n, x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
        const g0 = H(x0, z0), g1 = H(x1, z1), sl = Math.hypot(x1 - x0, z1 - z0);
        const uv = [[s / 24, rowV(ROW.wind, 0)], [(s + sl) / 24, rowV(ROW.wind, 0)], [(s + sl) / 24, rowV(ROW.wind, 1)], [s / 24, rowV(ROW.wind, 1)]];
        prints.face([[x0, g0 + 0.8, z0], [x1, g1 + 0.8, z1], [x1, g1 + 12.2, z1], [x0, g0 + 12.2, z0]], uv);
        // (the far side read backwards: its own copy of the print, running the way a viewer on that side reads)
        prints.face([[x1, g1 + 0.8, z1], [x0, g0 + 0.8, z0], [x0, g0 + 12.2, z0], [x1, g1 + 12.2, z1]], [uv[1], uv[0], uv[3], uv[2]].map(([u, v]) => [-u, v]));
        mast(paint, x0, z0, g0, 13.0, STEEL);
        s += sl;
      }
      mast(paint, bx, bz, H(bx, bz), 13.0, STEEL);
    }
  }
  // ---- the camera scaffolds (beside the jumps, on the rider's right) and the judges' tower ---------------------------
  for (const [x, z, h] of [[-32, C.t4.K.z, 6], [-34, C.t5.K.z - 4, 7], [-30, C.k6.K.z, 6], [33, C.S1.zB + 4, 5], [-44, C.S3.zB + 20, 5]]) scaffold(paint, x, z, H(x, z), h, STEEL, WOOD);
  {
    const x = -52, z = C.k6.z0 - 10, y = H(x, z);
    scaffold(paint, x, z, y, 7.5, STEEL, WOOD, 4.2);
    paint.box(x - 2.4, y + 7.5, z - 2.4, x + 2.4, y + 10, z + 2.4, WHITE);
    paint.box(x - 2.41, y + 8.6, z - 2.41, x + 2.41, y + 9.6, z + 2.41, lin(0x2a3a4c));
    paint.box(x - 2.7, y + 10, z - 2.7, x + 2.7, y + 10.3, z + 2.7, BLUE);
  }
  // ---- the snow guns: fan guns on 6 m masts down both sides, every 45 m ------------------------------------------------
  for (let z = -10; z < C.finish.z0; z += 90) for (const x of [-42, 41]) {
    if (x > 0 && z < 246) continue;          // (the Great Wall's side: none on it)
    const y = H(x, z), d = x < 0 ? 1 : -1;
    paint.obox(x, z, 0, 0.18, 0.18, y - 0.3, y + 5.6, lin(0x3d6fb3));
    paint.box(x - 0.45, y - 0.3, z - 0.45, x + 0.45, y + 0.5, z + 0.45, lin(0x3d6fb3));
    paint.obox(x + d * 0.5, z, Math.PI / 2, 0.95, 1.3, y + 5.2, y + 6.15, YEL);
  }
  // ---- two telephone masts dressed as pines, by the lift's top (they stand on the skyline in the footage) ---------------
  for (const [x, z] of [[-74, -54], [-83, -49]]) {
    const y = Gd(x, z);
    paint.obox(x, z, 0, 0.45, 0.45, y - 0.5, y + 22, lin(0x5a4a3a));
    for (let k = 0; k < 9; k++) { const t = k / 8, w = 4.8 * (1 - t) + 0.6, yy = y + 9 + t * 13.5; paint.obox(x, z, k * 0.5, w, w, yy, yy + 1.1, lin(0x2f4a33)); }
  }
  // ---- the venue's buildings by the finish (temporary halls and offices) -----------------------------------------------
  { // (the long hall past the finish: three tiers stepping back up the hill, white with blue glass bands and a blue roof
    // edge, its foot down to the lowest ground under it so it never stands on air)
    const ys = [H(-110, 845), H(70, 845), H(-110, 870), H(70, 870), H(-20, 858)], y = Math.max(...ys), y0 = Math.min(...ys) - 1;
    for (const [zf, top] of [[845, 8], [851, 13.5], [857, 19]]) {
      paint.box(-110, y0, zf, 70, y + top, 870, WHITE);
      for (let b = 1.8; b < top - 1.2; b += 3.2) paint.box(-110.1, y + b, zf - 0.03, 70.1, y + b + 1.3, zf, lin(0x3b6fa8));
      paint.box(-110.3, y + top, zf - 0.3, 70.3, y + top + 0.45, 870, BLUE);
    }
  }
  /* the buildings OpenStreetMap has round the resort (osm.json: the row of apartment blocks on the rider's right past the
     finish, the hotel, the huts), at their real places: walls up from the lowest ground under each, a flat roof; heights
     from their tags, else by kind (apartments six floors, a house one, the rest three) */
  const OB = land.osm && land.osm.buildings;
  if (OB) for (const b of OB) {
    const P = b.p, n = P.length; if (n < 3) continue;
    const lv = b.levels || (b.kind === 'apartments' ? 6 : b.kind === 'hotel' ? 8 : b.kind === 'house' ? 1 : 3), ht = b.h || lv * 3.2 + 0.8;
    let g0 = Infinity, g1 = -Infinity; for (const [x, z] of P) { const g = H(x, z); g0 = Math.min(g0, g); g1 = Math.max(g1, g); }
    const yb = g0 - 1, yt = g1 + ht, col = b.kind === 'apartments' || b.kind === 'hotel' ? lin(0xe7e1d4) : lin(0xd8dde3);
    // (the outline's turn, so each wall's window bands stand 5 cm out from it, not in it)
    let area = 0; for (let i = 0; i < n; i++) { const [ax, az] = P[i], [bx, bz] = P[(i + 1) % n]; area += ax * bz - bx * az; }
    const sg = area > 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const [ax, az] = P[i], [bx, bz] = P[(i + 1) % n], l = Math.hypot(bx - ax, bz - az) || 1, ox = sg * (bz - az) / l * 0.05, oz = -sg * (bx - ax) / l * 0.05;
      paint.face([[ax, yb, az], [bx, yb, bz], [bx, yt, bz], [ax, yt, az]], null, col);
      for (let y = g1 + 1.6; y < yt - 1.0; y += 3.2) paint.face([[ax + ox, y, az + oz], [bx + ox, y, bz + oz], [bx + ox, y + 1.1, bz + oz], [ax + ox, y + 1.1, az + oz]], null, lin(0x51657a));
    }
    const tri = THREE.ShapeUtils.triangulateShape(P.map(([x, z]) => new THREE.Vector2(x, z)), []);
    for (const [a, c, d] of tri) paint.face([[P[a][0], yt, P[a][1]], [P[c][0], yt, P[c][1]], [P[d][0], yt, P[d][1]], [P[d][0], yt, P[d][1]]], null, lin(0x7d8896));
  }
  for (const [x, z, w, d, h, c] of [[-70, 770, 30, 14, 6, WHITE], [-40, 800, 24, 12, 5, lin(0xdfe4ea)], [0, 790, 36, 16, 7, WHITE], [44, 784, 20, 10, 4, lin(0xc9d3dd)], [-110, 740, 26, 14, 6, lin(0xe5e2da)]]) {
    const st = seat(x - w / 2, z - d / 2, x + w / 2, z + d / 2), y = st.hi;
    paint.box(x - w / 2, st.lo - 0.5, z - d / 2, x + w / 2, y + h, z + d / 2, c);
    paint.box(x - w / 2 - 0.3, y + h, z - d / 2 - 0.3, x + w / 2 + 0.3, y + h + 0.3, z + d / 2 + 0.3, lin(0x41607f));
  }
  // ---- the meshes ----------------------------------------------------------------------------------------------------
  const group = new THREE.Group(); group.name = 'Genting venue';
  const add = (G, mat, name, shadow) => { const g = G.geometry(); if (!g) return null; const m = new THREE.Mesh(g, mat); m.name = name; m.castShadow = !!shadow; m.receiveShadow = true; m.matrixAutoUpdate = false; group.add(m); return m; };
  // (two-sided: the faces here are wound as they come, so both sides are drawn, each lit from its own side)
  const brickMat = new THREE.MeshStandardMaterial({ map: brickTexture(), roughness: 0.82, metalness: 0, color: 0xffffff, side: THREE.DoubleSide });
  const paintMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05, side: THREE.DoubleSide });
  const printMat = new THREE.MeshStandardMaterial({ map: printTexture(), roughness: 0.32, metalness: 0, side: THREE.FrontSide });
  const darkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.4 });
  add(bricks, brickMat, 'Genting walls', true);
  add(paint, paintMat, 'Genting structures', true);
  add(prints, printMat, 'Genting prints', true);
  add(dark, darkMat, 'Genting rails', true);
  const tur = turbines(land, q); if (tur) group.add(tur);
  scene.add(group); group.updateMatrixWorld(true);
  return group;
}

// a banner across from x0 to x1 at z, from y0 to y1 (which: 0 START, 1 FINISH), both faces
function bannerAt(G, x0, x1, z, y0, y1, which) {
  const u0 = which ? 0.5 : 0, u1 = which ? 1 : 0.5, v0 = rowV(ROW.banner, 0), v1 = rowV(ROW.banner, 1);
  G.face([[x1, y0, z], [x0, y0, z], [x0, y1, z], [x1, y1, z]], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
  G.face([[x0, y0, z - 0.02], [x1, y0, z - 0.02], [x1, y1, z - 0.02], [x0, y1, z - 0.02]], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
}
// boards along a line, 1.1 m tall, printed both sides, on posts every 2.5 m
function boards(G, P, pts, H, steel) {
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 2.5));
    for (let k = 0; k < n; k++) {
      const x0 = ax + (bx - ax) * k / n, z0 = az + (bz - az) * k / n, x1 = ax + (bx - ax) * (k + 1) / n, z1 = az + (bz - az) * (k + 1) / n;
      const g0 = H(x0, z0), g1 = H(x1, z1), sl = L / n;
      const uv = [[s / 6, rowV(ROW.board, 0)], [(s + sl) / 6, rowV(ROW.board, 0)], [(s + sl) / 6, rowV(ROW.board, 1)], [s / 6, rowV(ROW.board, 1)]];
      G.face([[x0, g0 + 0.05, z0], [x1, g1 + 0.05, z1], [x1, g1 + 1.15, z1], [x0, g0 + 1.15, z0]], uv);
      G.face([[x1, g1 + 0.05, z1], [x0, g0 + 0.05, z0], [x0, g0 + 1.15, z0], [x1, g1 + 1.15, z1]], [uv[1], uv[0], uv[3], uv[2]].map(([u, v]) => [-u, v]));   // (its own copy, reading the right way from this side)
      P.obox(x0, z0, 0, 0.06, 0.06, g0 - 0.2, g0 + 1.2, steel);
      s += sl;
    }
  }
}
// a plain mast h tall at x, z (a steel pole, a cap)
function mast(G, x, z, y, h, col) {
  G.obox(x, z, Math.PI / 4, 0.32, 0.32, y - 0.3, y + h, col); G.obox(x, z, 0, 0.32, 0.32, y - 0.3, y + h, col);
  G.obox(x, z, 0, 0.5, 0.5, y + h, y + h + 0.25, col);
}
// a lattice mast of four tubes h tall at x, z
function truss(G, x, z, y, h, col) {
  for (const [dx, dz] of [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]]) G.obox(x + dx, z + dz, 0, 0.08, 0.08, y - 0.3, y + h, col);
  for (let k = 0; k < h; k += 1.2) G.obox(x, z, 0, 0.66, 0.66, y + k, y + k + 0.06, col);
}
// a scaffold tower: four legs, cross braces at each lift, a wooden platform (w square) on top with a rail round it
function scaffold(G, x, z, y, h, steel, wood, w = 2.6) {
  const a = w / 2;
  for (const [dx, dz] of [[-a, -a], [a, -a], [a, a], [-a, a]]) G.obox(x + dx, z + dz, 0, 0.06, 0.06, y - 0.4, y + h + 1.1, steel);
  for (let k = 1.8; k < h; k += 1.8) { G.box(x - a, y + k, z - a - 0.03, x + a, y + k + 0.06, z - a + 0.03, steel); G.box(x - a, y + k, z + a - 0.03, x + a, y + k + 0.06, z + a + 0.03, steel); G.box(x - a - 0.03, y + k, z - a, x - a + 0.03, y + k + 0.06, z + a, steel); G.box(x + a - 0.03, y + k, z - a, x + a + 0.03, y + k + 0.06, z + a, steel); }
  G.box(x - a - 0.1, y + h, z - a - 0.1, x + a + 0.1, y + h + 0.12, z + a + 0.1, wood);
  G.box(x - a, y + h + 1.0, z - a - 0.03, x + a, y + h + 1.06, z - a + 0.03, steel); G.box(x - a, y + h + 1.0, z + a - 0.03, x + a, y + h + 1.06, z + a + 0.03, steel);
}
/* wind turbines on the far ridges: the highest ground 3 to 9 km off, every 400 m along a ridge at most, about 24 of them;
   white towers 80 m to the hub, three blades 48 m long (still), one merged mesh */
function turbines(land, q) {
  const r = rng(41), spots = [];
  for (let tries = 0; tries < 6000 && spots.length < 160; tries++) {
    const a = r() * Math.PI * 2, d = 2500 + r() * 3500, x = Math.sin(a) * d, z = 300 + Math.cos(a) * d, y = land.far(x, z);
    let top = true; for (const [ox, oz] of [[300, 0], [-300, 0], [0, 300], [0, -300], [210, 210], [-210, -210], [210, -210], [-210, 210]]) if (land.far(x + ox, z + oz) > y + 4) { top = false; break; }
    if (top) spots.push({ x, z, y });
  }
  spots.sort((p, q) => q.y - p.y);
  const pick = [];
  for (const s of spots) { if (pick.length >= (q.tier === 'low' ? 18 : 28)) break; if (pick.every(p => Math.hypot(p.x - s.x, p.z - s.z) > 380)) pick.push(s); }
  if (!pick.length) return null;
  const G = new Geo(), W = lin(0xeef0f2);
  for (const t of pick) {
    const yaw = r() * 6.28, x = t.x, z = t.z, y = t.y - 2, hub = 80;
    G.col = W;
    // the tower: a tapering 8 sided column
    const P = [];
    for (let k = 0; k <= 8; k++) { const a = k / 8 * Math.PI * 2; P.push([Math.cos(a), Math.sin(a)]); }
    for (let k = 0; k < 8; k++) { const [c0, s0] = P[k], [c1, s1] = P[k + 1]; G.face([[x + c0 * 2.2, y, z + s0 * 2.2], [x + c1 * 2.2, y, z + s1 * 2.2], [x + c1 * 1.2, y + hub, z + s1 * 1.2], [x + c0 * 1.2, y + hub, z + s0 * 1.2]], null, W); }
    G.obox(x, z, yaw, 3, 10, y + hub - 1.5, y + hub + 2, W);
    const hx = x + Math.sin(yaw) * 5.5, hz = z + Math.cos(yaw) * 5.5, roll = r() * 6.28;
    for (let b = 0; b < 3; b++) {
      const a = roll + b * Math.PI * 2 / 3, ca = Math.cos(a), sa = Math.sin(a), px = Math.cos(yaw), pz = -Math.sin(yaw);
      const tip = [hx + px * ca * 48, y + hub + sa * 48, hz + pz * ca * 48], ra = [hx + px * (ca * 2 - sa * 1.6), y + hub + sa * 2 + ca * 1.6, hz + pz * (ca * 2 - sa * 1.6)], rb = [hx + px * (ca * 2 + sa * 1.6), y + hub + sa * 2 - ca * 1.6, hz + pz * (ca * 2 + sa * 1.6)];
      G.face([ra, rb, tip, tip], null, W); G.face([rb, ra, tip, tip], null, W);
    }
  }
  const g = G.geometry();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  m.name = 'Wind turbines'; m.matrixAutoUpdate = false; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false;
  return m;
}
