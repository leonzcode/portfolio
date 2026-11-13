/* Freeride's rock faces as plain arrays (2026-11-12, for "improving loading time"): the curtains of frrock.js, worked out
   from the land alone, so a module worker can make them (frrockworker.js) while the page builds the rest; on a slow
   processor they were about 3.7 s of the page's own start. Nothing here needs three.js. The same sums as before, moved
   here from frrock.js unchanged: frrock.js puts the arrays into meshes, and makes them on the page itself when the
   worker cannot start.
   rockArrays(land, low, slabs) -> { rock, snow: { p, n, i } or null, cover, elements, rows, tris, dropped } (rockFaces,
   then rockFinish with the slabs)
   slabs: the jibs' rock slabs, made on the page (frrock.js slabArrays: { P, N, I } each), which go into the rock mesh
   after the faces, as before; cover is land.cover (markCover, below). */
import { simplex } from './noise.js?v=25';

// ---- curtains ------------------------------------------------------------------------------------------------------------
/* (2026-11-07: one zone, two draw calls, the rock and its snow, for the whole mountain: it was four zones of two, eight
   draw calls whenever the face was in view, which from the summit and most of the way down it always is; on a slow
   machine a draw call costs more than drawing the triangles out of view) */
export const ZONES = ['face'];
const zoneOf = () => 0;
// (the rock mesh's vertices all take the colour white: color is 1, 1, 1 in each, frrock.js)
class Geo {
  constructor(snow) { this.p = []; this.n = []; this.i = []; this.snow = snow; }
  v(x, y, z, nx, ny, nz) { this.p.push(x, y, z); this.n.push(nx, ny, nz); return this.p.length / 3 - 1; }
  // plain arrays for the page (as three would make them: positions and normals in 32-bit floats, the index 16-bit
  // when it can be)
  arrays() {
    if (!this.i.length) return null;
    const n = this.p.length / 3;
    return { p: new Float32Array(this.p), n: new Float32Array(this.n), i: n > 65535 ? new Uint32Array(this.i) : new Uint16Array(this.i) };
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
/* (2026-11-08, second pass) the snow either side of the face drawn through points put where the land bends most, the
   same number of them as before: evenly spaced, a quad's straight edge across a band's foot, a rib's rounded top or
   the lip of a face below an outcrop stood up to 1.5 m off the snow you ride (vis.cjs: the buttress under the Big Ones,
   rock islands on steep aprons). The part is sampled every 0.25 m along the row, then points are added one at a time
   where the line through the points already there is furthest off it. Returns n + 1 [s, height] from a to b. */
function fitPart(at, a, b, n) {
  const m = Math.max(n, Math.ceil(Math.abs(b - a) / 0.25)), S = [], Y = [];
  for (let k = 0; k <= m; k++) { S.push(a + (b - a) * k / m); Y.push(at(S[k])); }
  const pick = [0, m];
  for (let q = 1; q < n; q++) {
    let best = -1, bk = -1;
    for (let i = 0; i < pick.length - 1; i++) {
      const i0 = pick[i], i1 = pick[i + 1];
      for (let k = i0 + 1; k < i1; k++) {
        // (how far off the line, and a little for being far from both ends, so a flat part is still split evenly)
        const d = Math.abs(Y[i0] + (Y[i1] - Y[i0]) * (k - i0) / (i1 - i0) - Y[k]) + 0.002 * Math.min(k - i0, i1 - k);
        if (d > best) { best = d; bk = k; }
      }
    }
    if (bk < 0) break;
    pick.push(bk); pick.sort((p, r) => p - r);
  }
  while (pick.length < n + 1) pick.push(m);
  return pick.sort((p, r) => p - r).map(k => [S[k], Y[k], 0]);
}
function rowPoints(G, row, nTop, nFace, nBot) {
  const pts = [], at = s => G(row.ox + row.ux * s, row.oz + row.uz * s);
  const top = fitPart(at, row.s0, 0, nTop);
  for (let k = 0; k < nTop; k++) pts.push(top[k]);
  for (let k = 0; k < nFace; k++) { const s = row.fw * k / nFace; pts.push([s, at(s), 0]); }
  const bot = fitPart(at, row.fw, row.s1, nBot);
  for (let k = 0; k <= nBot; k++) pts.push(bot[k]);
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
/* (2026-11-08, second pass) a long triangle (an edge over 1.5 m across: where a bend's rows fan out, or rows either
   side of a lip) that stands more than 0.3 m off the land inside it, measured across its own surface, is left out, and
   the terrain is drawn there instead (markCover holds it down only under rock that is drawn). One spanned the band's
   lip under the buttress below the Big Ones and stood 1.5 m over the snow you ride; another a rib's corner over the
   Teeth. */
const BARY = [[1 / 3, 1 / 3, 1 / 3], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.25, 0.25, 0.5], [0.5, 0.25, 0.25], [0.25, 0.5, 0.25]];
function offLand(G, grid, ia, ja, ib, jb, ic, jc, T) {
  const A = grid[ia][ja], B = grid[ib][jb], C = grid[ic][jc];
  const l = Math.max(Math.hypot(A[0] - B[0], A[2] - B[2]), Math.hypot(B[0] - C[0], B[2] - C[2]), Math.hypot(A[0] - C[0], A[2] - C[2]));
  if (l < T) return false;
  const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], wx = C[0] - A[0], wy = C[1] - A[1], wz = C[2] - A[2];
  const cx = uy * wz - uz * wy, cy = uz * wx - ux * wz, cz = ux * wy - uy * wx, ny = Math.abs(cy) / (Math.hypot(cx, cy, cz) || 1);
  // (the middle and the edges' middles; the quarter points too on one over twice that)
  for (let k = 0, nk = l < 2 * T ? 4 : 7; k < nk; k++) {
    const [u, v, w] = BARY[k];
    const x = A[0] * u + B[0] * v + C[0] * w, z = A[2] * u + B[2] * v + C[2] * w, y = A[1] * u + B[1] * v + C[1] * w;
    if (Math.abs(y - G(x, z)) * ny > 0.3) return true;
  }
  return false;
}
export function rockArrays(land, low, slabs = []) { return rockFinish(rockFaces(land, low), slabs); }
// (in two parts, so a worker can start on the faces before the page has made the slabs: frrockworker.js)
export function rockFaces(land, low) {
  /* (2026-11-08: a little coarser than before, now that there are twice as many rock features over three bowls and the
     faces' bulges are the land's own, smooth enough to follow at these steps: 111 000 and 264 000 triangles on the low
     and other tiers at the old steps) */
  const dr = low ? 1.35 : 0.9, fineStep = low ? 0.85 : 0.6, coarseStep = low ? 1.8 : 1.3;
  const G = land.G;
  const rockG = ZONES.map(() => new Geo(false)), snowG = ZONES.map(() => new Geo(true));
  // (a triangle is long, and checked against the land, from 1.5 m across)
  let nEl = 0, rows = 0, dropped = 0; const longT = 1.5;
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
        if (!offLand(G, grid, i, j, i + 1, j, i, j + 1, longT)) tri(G2, nrm, grid, a, b, c, i, j, i + 1, j, i, j + 1); else dropped++;
        if (!offLand(G, grid, i, j + 1, i + 1, j, i + 1, j + 1, longT)) tri(G2, nrm, grid, c, b, d, i, j + 1, i + 1, j, i + 1, j + 1); else dropped++;
      }
    });
  }
  return { rockG, snowG, nEl, rows, dropped };
}
export function rockFinish(F, slabs = []) {
  const { rockG, snowG, nEl, rows, dropped } = F;
  // the jibs' rock slabs, into the rock mesh after the faces (frrock.js slabArrays made them)
  for (const sl of slabs) {
    const RG = rockG[0], base = RG.p.length / 3, P = sl.P, nn = sl.N;
    for (let v = 0; v < P.length / 3; v++) RG.v(P[v * 3], P[v * 3 + 1], P[v * 3 + 2], nn[v * 3], nn[v * 3 + 1], nn[v * 3 + 2]);
    for (const i of sl.I) RG.i.push(base + i);
  }
  const cover = coverOf([...rockG, ...snowG]);
  let tris = 0;
  for (const G2 of [...rockG, ...snowG]) tris += G2.i.length / 3;
  return { rock: rockG[0].arrays(), snow: snowG[0].arrays(), cover, elements: nEl, rows, tris, dropped };
}
/* (2026-11-08, for "no invisible gaps, holes or see-through rock") where the drawn rock covers the snow, seen from above,
   on a 0.5 m grid (land.cover): the terrain's fine patches are held down under the rock only there (frland.js
   dipTarget). They were held down wherever a rock feature's face was, whether or not its drawn rock reached that far,
   and where it did not (round a rough outline, where two features overlap) the lowered terrain showed as holes up to
   9 m deep. A cell counts when its middle and all four of its corners are inside the drawn rock (2026-11-08, second
   pass: it counted when any one of them was, and the terrain held down over a whole cell at the rock's edge showed as
   a hole up to a metre deep beside it; the rock's snow reaches 1.8 m past the face's foot and is lifted a few cm, so it
   still hides the terrain under a cell it only partly covers). */
function coverOf(geos) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const g of geos) for (let i = 0; i < g.p.length; i += 3) { const x = g.p[i], z = g.p[i + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  if (!(x1 > x0)) return null;
  const r = 0.5; x0 = Math.floor(x0) - 1; z0 = Math.floor(z0) - 1;
  const W = Math.ceil((x1 - x0) / r) + 3, H = Math.ceil((z1 - z0) / r) + 3, a = new Uint8Array(W * H);
  // (the grid's corners, W + 1 by H + 1, and the cells' middles, each inside some triangle or not)
  const cor = new Uint8Array((W + 1) * (H + 1)), mid = new Uint8Array(W * H);
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
      for (let j = j0; j <= j1 + 1; j++) for (let i = i0; i <= i1 + 1; i++) {
        const qx = x0 + i * r, qz = z0 + j * r, kc = j * (W + 1) + i;
        if (!cor[kc] && inside(qx, qz, ax, az, bx, bz, cx, cz)) cor[kc] = 1;
        if (j <= j1 && i <= i1 && !mid[j * W + i] && inside(qx + r / 2, qz + r / 2, ax, az, bx, bz, cx, cz)) mid[j * W + i] = 1;
      }
    }
  }
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const kc = j * (W + 1) + i;
    if (mid[j * W + i] && cor[kc] && cor[kc + 1] && cor[kc + W + 1] && cor[kc + W + 2]) a[j * W + i] = 1;
  }
  return { x0, z0, r, W, H, a };
}

