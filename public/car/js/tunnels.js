// Tunnels and the walls of roads cut into a hillside, built from the roads module's own edges (roads.js works out
// the heights: a tunnel's floor runs from portal to portal at the grade of the roads it joins; a cutting's the same).
// Called from bridges.build for every area, in both worlds:
//   - every bore (tunnel=yes and the like): its lining (walls and an arched roof, or a flat one when it is wide),
//     drawn unlit and lit by a row of lamps along the roof; its outer shell (concrete, casting the shadow that keeps
//     the sun off the car inside); a headwall round each portal; its walls as collision; the bore in under.js, so the
//     world's ground and the camera inside it are the tunnel's; and where the terrain's surface comes down into the
//     lining (at the portals, or over a shallow tunnel), a stretch of the cut mask that takes it out of the bore
//     (cutmask.js draws it).
//   - the open map's roads where the ground beside them stands well above them (a road cut into a hillside, a
//     cutting, the approach to a portal): a retaining wall along the edge of the pavement up to the ground, the ground
//     over the road and pavement cut away (the mask again); where the ground falls well below the road, a wall down to
//     it (an embankment), so no gap shows under the road's edge.
//
//   const T = buildTunnels(roads, L (roads._debug()), opts, group, materials, stats)  -> { reg, dispose() }
//
// Frame: geo.js local metres, +x east, +y up, +z south.
import * as THREE from 'three';
import { under, indexTube } from './under.js?v=49';

const T = 0.45;            // lining thickness
const WALK = 0.12;         // the walkway along each wall over the road (roads.js draws it)
const COVER = 0.3;         // terrain coming within this of the lining's roof is cut out of the bore
const CUT_MIN = 1.0, FILL_MIN = 1.0; // ground this far over (under) a road's outer edge gets a wall

// a triangle soup; every triangle wound to face the normal it is given
class Soup {
  constructor(colours) { this.p = []; this.n = []; this.uv = []; this.c = colours ? [] : null; }
  tri(a, b, c, n, ua, ub, uc, ca, cb, cc) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * n[0] + cy * n[1] + cz * n[2] < 0) { let t = b; b = c; c = t; t = ub; ub = uc; uc = t; t = cb; cb = cc; cc = t; }
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    for (let k = 0; k < 3; k++) this.n.push(n[0] / l, n[1] / l, n[2] / l);
    this.uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
    if (this.c) this.c.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]);
  }
  quad(a, b, c, d, n, ua = Z2, ub = Z2, uc = Z2, ud = Z2, ca = W3, cb = W3, cc = W3, cd = W3) { this.tri(a, b, c, n, ua, ub, uc, ca, cb, cc); this.tri(a, c, d, n, ua, uc, ud, ca, cc, cd); }
  geometry() {
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.c) g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}
const Z2 = [0, 0], W3 = [1, 1, 1];

let MATS = null;
function materials(concrete) {
  if (MATS) return MATS;
  // the lining: the concrete's picture, unlit, shaded by vertex colours (pale tiles low on the walls, grey concrete
  // above, the daylight reaching in at the portals)
  const lining = new THREE.MeshBasicMaterial({ map: panelTexture(), vertexColors: true });
  const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.45, 1.15), toneMapped: false });
  MATS = { lining, lamp, concrete };
  return MATS;
}
let LAMPG = null;
// the lining's panels: pale grey, a joint every metre up and two along, a little grain (neutral, so the vertex
// colours give the tone); 4 m a repeat
function panelTexture() {
  const W = 256, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data;
  let seed = 7; const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  const noise = new Float32Array(64 * 64); for (let i = 0; i < noise.length; i++) noise[i] = rnd();
  const nz = (x, y) => { const fx = x / W * 64, fy = y / H * 64, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, v = (a, b) => noise[((b & 63) * 64) + (a & 63)];
    return (v(x0, y0) * (1 - tx) + v(x0 + 1, y0) * tx) * (1 - ty) + (v(x0, y0 + 1) * (1 - tx) + v(x0 + 1, y0 + 1) * tx) * ty; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const jx = (x % 128), jy = (y % 64);
    const joint = jx < 2 || jy < 2 ? 0.55 : 1;
    const v = (0.86 + 0.1 * nz(x, y) + 0.04 * rnd()) * joint;
    const o = (y * W + x) * 4; d[o] = d[o + 1] = d[o + 2] = Math.round(255 * Math.min(1, v)); d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// the bore's cross-section, from the foot of the left wall over the roof to the foot of the right one: [o, y]
// (o to the right of the centre line, y over the road); and the roof's height over the road
function profile(dL, dR, out = 0) {
  const W = dL + dR, mid = (dR - dL) / 2, P = [];
  if (W > 13.5) {
    // a wide tunnel (cut and cover, three lanes or more): straight walls and a flat roof
    const h = 5.4 + out;
    P.push([-dL - out, -0.1 - out * 1.2], [-dL - out, h], [mid, h + 0.12], [dR + out, h], [dR + out, -0.1 - out * 1.2]);
    return { P, crown: h + 0.12, spring: h, wide: true, mid, W };
  }
  const hs = 3.6, a = W / 2, r = Math.min(0.45 * W, 2.4);
  P.push([-dL - out, -0.1 - out * 1.2], [-dL - out, hs]);
  const K = 10;
  for (let k = 1; k < K; k++) { const t = Math.PI * (1 - k / K); P.push([mid + (a + out) * Math.cos(t), hs + (r + out) * Math.sin(t)]); }
  P.push([dR + out, hs], [dR + out, -0.1 - out * 1.2]);
  return { P, crown: hs + r + out, spring: hs, wide: false, mid, W };
}

// (the work is cut into slices of about 6 ms, the page drawing frames between them)
let sliceT = 0, busyT = 0, sliceMax = 0, sliceAt = '', at = '';
const Y = async (w) => { const t = performance.now(); if (t - sliceT > 6) { busyT += t - sliceT; if (t - sliceT > sliceMax) { sliceMax = t - sliceT; sliceAt = at + '>' + w; } await new Promise(r => setTimeout(r, 0)); sliceT = performance.now(); } at = w; };
export async function buildTunnels(R, L, opts, group, concrete, stats) {
  sliceT = performance.now(); busyT = 0; sliceMax = 0; at = 'start';
  const M = materials(concrete);
  const lift = L.lift ?? 0.03, open = opts.mode !== 'google', collide = opts.collide;
  const ground = (x, z) => { let g = null; try { g = opts.groundAt ? opts.groundAt(x, z) : null; } catch (e) { g = null; } return g == null || !isFinite(g) ? null : g; };
  const surf = (x, z, y) => { try { return R.surfaceAt(x, z, y); } catch (e) { return null; } };
  const surfAt = (x, z, y) => { try { const r = R.surfaceAt(x, z, y); return r && { onRoad: r.onRoad, edge: r.edge }; } catch (e) { return null; } };
  const nodes = L.nodes;
  const tubes = [], meshes = [], mask = [];
  let lining = new Soup(true);
  const shell = new Soup(false), lamps = [];
  // (the lining goes into meshes of about 17 000 triangles: each one's geometry and ray tree is then a few ms of work,
  // done between frames, where a kilometre of bore in one mesh took 70 ms at the end)
  const linings = [], cutLining = () => { if (lining.p.length) { linings.push(lining); lining = new Soup(true); } };
  stats.tunnels = 0; stats.tunnelM = 0; stats.portals = 0; stats.cutWalls = 0; stats.fillWalls = 0; stats.masked = 0;
  // the shaders of the tunnel's road and lining are built with the rest of the scene even with no tunnel in this
  // area (a speck of each far under the ground, as bridges.js does)
  try {
    const tm = R.tunnelMaterials ? R.tunnelMaterials() : [];
    for (const m of [...tm, M.lining]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(0.01, 0.01), m); w.position.y = -5000; w.frustumCulled = false; group.add(w); }
    // (the lamps are only ever drawn instanced)
    const w = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.01, 0.01), M.lamp, 1); w.setMatrixAt(0, new THREE.Matrix4());
    w.position.y = -5000; w.frustumCulled = false; w.userData.ownGeo = true; group.add(w);
  } catch (e) { console.warn('tunnel materials', e); }
  if (!L || !L.edges) return { reg: null, dispose() {} };
  const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _Y = new THREE.Vector3(0, 1, 0);
  const bl = open ? await buildingIndex(opts.buildings) : null;

  for (const e of L.edges) {
    if (e.c.tunnel !== 'bore' || !e.px || e.px.length < 2 || !(e.len > 1)) continue;
    await Y('L135');
    const c = e.c, N = e.px.length, dL = c.deckL ?? c.hw + 0.9, dR = c.deckR ?? c.hw + 0.9;
    const I = profile(dL, dR), O = profile(dL, dR, T);
    const arc = [0]; for (let j = 1; j < I.P.length; j++) arc.push(arc[j - 1] + Math.hypot(I.P[j][0] - I.P[j - 1][0], I.P[j][1] - I.P[j - 1][1]));
    stats.tunnels++; stats.tunnelM += e.len;
    const S = [];
    for (let i = 0; i < N; i++) S.push({ x: e.px[i], z: e.pz[i], s: e.ps[i], nx: e.nx[i], nz: e.nz[i], k: Math.min(1.6, e.mk[i] || 1), f: e.ph[i] + lift });
    const P = (A, o, y) => [A.x + A.nx * A.k * o, A.f + y, A.z + A.nz * A.k * o];
    // which ends are portals (the bore meets a road outside), and how far each sample is from the nearer one
    const isPortal = (id) => { const n = nodes.get(id); return !!n && n.ends.some(x => x.e.c.tunnel !== 'bore'); };
    const p0 = isPortal(e.ids[0]), p1 = isPortal(e.ids[e.ids.length - 1]);
    const dayAt = (s) => { const d = Math.min(p0 ? s : Infinity, p1 ? e.len - s : Infinity); return d < 40 ? 1 - d / 40 : 0; };
    // the lining's colours: pale tiles low on the walls, grey above; brighter near a portal (daylight)
    const col = (y, day) => { const b = y < 2.4 ? [0.5, 0.5, 0.48] : [0.3, 0.3, 0.29], k = 1 + 0.45 * day; return [b[0] * k, b[1] * k, b[2] * k]; };
    for (let i = 1; i < N; i++) {
      if ((i & 15) === 0) await Y('L150'); // (a kilometre of bore took 380 ms in one go)
      if (lining.p.length > 150000) cutLining();
      const A = S[i - 1], B = S[i], da = dayAt(A.s), db = dayAt(B.s);
      for (let j = 1; j < I.P.length; j++) {
        const [oa, ya] = I.P[j - 1], [ob, yb] = I.P[j];
        // facing into the bore: towards the middle of its cross-section
        const om = (oa + ob) / 2, ym = (ya + yb) / 2, tx = I.mid - om, ty = I.crown * 0.45 - ym;
        const nx = (A.nx + B.nx) / 2 * tx, nz = (A.nz + B.nz) / 2 * tx;
        const va = arc[j - 1] * 0.25, vb = arc[j] * 0.25;
        const ua = [A.s * 0.25, va], ub = [B.s * 0.25, va], uc = [B.s * 0.25, vb], ud = [A.s * 0.25, vb];
        lining.quad(P(A, oa, ya), P(B, oa, ya), P(B, ob, yb), P(A, ob, yb), [nx, ty, nz], ua, ub, uc, ud, col(ya, da), col(ya, db), col(yb, db), col(yb, da));
      }
      // the walkway along each wall (its surface is roads.js's, for the wheels and people)
      for (const sd of [-1, 1]) {
        const ow = sd * c.hw, od = sd < 0 ? -dL : dR, ka = [0.34 * (1 + 0.45 * da), 0.34 * (1 + 0.45 * da), 0.33 * (1 + 0.45 * da)], kb = [0.34 * (1 + 0.45 * db), 0.34 * (1 + 0.45 * db), 0.33 * (1 + 0.45 * db)];
        lining.quad(P(A, ow, WALK), P(B, ow, WALK), P(B, od, WALK), P(A, od, WALK), [0, 1, 0], [A.s * 0.25, 0], [B.s * 0.25, 0], [B.s * 0.25, 0.25], [A.s * 0.25, 0.25], ka, kb, kb, ka);
        const kk = [ka[0] * 0.8, ka[1] * 0.8, ka[2] * 0.8], kl = [kb[0] * 0.8, kb[1] * 0.8, kb[2] * 0.8];
        lining.quad(P(A, ow, -0.06), P(B, ow, -0.06), P(B, ow, WALK), P(A, ow, WALK), [-(A.nx + B.nx) / 2 * sd, 0, -(A.nz + B.nz) / 2 * sd], [A.s * 0.25, 0], [B.s * 0.25, 0], [B.s * 0.25, 0.04], [A.s * 0.25, 0.04], kk, kl, kl, kk);
      }
      // the shell only where it might be seen: near a portal, or where the ground over it is thin (deeper down the
      // lining itself keeps the sun off)
      const ga = ground(A.x, A.z), gb = ground(B.x, B.z);
      const deep = ga !== null && gb !== null && Math.min(ga - A.f, gb - B.f) > O.crown + 3 && dayAt(A.s) === 0 && dayAt(B.s) === 0;
      if (!deep) for (let j = 1; j < O.P.length; j++) {
        const [oa, ya] = O.P[j - 1], [ob, yb] = O.P[j];
        const om = (oa + ob) / 2, ym = (ya + yb) / 2, tx = om - O.mid, ty = ym - O.crown * 0.45;
        const nx = (A.nx + B.nx) / 2 * tx, nz = (A.nz + B.nz) / 2 * tx;
        shell.quad(P(A, oa, ya), P(B, oa, ya), P(B, ob, yb), P(A, ob, yb), [nx, ty, nz], [A.s * 0.25, ya * 0.25], [B.s * 0.25, ya * 0.25], [B.s * 0.25, yb * 0.25], [A.s * 0.25, yb * 0.25]);
      }
    }
    // lamps along the roof, every 8 m
    if (!LAMPG) LAMPG = new THREE.BoxGeometry(0.28, 0.07, 1.5);
    const rows = I.wide ? [I.mid - I.W / 4, I.mid + I.W / 4] : [I.mid];
    for (let s = Math.min(4, e.len / 2); s < e.len; s += 8) {
      let i = 1; while (i < N - 1 && S[i].s < s) i++;
      const A = S[i - 1], B = S[i], t = Math.max(0, Math.min(1, (s - A.s) / Math.max(1e-6, B.s - A.s)));
      const x = A.x + (B.x - A.x) * t, z = A.z + (B.z - A.z) * t, f = A.f + (B.f - A.f) * t, nx = (A.nx + B.nx) / 2, nz = (A.nz + B.nz) / 2;
      const tx = B.x - A.x, tz = B.z - A.z;
      _q.setFromAxisAngle(_Y, Math.atan2(tx, tz));
      for (const o of rows) {
        const y = (I.wide ? I.spring : I.crown) - 0.07;
        lamps.push(new THREE.Matrix4().compose(_p.set(x + nx * o, f + y, z + nz * o), _q, _s));
      }
    }
    // the walls stop the car (in pieces of up to 6 m)
    if (collide && collide.addSegment) for (const sd of [-1, 1]) {
      const off = (sd < 0 ? dL : dR) + 0.12;
      let a = 0;
      while (a < N - 1) {
        await Y('L199');
        let b = a + 1; while (b < N - 1 && S[b].s - S[a].s < 6) b++;
        const A = S[a], B = S[b];
        const pa = [A.x + A.nx * A.k * sd * off, A.z + A.nz * A.k * sd * off], pb = [B.x + B.nx * B.k * sd * off, B.z + B.nz * B.k * sd * off];
        // (no higher than a street over it: a car on the street is not stopped by the tunnel's wall under it)
        // (not across another road at this level: where two bores fork, or a ramp joins, the wall of one stood across
        // the other's carriageway and stopped the car in the Tuileries tunnel)
        const crosses = [pa, pb, [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2]].some(q => { const r = surfAt(q[0], q[1], (A.f + B.f) / 2); return r && r.onRoad && r.edge < -0.25; });
        if (crosses) { a = b; continue; }
        let top = Math.max(A.f, B.f) + I.crown;
        for (const q of [pa, pb, [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2]]) { const r = surf(q[0], q[1]); if (r && r.h != null && (r.onRoad || r.curbH > 0) && r.h > Math.min(A.f, B.f) + 1.5) top = Math.min(top, r.h - 0.4); }
        collide.addSegment(pa, pb, 0.3, Math.min(A.f, B.f) - 0.6, top, 'tunnel');
        a = b;
      }
    }
    // the bore for the world's ground and the camera, and the stretches where its roof is near the surface
    const tube = { x: S.map(q => q.x), z: S.map(q => q.z), f: S.map(q => q.f), dL, dR, hw: c.hw, walk: WALK, crown: I.crown, masked: false };
    // (only where the terrain comes down into the lining: ground over the roof, however thin, stays)
    const thin = S.map(q => { const g = ground(q.x, q.z); return g === null || g < q.f + I.crown + COVER; });
    for (let i = 1; i < N; i++) {
      if (!thin[i - 1] && !thin[i]) continue;
      const A = S[i - 1], B = S[i], wl = dL + T + 0.6, wr = dR + T + 0.6;
      const pa = P(A, -wl, 0), pb = P(B, -wl, 0), pc = P(B, wr, 0), pd = P(A, wr, 0);
      mask.push({ pts: [[pa[0], pa[2]], [pb[0], pb[2]], [pc[0], pc[2]], [pd[0], pd[2]]], top: I.crown + 0.2 });
      tube.masked = true; stats.masked++;
    }
    tubes.push(indexTube(tube));
    // a building standing over the bore where its roof is near the surface (over a portal) starts over the roof
    // (buildings.js passY, as for a bridge tower over a deck): its walls stood across the portal
    await Y('L224');
    if (bl) for (let i = 0; i < N; i++) {
      if (!thin[i]) continue;
      const A = S[i];
      for (const o of [-dL, 0, dR]) {
        const p = P(A, o, 0);
        for (const b of buildingsAt(bl, p[0], p[2])) { const want = A.f + O.crown + 0.3 - 5.5; if (!(b.b.passY >= want)) b.b.passY = want; stats.passOver = (stats.passOver || 0) + 1; }
      }
    }
    // a headwall round each portal
    for (const end of [0, 1]) {
      if (!(end ? p1 : p0)) continue;
      const A = S[end ? N - 1 : 0], B = S[end ? N - 2 : 1];
      let tx = A.x - B.x, tz = A.z - B.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl; // out of the tunnel
      // as wide as the bore and the walls along the road it meets there (tunnels.js's cut walls stand at that road's
      // outer edge)
      let oo = Math.max(dL, dR) + T + 2.2;
      const pn = nodes.get(end ? e.ids[e.ids.length - 1] : e.ids[0]);
      if (pn) for (const x of pn.ends) { const f = x.e, fc = f.c; if (fc.tunnel === 'bore') continue; for (const sd of [-1, 1]) { const curb = sd < 0 ? fc.curbL : fc.curbR; oo = Math.max(oo, fc.hw + (curb ? (sd < 0 ? fc.swWL : fc.swWR) : 0.4) + 1.2); } }
      oo = Math.min(oo, Math.max(dL, dR) + 14);
      const g = ground(A.x, A.z);
      const top = Math.max(O.crown + 1.4, Math.min(g == null ? 0 : g - A.f + 0.4, O.crown + 5));
      const poly = [[-oo, -0.8], [-dL, -0.8]];
      for (const q of I.P) poly.push([q[0], q[1]]);
      poly.push([dR, -0.8], [oo, -0.8], [oo, top], [-oo, top]);
      let tris = null;
      try { tris = THREE.ShapeUtils.triangulateShape(poly.map(q => new THREE.Vector2(q[0], q[1])), []); } catch (err) { tris = null; }
      const Q = (o, y, back = 0) => { const p = P(A, o, y); return [p[0] - tx * back, p[1], p[2] - tz * back]; };
      if (tris) for (const t of tris) {
        const [a, b, cc] = t.map(k => poly[k]);
        shell.tri(Q(a[0], a[1]), Q(b[0], b[1]), Q(cc[0], cc[1]), [tx, 0, tz], [a[0] * 0.25, a[1] * 0.25], [b[0] * 0.25, b[1] * 0.25], [cc[0] * 0.25, cc[1] * 0.25]);
      }
      // its coping, and its ends
      shell.quad(Q(-oo, top), Q(oo, top), Q(oo, top, 1.2), Q(-oo, top, 1.2), [0, 1, 0]);
      for (const sd of [-1, 1]) shell.quad(Q(sd * oo, -0.8), Q(sd * oo, top), Q(sd * oo, top, 1.2), Q(sd * oo, -0.8, 1.2), [A.nx * sd, 0, A.nz * sd]);
      // the reveal between the lining and the shell at the opening
      for (let j = 1; j < I.P.length; j++) {
        const a = I.P[j - 1], b = I.P[j], a2 = O.P[j - 1], b2 = O.P[j];
        void a2; void b2;
        shell.quad(Q(a[0], a[1]), Q(b[0], b[1]), Q(b[0], b[1], 0.6), Q(a[0], a[1], 0.6), [tx, 0, tz]);
      }
      if (collide && collide.addSegment) for (const sd of [-1, 1]) {
        const off0 = (sd < 0 ? dL : dR) + 0.1, a = P(A, sd * off0, 0), b = P(A, sd * oo, 0);
        collide.addSegment([a[0] - tx * 0.4, a[2] - tz * 0.4], [b[0] - tx * 0.4, b[2] - tz * 0.4], 0.8, A.f - 1, A.f + top, 'portal');
      }
      stats.portals++;
    }
  }

  // ---- walls along roads cut into the ground, and down to the ground under roads built up over it (open map)
  const DBG = typeof window !== 'undefined' && window.__wallDbg ? (window.__wallDbg = []) : null;
  if (open) {
    // a building's base: the lowest ground under its corners
    const baseOf = new Map(), bBase = (r) => { let v = baseOf.get(r); if (v === undefined) { v = Infinity; for (const q of r.p) { const g = ground(q[0], q[1]); if (g !== null && g < v) v = g; } baseOf.set(r, v); } return v; };
    for (const e of L.edges) {
      const c = e.c;
      if (c.bridge || c.tunnel === 'bore' || !e.px || e.px.length < 2 || e.ramp) continue;
      await Y('L281');
      const cutting = c.eng === 'cut';
      if (/^(footway|path|cycleway|steps|bridleway|pedestrian|track)$/.test(c.cls)) continue;
      const N = e.px.length, s0 = (e.set0 || 0) + 0.5, s1 = e.len - (e.set1 || 0) - 0.5;
      if (s1 - s0 < 4) continue;
      for (const sd of [-1, 1]) {
        await Y('L287');
        const curb = sd < 0 ? c.curbL : c.curbR, sw = curb ? (sd < 0 ? c.swWL : c.swWR) : 0;
        const off = c.hw + (curb ? sw : 0.4);
        const pts = [];
        for (let i = 0; i < N; i++) {
          if (e.ps[i] < s0 || e.ps[i] > s1) { pts.push(null); continue; }
          const k = Math.min(1.6, e.mk[i] || 1), x = e.px[i] + e.nx[i] * k * sd * off, z = e.pz[i] + e.nz[i] * k * sd * off;
          const top = e.ph[i] + lift + (e.pc[i] || 0) * sd * c.hw + (curb ? 0.15 : 0);
          let g = ground(x, z); const g2 = ground(x + e.nx[i] * sd * 1.5, z + e.nz[i] * sd * 1.5);
          if (g === null || g2 === null) { pts.push(null); continue; }
          // (a cutting: a wall all along, however low)
          const cut = cutting ? g - top > 0.25 : g - top > CUT_MIN && g2 - top > CUT_MIN * 0.8, fill = !cut && top - g > FILL_MIN && top - g2 > FILL_MIN * 0.8;
          if (!cut && !fill) { pts.push(null); continue; }
          // not where another road or a pavement is (a side street climbing the hill, a car park), nor where a
          // building stands at the road's own level (its walls are there); one up on the bank keeps the wall
          const ox = x + e.nx[i] * sd * 0.8, oz = z + e.nz[i] * sd * 0.8;
          // (with no height given: what is on the ground there, at whatever level; a road or pavement up on the bank
          // keeps the wall, which then stands up to it)
          const r = surf(ox, oz);
          const nb = r && (r.onRoad || r.curbH > 0) && r.h != null ? r.h : null;
          let blocked = nb !== null && (cut ? nb < top + 0.6 : nb > top - 0.6);
          if (!blocked && nb !== null) g = cut ? Math.max(g, nb) : Math.min(g, nb);
          if (!blocked && bl) for (const b of buildingsAt(bl, ox, oz)) if (bBase(b) < top + 1.5) { blocked = true; break; }
          if (DBG) DBG.push([e.id, sd, i, +x.toFixed(1), +z.toFixed(1), +top.toFixed(2), +g.toFixed(2), cut ? 'c' : 'f', blocked ? 'blk' : 'ok', nb === null ? null : +nb.toFixed(2)]);
          if (blocked) { pts.push(null); continue; }
          const ex = e.px[i] + e.nx[i] * k * sd * c.hw, ez = e.pz[i] + e.nz[i] * k * sd * c.hw, et = e.ph[i] + lift + (e.pc[i] || 0) * sd * c.hw;
          pts.push({ x, z, top, g, cut, s: e.ps[i], nx: e.nx[i] * sd, nz: e.nz[i] * sd, i, k, ex, ez, et });
        }
        // runs of the same kind
        let run = [];
        const flush = () => {
          if (run.length >= 2) wall(run, e, sd, off);
          run = [];
        };
        for (const p of pts) { if (!p || (run.length && run[run.length - 1].cut !== p.cut)) { flush(); if (p) run.push(p); } else run.push(p); }
        flush();
      }
    }
  }
  function wall(run, e, sd, off) {
    const cut = run[0].cut;
    for (let j = 1; j < run.length; j++) {
      const a = run[j - 1], b = run[j];
      const n = [(a.nx + b.nx) / 2, 0, (a.nz + b.nz) / 2];
      if (cut) {
        // a retaining wall from under the pavement's edge up to the ground, a coping on it, facing the road
        const ya0 = a.top - 0.35, yb0 = b.top - 0.35, ya1 = a.g + 0.3, yb1 = b.g + 0.3;
        shell.quad([a.x, ya0, a.z], [b.x, yb0, b.z], [b.x, yb1, b.z], [a.x, ya1, a.z], [-n[0], 0, -n[2]], [a.s * 0.25, ya0 * 0.25], [b.s * 0.25, yb0 * 0.25], [b.s * 0.25, yb1 * 0.25], [a.s * 0.25, ya1 * 0.25]);
        const ca = [a.x + a.nx * 0.9, ya1, a.z + a.nz * 0.9], cb = [b.x + b.nx * 0.9, yb1, b.z + b.nz * 0.9];
        shell.quad([a.x, ya1, a.z], [b.x, yb1, b.z], cb, ca, [0, 1, 0]);
        // the ground from the carriageway's edge to the wall (under the pavement where there is one), so nothing
        // shows through where the terrain is cut away
        shell.quad([a.ex, a.et - 0.03, a.ez], [b.ex, b.et - 0.03, b.ez], [b.x, b.top - 0.04, b.z], [a.x, a.top - 0.04, a.z], [0, 1, 0]);
        if (collide && collide.addSegment && Math.min(a.g - a.top, b.g - b.top) > 0.9) collide.addSegment([a.x + a.nx * 0.15, a.z + a.nz * 0.15], [b.x + b.nx * 0.15, b.z + b.nz * 0.15], 0.3, Math.min(a.top, b.top) - 0.6, Math.max(a.g, b.g) + 0.3, 'wall');
        // the ground over the road and its pavement out to the wall is cut away (the mask, relative to the road's
        // height at the mask's own cells)
        const e2 = e, ia = a.i, ib = b.i;
        const cx = (i) => [e2.px[i], e2.pz[i]];
        const A0 = cx(ia), B0 = cx(ib);
        const rise = Math.max(a.g, b.g) - Math.min(a.top, b.top) + 1.2;
        mask.push({ pts: [A0, B0, [b.x + b.nx * 0.5, b.z + b.nz * 0.5], [a.x + a.nx * 0.5, a.z + a.nz * 0.5]], top: rise });
        stats.cutWalls++;
      } else {
        // an embankment's wall from the edge down into the ground
        const ya0 = a.g - 0.6, yb0 = b.g - 0.6, ya1 = a.top + 0.02, yb1 = b.top + 0.02;
        shell.quad([a.x, ya0, a.z], [b.x, yb0, b.z], [b.x, yb1, b.z], [a.x, ya1, a.z], [n[0], 0, n[2]], [a.s * 0.25, ya0 * 0.25], [b.s * 0.25, yb0 * 0.25], [b.s * 0.25, yb1 * 0.25], [a.s * 0.25, ya1 * 0.25]);
        stats.fillWalls++;
      }
    }
    void off;
  }

  cutLining();
  for (const ln of linings) {
    await Y('L361');
    const lg = ln.geometry(); if (!lg) continue;
    const m = new THREE.Mesh(lg, M.lining); m.castShadow = true; m.receiveShadow = false; m.name = 'tunnel-lining'; group.add(m);
    try { if (lg.computeBoundsTree) lg.computeBoundsTree(); } catch (err) {}
    meshes.push(m);
  }
  await Y('L367');
  const sg = shell.geometry();
  if (sg) { const m = new THREE.Mesh(sg, M.concrete); m.castShadow = true; m.receiveShadow = true; m.name = 'tunnel-shell'; group.add(m); }
  if (lamps.length) {
    const m = new THREE.InstancedMesh(LAMPG, M.lamp, lamps.length);
    lamps.forEach((q, i) => m.setMatrixAt(i, q));
    m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); m.castShadow = false; m.receiveShadow = false; m.name = 'tunnel-lamps';
    group.add(m);
  }
  const reg = tubes.length || mask.length ? { tubes, meshes, mask } : null;
  under.set(reg);
  { const t = performance.now(); busyT += t - sliceT; if (t - sliceT > sliceMax) { sliceMax = t - sliceT; sliceAt = at + '>end'; } stats.tunnelWork = Math.round(busyT); stats.tunnelSlice = Math.round(sliceMax); stats.tunnelSliceAt = sliceAt; }
  return { reg, dispose() { under.clear(reg); } };
}

// building footprints by 32 m cells
async function buildingIndex(list) {
  const g = new Map();
  let n = 0;
  for (const b of list || []) {
    if ((++n & 255) === 0) await Y('L387');
    if (!b.outer || b.outer.length < 3 || b.roofOnly || (b.minHeight || 0) > 2.5) continue;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of b.outer) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    if (x1 - x0 > 400 || z1 - z0 > 400) continue;
    const r = { p: b.outer, x0, x1, z0, z1, b };
    for (let i = Math.floor(x0 / 32); i <= Math.floor(x1 / 32); i++) for (let j = Math.floor(z0 / 32); j <= Math.floor(z1 / 32); j++) { const k = i * 73856093 ^ j * 19349663; let l = g.get(k); if (!l) g.set(k, l = []); l.push(r); }
  }
  return g;
}
function buildingsAt(g, x, z) {
  const l = g.get(Math.floor(x / 32) * 73856093 ^ Math.floor(z / 32) * 19349663), out = []; if (!l) return out;
  for (const b of l) {
    if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
    let c = false; const r = b.p;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], q = r[j]; if ((a[1] > z) !== (q[1] > z) && x < (q[0] - a[0]) * (z - a[1]) / (q[1] - a[1]) + a[0]) c = !c; }
    if (c) out.push(b);
  }
  return out;
}
function inBuildings(g, x, z) {
  const l = g.get(Math.floor(x / 32) * 73856093 ^ Math.floor(z / 32) * 19349663); if (!l) return false;
  for (const b of l) {
    if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
    let c = false; const r = b.p;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], q = r[j]; if ((a[1] > z) !== (q[1] > z) && x < (q[0] - a[0]) * (z - a[1]) / (q[1] - a[1]) + a[0]) c = !c; }
    if (c) return true;
  }
  return false;
}

export default { buildTunnels };
