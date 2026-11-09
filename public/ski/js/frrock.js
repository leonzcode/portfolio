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
import { snowUniforms } from './materials.js?v=20';
import { simplex, clamp, smoothstep, rng } from './noise.js?v=20';

// ---- the rock material: grey stone with strata, cracks and streaks, snow where it faces up -----------------------------
let ROCK = null;
export function rockMaterial(q) {
  if (ROCK) return ROCK;
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  m.name = 'freeride rock';
  const fine = q.tier !== 'low';
  m.onBeforeCompile = s => {
    s.uniforms.uNoise = snowUniforms.uNoise; s.uniforms.uNight = snowUniforms.uNight;
    s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>
varying vec3 vWPos; varying vec3 vWNor;`).replace('#include <project_vertex>', `#include <project_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNor = normalize(mat3(modelMatrix) * objectNormal);`);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWPos; varying vec3 vWNor; uniform sampler2D uNoise; uniform float uNight;
float gSnowR; vec3 gBl; vec4 gTx, gTy, gTz;
// the noise picture seen from the three axes, blended by the surface's facing (no stretching on a wall)
vec4 tri3(float k) { return texture2D(uNoise, vWPos.zy * k) * gBl.x + texture2D(uNoise, vWPos.xz * k) * gBl.y + texture2D(uNoise, vWPos.xy * k) * gBl.z; }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 wn = normalize(vWNor);
  gBl = pow(abs(wn), vec3(4.0)); gBl /= gBl.x + gBl.y + gBl.z;
  float h1 = tri3(0.045).b, h2 = tri3(0.19).b, h3 = ${fine ? 'tri3(0.8).b' : '0.5'};
  // the layers of the rock: bands in height, warped, each its own shade
  float lay = vWPos.y * 0.62 + (h1 - 0.5) * 3.2;
  float band = fract(lay), bandId = floor(lay);
  float shade = fract(sin(bandId * 12.9898) * 43758.5453);
  vec3 rock = mix(vec3(0.085, 0.082, 0.08), vec3(0.25, 0.24, 0.225), clamp(0.25 + shade * 0.45 + (h2 - 0.5) * 0.7 + (h3 - 0.5) * 0.3, 0.0, 1.0));
  // a warm iron stain here and there, dark wet streaks running down, the cracks between the layers
  rock = mix(rock, rock * vec3(1.12, 0.98, 0.84), smoothstep(0.55, 0.75, h1) * 0.6);
  float streak = texture2D(uNoise, vec2((vWPos.x + vWPos.z) * 0.35, vWPos.y * 0.03)).b;
  rock *= 1.0 - 0.35 * smoothstep(0.55, 0.8, streak) * (1.0 - abs(wn.y));
  rock *= 0.72 + 0.28 * smoothstep(0.0, 0.12, band) * smoothstep(1.0, 0.9, band);
  // snow lying on what faces up: ledges, the tops of the layers, the cracks' lips
  gSnowR = smoothstep(0.5, 0.72, wn.y + (h2 - 0.5) * 0.45 + (h3 - 0.5) * 0.15);
  diffuseColor.rgb = mix(rock, vec3(0.9, 0.93, 0.97), gSnowR);
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(0.93, 0.8, gSnowR);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  // bumps at two scales from the noise picture's normals, projected as the colour is
  vec3 wn = normalize(vWNor);
  vec2 a = texture2D(uNoise, vWPos.zy * 0.19).rg * 2.0 - 1.0, b = texture2D(uNoise, vWPos.xz * 0.19).rg * 2.0 - 1.0, c = texture2D(uNoise, vWPos.xy * 0.19).rg * 2.0 - 1.0;
  vec3 pn = wn + (vec3(0.0, a.y, a.x) * gBl.x + vec3(b.x, 0.0, b.y) * gBl.y + vec3(c.x, c.y, 0.0) * gBl.z) * (0.85 - gSnowR * 0.6);
  ${fine ? `vec2 a2 = texture2D(uNoise, vWPos.zy * 0.9).rg * 2.0 - 1.0, b2 = texture2D(uNoise, vWPos.xz * 0.9).rg * 2.0 - 1.0, c2 = texture2D(uNoise, vWPos.xy * 0.9).rg * 2.0 - 1.0;
  pn += (vec3(0.0, a2.y, a2.x) * gBl.x + vec3(b2.x, 0.0, b2.y) * gBl.y + vec3(c2.x, c2.y, 0.0) * gBl.z) * 0.35 * (1.0 - gSnowR);` : ''}
  normal = normalize((viewMatrix * vec4(normalize(pn), 0.0)).xyz);
}`)
      .replace('#include <opaque_fragment>', `outgoingLight -= (reflectedLight.directDiffuse + reflectedLight.directSpecular) * uNight * 0.7;
#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'frrock' + (fine ? 1 : 0);
  ROCK = m;
  return m;
}

// ---- curtains ------------------------------------------------------------------------------------------------------------
/* (2026-11-07: one zone, two draw calls, the rock and its snow, for the whole mountain: it was four zones of two, eight
   draw calls whenever the face was in view, which from the summit and most of the way down it always is; on a slow
   machine a draw call costs more than drawing the triangles out of view) */
const ZONES = ['face'];
const zoneOf = () => 0;
class Geo {
  constructor(snow) { this.p = []; this.n = []; this.i = []; this.snow = snow; this.c = snow ? null : []; }
  v(x, y, z, nx, ny, nz, c) { this.p.push(x, y, z); this.n.push(nx, ny, nz); if (this.c) this.c.push(c ? c[0] : 1, c ? c[1] : 1, c ? c[2] : 1); return this.p.length / 3 - 1; }
  geometry() {
    if (!this.i.length) return null;
    const g = new THREE.BufferGeometry(), n = this.p.length / 3;
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    if (this.c) g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    if (this.snow) { g.setAttribute('aGroom', new THREE.BufferAttribute(new Float32Array(n), 1)); g.setAttribute('aDye', new THREE.BufferAttribute(new Float32Array(n), 1)); }
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

/* the rows of one element: each { ox, oz, ux, uz, s0, s1, t } (a point on the lip, the way out from the rock, how far
   back and out the section runs, the position along the lip for the noise); runs of rows that join are one strip */
export function stripsOf(f, dr) {
  const S = [];
  let cur = null;
  const push = row => { if (!row) { if (cur && cur.length > 1) S.push(cur); cur = null; return; } (cur || (cur = [])).push(row); };
  if (f.kind === 'band') {
    /* (each row straight down the fall line, dr apart across it, 2026-11-08: they were at right angles to the lip, and
       where the lip bends round a buttress (the Big Ones) the rows crossed each other, their quads folding over and
       drawing rock up to 3 m above the snow that was there. Down the fall line they never cross; the face's points are
       spread over its width along the row, the land's own face width over the lip's slant) */
    for (let x = f.xa + 0.3; x <= f.xb - 0.3; x += dr) {
      const H = f.H(x), c = Math.max(0.25, f.cs(x)), fw = f.fwOf(H) / c;
      push(H < 0.4 ? null : { ox: x, oz: f.zL(x), ux: 0, uz: 1, s0: -4, fw, s1: fw + 2.2, t: x });
    }
    push(null);
  } else if (f.kind === 'rib') {
    const zs = f.zTop + f.grow * 0.25;
    // the side walls, down to where the end cliff takes over
    for (const side of [-1, 1]) {
      for (let z = zs; ; z += dr) {
        const l = f.L(z), r = f.R(z), ex = side < 0 ? l : r, ze = f.zE(ex);
        if (z > ze + 0.2) break;
        const back = Math.min(4, (r - l) / 2 - 0.1), fw = side < 0 ? f.wwL : f.wwR;
        // (a side as gentle as an outer slope is the terrain's own: its rock is the snow shader's)
        push(f.Dz(z) < 0.5 || fw > 4 ? null : { ox: ex, oz: z, ux: side, uz: 0, s0: -back, fw, s1: fw + 1.8, t: z });
      }
      push(null);
    }
    // the end cliff
    const zE = f.zEnd, l = f.L(zE), r = f.R(zE);
    // (across the rib's whole width, its outer slopes too: they end in the same cliff, and the terrain is held down
    // under all of it, freeride.js; 2026-11-08, it stopped short of an outer slope and left a hole up to 12 m deep)
    for (let x = l - f.wwL; x <= r + f.wwR; x += dr) push({ ox: x, oz: f.zE(x), ux: 0, uz: 1, s0: -4, fw: f.wEnd, s1: f.wEnd + 2.2, t: x });
    push(null);
  } else if (f.kind === 'out') {
    /* round its outline at even steps of its own length, each row at right angles to the outline (2026-11-08: the rows
       went out from its middle at even angles, which on a long, rough outcrop left them metres apart along its long
       sides, cutting across its rough outline, and the lowered terrain showed through there as holes up to 9 m deep).
       The outline is found along 720 rays from the middle, then walked at steps of dr. */
    const M = 720, ring = [];
    for (let i = 0; i < M; i++) {
      const a = i / M * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a);
      let lo = 0, hi = Math.max(f.hw, f.len) * 1.5 + f.wob + 1;
      for (let k = 0; k < 26; k++) { const m = (lo + hi) / 2; if (f.out(f.x + dx * m, f.z + dz * m) < 0) lo = m; else hi = m; }
      ring.push([f.x + dx * lo, f.z + dz * lo]);
    }
    const cum = [0];
    for (let i = 1; i <= M; i++) { const a = ring[i - 1], b = ring[i % M]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    const per = cum[M], n = Math.max(12, Math.round(per / dr)), back = f.back();
    const pts = [];
    for (let i = 0, j = 0; i < n; i++) {
      const s = per * i / n; while (j < M - 1 && cum[j + 1] < s) j++;
      const t = (s - cum[j]) / ((cum[j + 1] - cum[j]) || 1), a = ring[j], b = ring[(j + 1) % M];
      const ox = a[0] + (b[0] - a[0]) * t, oz = a[1] + (b[1] - a[1]) * t;
      // (the way out: across the outline, from out()'s slope)
      const e = 0.05, gx = f.out(ox + e, oz) - f.out(ox - e, oz), gz = f.out(ox, oz + e) - f.out(ox, oz - e), gl = Math.hypot(gx, gz) || 1;
      pts.push({ ox, oz, ux: gx / gl, uz: gz / gl, s });
    }
    /* (where the outline turns sharply the rows either side close in on each other, inwards round a corner, outwards in
       a notch: outwards each reaches no further than about the outline's own radius there (at least 0.45 m, past the
       face's foot), so neighbours never cross and fold their quads over the face. Inwards every one reaches back in,
       as far as the terrain is held down under it: there they may cross round a corner, on the top) */
    const turns = pts.map((r, i) => { const a = pts[(i + n - 1) % n], b = pts[(i + 1) % n], da = Math.atan2(b.uz, b.ux) - Math.atan2(a.uz, a.ux); return Math.atan2(Math.sin(da), Math.cos(da)) / 2; });
    const sense = Math.sign(turns.reduce((s, v) => s + v, 0)) || 1;
    const rows = pts.map((r, i) => {
      // (the smallest radius over this row and its neighbours: a corner's rows all shortened alike)
      let R = 1e9;
      for (let k = -2; k <= 2; k++) { const tn = Math.abs(turns[(i + k + n) % n]); if (tn > 1e-4) R = Math.min(R, (per / n) / tn); }
      const notch = turns[i] * sense < 0;
      return f.raise(r.oz) < 0.45 ? null : { ox: r.ox, oz: r.oz, ux: r.ux, uz: r.uz, s0: -back, fw: f.w, s1: f.w + (notch ? Math.min(1.8, Math.max(0.45, 0.85 * R)) : 1.8), t: r.s };
    });
    // (a closed loop when no row is left out: the first row again at the end)
    const all = rows.every(Boolean);
    // (walked from just after a gap, so the strip running round the start joins up: 2026-11-08, it began at the downhill
    // end's middle and left one quad out there, a hole right at a natural kicker's lip)
    const k0 = all ? 0 : rows.indexOf(null);
    for (let i = 0; i < rows.length; i++) push(rows[(k0 + i) % rows.length]);
    if (all) push(rows[0]);
    push(null);
  }
  return S;
}

/* one cross-section in three parts with the same number of points in every row of an element, so neighbouring rows
   always join point to point (a row's face only shorter or taller): the snow behind the lip (s0 to 0), the face (0 to
   fw, the land's own face width: the face is a straight ramp there, so even steps in s are even steps in height), the
   snow below (fw to s1). Returns [s, y, slope] for each point. */
function rowPoints(G, row, nTop, nFace, nBot) {
  const out = [], at = s => G(row.ox + row.ux * s, row.oz + row.uz * s);
  for (let k = 0; k < nTop; k++) out.push(row.s0 * (1 - k / nTop));
  for (let k = 0; k < nFace; k++) out.push(row.fw * k / nFace);
  for (let k = 0; k <= nBot; k++) out.push(row.fw + (row.s1 - row.fw) * k / nBot);
  const pts = out.map(s => [s, at(s), 0]);
  for (let k = 0; k < pts.length; k++) {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
    pts[k][2] = Math.abs((b[1] - a[1]) / ((b[0] - a[0]) || 1));
  }
  return pts;
}

/* one triangle of a curtain's quad into G2, wound so its front faces out. Every point of it lies on the land, a height
   over the ground with nothing hanging over, so anything but a wall faces up: wound so its normal points up; only one
   standing nearly upright goes by its corners' normals (out from the rock) */
function tri(G2, nrm, grid, a, b, c, ia, ja, ib, jb, ic, jc) {
  const A = grid[ia][ja], B = grid[ib][jb], C = grid[ic][jc];
  const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], wx = C[0] - A[0], wy = C[1] - A[1], wz = C[2] - A[2];
  const cx = uy * wz - uz * wy, cy = uz * wx - ux * wz, cz = ux * wy - uy * wx;
  let f = cy;
  if (cy * cy < 0.04 * (cx * cx + cy * cy + cz * cz)) { const na = nrm[ia][ja], nb = nrm[ib][jb], nc = nrm[ic][jc]; f = cx * (na[0] + nb[0] + nc[0]) + cy * (na[1] + nb[1] + nc[1]) + cz * (na[2] + nb[2] + nc[2]); }
  if (f >= 0) G2.i.push(a, b, c); else G2.i.push(a, c, b);
}
export function buildRock(scene, land, mats, q) {
  const low = q.tier === 'low';
  /* (2026-11-08: a little coarser than before, now that there are twice as many rock features over three bowls and the
     faces' bulges are the land's own, smooth enough to follow at these steps: 111 000 and 264 000 triangles on the low
     and other tiers at the old steps) */
  const dr = low ? 1.35 : 0.9, fineStep = low ? 0.85 : 0.6, coarseStep = low ? 1.8 : 1.3;
  const G = land.G;
  const rockG = ZONES.map(() => new Geo(false)), snowG = ZONES.map(() => new Geo(true));
  let nEl = 0, rows = 0;
  for (const f of land.rocks) {
    // (the ribs' long, even walls: rows a third further apart, the tallest faces a point every 0.55 m, 0.8 on the low tier)
    const strips = stripsOf(f, f.kind === 'rib' ? dr * 1.35 : dr);
    if (!strips.length) continue;
    nEl++;
    const lift = 0.04 + (nEl % 7) * 0.006;      // (the snow parts: a few cm up, a little more for each element)
    const isBand = f.kind === 'band', snowLook = f.look === 'snow';
    const seed = (f.seed || nEl) * 1.37;
    // the points across a row: a few on the snow either side, the face a point every fineStep of its tallest height
    const Hmax = f.kind === 'band' ? f.Hmax : f.kind === 'rib' ? f.D * 1.2 + 4 : f.hDn;
    const nTop = Math.max(2, Math.ceil(4 / coarseStep)), nBot = Math.max(2, Math.ceil(2.2 / coarseStep)), nFace = Math.min(low ? 16 : 26, Math.max(3, Math.ceil(Hmax / fineStep)));
    const N = nTop + nFace + nBot + 1;
    strips.forEach((st, si) => {
      const grid = st.map(row => {
        /* (2026-11-08, for "never phase through a rock when riding on or over it": the face is drawn exactly where the
           physics has it. Its points used to be pushed out by up to 0.9 m (bulges, noise, strata), which stood rock
           over the snow at a face's foot and up to 4 m above where a rider was; the bulges are the land's own now,
           frland.js Band.h, so the rider meets them too) */
        return rowPoints(G, row, nTop, nFace, nBot).map(([s, y]) => [row.ox + row.ux * s, y, row.oz + row.uz * s]);
      });
      rows += grid.length;
      // normals from the grid, turned to face out and up
      const R = grid.length, nrm = [];
      for (let i = 0; i < R; i++) {
        const nr = [];
        for (let j = 0; j < N; j++) {
          const a = grid[Math.min(R - 1, i + 1)][j], b = grid[Math.max(0, i - 1)][j], c = grid[i][Math.min(N - 1, j + 1)], d = grid[i][Math.max(0, j - 1)];
          const ax = a[0] - b[0], ay = a[1] - b[1], az = a[2] - b[2], cx = c[0] - d[0], cy = c[1] - d[1], cz = c[2] - d[2];
          let nx = ay * cz - az * cy, ny = az * cx - ax * cz, nz = ax * cy - ay * cx;
          const row = st[i], sgn = (ny + nx * row.ux + nz * row.uz) < 0 ? -1 : 1, l = Math.hypot(nx, ny, nz) || 1;
          nr.push([nx / l * sgn, ny / l * sgn, nz / l * sgn]);
        }
        nrm.push(nr);
      }
      // quads to the rock or the snow, by how steep they face
      const zi = zoneOf(st[0].ox, st[0].oz);
      const RG = rockG[zi], SG = snowG[zi];
      const idR = new Map(), idS = new Map();
      const vid = (G2, ids, i, j, up) => {
        const key = i * 4096 + j; let v = ids.get(key);
        if (v === undefined) { const p = grid[i][j], n = nrm[i][j]; v = G2.v(p[0], p[1] + up, p[2], n[0], n[1], n[2]); ids.set(key, v); }
        return v;
      };
      for (let i = 0; i < R - 1; i++) for (let j = 0; j < N - 1; j++) {
        const p00 = grid[i][j], p10 = grid[i + 1][j], p01 = grid[i][j + 1], p11 = grid[i + 1][j + 1];
        // (the quad's own facing, from its diagonals)
        const ax = p11[0] - p00[0], ay = p11[1] - p00[1], az = p11[2] - p00[2], bx = p01[0] - p10[0], by = p01[1] - p10[1], bz = p01[2] - p10[2];
        let ny = az * bx - ax * bz; const nl = Math.hypot(ay * bz - az * by, ny, ax * by - ay * bx) || 1; ny = Math.abs(ny / nl);
        // (the face's own quads are always rock, its ledges' snow the rock material's; only the snow either side can be snow)
        // (and a band's lip is bare rock for a metre or two here and there: from above, a band shows as a dark edge)
        const rim = isBand && j === nTop - 2 && simplex(st[i].t * 0.18 + seed, 3.1) > -0.2;
        // (a cornice, look 'snow', 2026-11-08: a drop of snow, drawn all in the snow; it is still a cliff to the physics)
        const rock = !snowLook && ((j >= nTop - 1 && j < nTop + nFace) || rim || ny < 0.62);
        const G2 = rock ? RG : SG, ids = rock ? idR : idS, up = rock ? 0 : lift;
        const a = vid(G2, ids, i, j, up), b = vid(G2, ids, i + 1, j, up), c = vid(G2, ids, i, j + 1, up), d = vid(G2, ids, i + 1, j + 1, up);
        /* each triangle wound so its front faces out by its own facing (tri: up, as all the land's surface does)
           (2026-11-08: the quad's first triangle decided for both by a corner's normal, and where a quad is twisted, its
           rows closing in round a corner or its corners either side of a lip, one faced into the rock: drawn one-sided,
           it was not there from outside, the see-through rock and the holes through it) */
        tri(G2, nrm, grid, a, b, c, i, j, i + 1, j, i, j + 1);
        tri(G2, nrm, grid, c, b, d, i, j + 1, i + 1, j, i + 1, j + 1);
      }
    });
  }
  // the jibs' rock (the slab) goes into the rock mesh: a block of rock, its flat top along the top line, its sides down
  // into the snow, a little uneven
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
    const RG = rockG[0], base = RG.p.length / 3, nn = tg.attributes.normal.array;
    for (let v = 0; v < P.length / 3; v++) RG.v(P[v * 3], P[v * 3 + 1], P[v * 3 + 2], nn[v * 3], nn[v * 3 + 1], nn[v * 3 + 2]);
    for (const i of I) RG.i.push(base + i);
    tg.dispose();
  }
  const group = new THREE.Group(); group.name = 'freeride rock';
  const rockM = rockMaterial(q);
  let tris = 0;
  ZONES.forEach((name, zi) => {
    const rg = rockG[zi].geometry(), sg = snowG[zi].geometry();
    if (rg) { const m = new THREE.Mesh(rg, rockM); m.name = 'rock ' + name; m.receiveShadow = true; m.castShadow = !low; m.matrixAutoUpdate = false; group.add(m); tris += rg.index.count / 3; }
    if (sg) { const m = new THREE.Mesh(sg, mats.snow); m.name = 'rock snow ' + name; m.receiveShadow = true; m.matrixAutoUpdate = false; group.add(m); tris += sg.index.count / 3; }
  });
  scene.add(group); group.updateMatrixWorld(true);
  group.userData = { elements: nEl, rows, tris };
  markCover(land, [...rockG, ...snowG]);
  return group;
}
/* (2026-11-08, for "no invisible gaps, holes or see-through rock") where the drawn rock covers the snow, seen from above,
   on a 0.5 m grid (land.cover): the terrain's fine patches are held down under the rock only there (frland.js
   dipTarget). They were held down wherever a rock feature's face was, whether or not its drawn rock reached that far,
   and where it did not (round a rough outline, where two features overlap) the lowered terrain showed as holes up to
   9 m deep. A cell counts when any of its corners or its middle is inside a triangle. */
function markCover(land, geos) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const g of geos) for (let i = 0; i < g.p.length; i += 3) { const x = g.p[i], z = g.p[i + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  if (!(x1 > x0)) return;
  const r = 0.5; x0 = Math.floor(x0) - 1; z0 = Math.floor(z0) - 1;
  const W = Math.ceil((x1 - x0) / r) + 3, H = Math.ceil((z1 - z0) / r) + 3, a = new Uint8Array(W * H);
  const inside = (px, pz, ax, az, bx, bz, cx, cz) => {
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(d) < 1e-12) return false;
    const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d, l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d;
    return l1 >= -1e-6 && l2 >= -1e-6 && l1 + l2 <= 1 + 1e-6;
  };
  for (const g of geos) {
    const P = g.p, I = g.i;
    for (let t = 0; t < I.length; t += 3) {
      const A = I[t] * 3, B = I[t + 1] * 3, C = I[t + 2] * 3, ax = P[A], az = P[A + 2], bx = P[B], bz = P[B + 2], cx = P[C], cz = P[C + 2];
      const i0 = Math.floor((Math.min(ax, bx, cx) - x0) / r), i1 = Math.floor((Math.max(ax, bx, cx) - x0) / r);
      const j0 = Math.floor((Math.min(az, bz, cz) - z0) / r), j1 = Math.floor((Math.max(az, bz, cz) - z0) / r);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * W + i; if (a[k]) continue;
        const qx = x0 + i * r, qz = z0 + j * r;
        if (inside(qx + r / 2, qz + r / 2, ax, az, bx, bz, cx, cz) || inside(qx, qz, ax, az, bx, bz, cx, cz) || inside(qx + r, qz, ax, az, bx, bz, cx, cz) ||
          inside(qx, qz + r, ax, az, bx, bz, cx, cz) || inside(qx + r, qz + r, ax, az, bx, bz, cx, cz)) a[k] = 1;
      }
    }
  }
  land.cover = { x0, z0, r, W, H, a };
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
  for (const st of fr.park.starts) if (/^Summit/.test(st.name)) { pole(st.x - 2.4, st.z + 4, 2.2); pole(st.x + 2.4, st.z + 4, 2.2); }
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
  scene.add(group); group.updateMatrixWorld(true);
  return group;
}
