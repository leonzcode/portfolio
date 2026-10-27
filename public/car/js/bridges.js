// Bridges. roads.js works out every deck's height (bridgeDecks: raised over what it crosses, the approaches ramped
// up to meet it) and draws the road on top; this draws the structure in the open map: the deck slab under the road
// (its fascia and underside), a parapet along each side (a concrete wall on short motorway bridges, a low wall with
// a steel railing on the rest), piers down to the ground or the water where the deck stands clear of it, an
// abutment where a deck ends above the ground, walls along approach roads that were raised to meet a deck, and on
// big bridges (towers in the map data standing over the deck) the main cables and their hangers, with no piers
// under the suspended spans.
// The parapets are collision segments in both worlds; in the photographed (Google) world the photographs have the
// structure, so only the collision is added there.
//
//   const b = await bridges.build(roads, { scene, collide, groundAt(x, z), mode: 'open'|'google', buildings })
//   b.group, b.stats, b.dispose()
//
// Frame: geo.js local metres, +x east, +y up, +z south.
import * as THREE from 'three';
import { buildTunnels } from './tunnels.js?v=37';

const BASE = new URL('../', import.meta.url).href;
const PW = 0.32;                // parapet thickness
const WALL_H = 0.95;            // a concrete parapet over the walkway
const BASE_H = 0.5;             // the low wall under a railing
const RAIL_H = 1.1;             // the railing's top rail over the walkway
const WALK = 0.15;              // walkway (pavement or ledge) over the road surface
const RAIL_TOP = 1.15;          // the parapet's collision reaches this far over the walkway

let MATS = null;
function tex(file, srgb) {
  const t = new THREE.TextureLoader().load(BASE + 'textures/roads/' + file + '?v=37');
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function materials() {
  if (MATS) return MATS;
  const map = tex('concrete_floor_02_diff_1k.jpg', true), nor = tex('concrete_floor_02_nor_gl_1k.jpg'), rough = tex('concrete_floor_02_rough_1k.jpg');
  const concrete = new THREE.MeshStandardMaterial({ map, normalMap: nor, roughnessMap: rough, roughness: 1, color: new THREE.Color(0.92, 0.9, 0.86), normalScale: new THREE.Vector2(0.7, 0.7) });
  concrete.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float bl = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
      diffuseColor.rgb = mix(vec3(bl), diffuseColor.rgb, 0.3) * vec3(0.95, 0.94, 0.91);`);
  };
  concrete.customProgramCacheKey = () => 'bridge-concrete-1';
  const steel = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.55 });
  const rail = new THREE.MeshStandardMaterial({ color: 0x8c9399, roughness: 0.45, metalness: 0.6 });
  // the instanced meshes get their own copies: one material drawn both instanced and not makes three.js look its
  // program up again at every switch between the two, each frame (same shader code, so no extra compile)
  const concreteI = concrete.clone(); concreteI.onBeforeCompile = concrete.onBeforeCompile; concreteI.customProgramCacheKey = concrete.customProgramCacheKey;
  const railI = rail.clone();
  MATS = { concrete, steel, rail, concreteI, railI };
  return MATS;
}

// a growing triangle soup with flat normals; every triangle is wound to face the normal given
class Soup {
  constructor() { this.p = []; this.n = []; this.uv = []; }
  tri(a, b, c, n, ua, ub, uc) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * n[0] + cy * n[1] + cz * n[2] < 0) { const t = b; b = c; c = t; const tu = ub; ub = uc; uc = tu; }
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let k = 0; k < 3; k++) this.n.push(n[0], n[1], n[2]);
    this.uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
  }
  // a b c d in order round the quad
  quad(a, b, c, d, n, ua = Z2, ub = Z2, uc = Z2, ud = Z2) { this.tri(a, b, c, n, ua, ub, uc); this.tri(a, c, d, n, ua, uc, ud); }
  geometry() {
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}
const Z2 = [0, 0];

function instMesh(geo, mat, list, colour) {
  if (!list.length) return null;
  const m = new THREE.InstancedMesh(geo, mat, list.length);
  for (let i = 0; i < list.length; i++) m.setMatrixAt(i, list[i]);
  if (colour) { const c = new THREE.Color(); for (let i = 0; i < list.length; i++) m.setColorAt(i, c.set(list[i].colour || 0x888888)); }
  m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere();
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3();
// a box from y0 to y1 centred on (x, z), w across (along the normal nx, nz), d along the deck
function boxM(x, z, y0, y1, w, d, nx, nz) {
  _q.setFromAxisAngle(_Y, Math.atan2(-nz, nx)); // local +x along the normal
  return new THREE.Matrix4().compose(_p.set(x, y0, z), _q, _s.set(w, Math.max(0.01, y1 - y0), d));
}
function cylM(x, z, y0, y1, r) { return new THREE.Matrix4().compose(_p.set(x, y0, z), _q.identity(), _s.set(r, Math.max(0.01, y1 - y0), r)); }
// a cylinder from a to b (radius r)
function segM(a, b, r) {
  _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const L = _d.length() || 1e-3;
  _q.setFromUnitVectors(_Y, _d.divideScalar(L));
  return new THREE.Matrix4().compose(_p.set(a[0], a[1], a[2]), _q, _s.set(r, L, r));
}
let BOXG = null, CYLG = null, CABG = null;
function unitGeos() {
  if (BOXG) return;
  BOXG = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  CYLG = new THREE.CylinderGeometry(1, 1, 1, 14).translate(0, 0.5, 0);
  CABG = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0);
}

// Bridge chains: runs of bridge edges joined end to end through nodes where only two bridges meet. Each is a path
// { parts: [{ e, rev, s0 }], len, at(s) }, and every edge in it gets e._chain.
function chainsOf(L) {
  const isB = (e) => e.c.bridge && e.px && e.px.length >= 2;
  const nodes = L.nodes, seen = new Set(), out = [];
  const through = (id) => { const n = nodes.get(id); if (!n) return false; let b = 0; for (const x of n.ends) { if (!isB(x.e)) return false; b++; } return b === 2; };
  const other = (id, e) => { const n = nodes.get(id); for (const x of n.ends) if (x.e !== e) return x; return null; };
  for (const e0 of L.edges) {
    if (!isB(e0) || seen.has(e0)) continue;
    // walk back to the chain's first edge
    let e = e0, rev = false, guard = 0;
    for (;;) {
      const startId = rev ? e.ids[e.ids.length - 1] : e.ids[0];
      if (!through(startId) || guard++ > 500) break;
      const x = other(startId, e); if (!x || x.e === e0 || seen.has(x.e)) break;
      // x.e ends at startId: entering e from x.e means x.e runs towards startId
      e = x.e; rev = x.atStart; // x.atStart: the node is x.e's start, so walking backwards along the chain runs x.e reversed
    }
    // now walk forward
    const parts = []; let s = 0; guard = 0;
    for (;;) {
      seen.add(e); parts.push({ e, rev, s0: s }); e._chain = null; s += e.len;
      const endId = rev ? e.ids[0] : e.ids[e.ids.length - 1];
      if (!through(endId) || guard++ > 500) break;
      const x = other(endId, e); if (!x || seen.has(x.e)) break;
      e = x.e; rev = !x.atStart;
    }
    const ch = { parts, len: s };
    for (const p of parts) { p.e._chain = ch; p.e._rev = p.rev; p.e._cs0 = p.s0; }
    // a point s along the chain: position, deck top, normal (to the chain's right)
    ch.at = (s, lift) => {
      s = Math.max(0, Math.min(ch.len, s));
      let k = 0; while (k < parts.length - 1 && parts[k + 1].s0 <= s) k++;
      const { e, rev, s0 } = parts[k], u = rev ? e.len - (s - s0) : s - s0, N = e.px.length;
      let i = 1; while (i < N - 1 && e.ps[i] < u) i++;
      const t = Math.max(0, Math.min(1, (u - e.ps[i - 1]) / Math.max(1e-6, e.ps[i] - e.ps[i - 1]))), sg = rev ? -1 : 1;
      return { x: e.px[i - 1] + (e.px[i] - e.px[i - 1]) * t, z: e.pz[i - 1] + (e.pz[i] - e.pz[i - 1]) * t, y: e.ph[i - 1] + (e.ph[i] - e.ph[i - 1]) * t + lift, nx: e.nx[i] * sg, nz: e.nz[i] * sg, e, dL: rev ? e.c.deckR : e.c.deckL, dR: rev ? e.c.deckL : e.c.deckR };
    };
    ch.sOf = (e, u) => e._rev ? e._cs0 + (e.len - u) : e._cs0 + u;
    out.push(ch);
  }
  return out;
}

// (async: the tunnels and walls are built in slices, tunnels.js; drive.js awaits it)
let sliceT = 0, busyT = 0, sliceMax = 0;
const Y = async () => { const t = performance.now(); if (t - sliceT > 6) { busyT += t - sliceT; sliceMax = Math.max(sliceMax, t - sliceT); await new Promise(r => setTimeout(r, 0)); sliceT = performance.now(); } };
export async function build(R, opts = {}) {
  sliceT = performance.now(); busyT = 0; sliceMax = 0;
  const L = R && R._debug ? R._debug() : null;
  const group = new THREE.Group(); group.name = 'bridges';
  const stats = { decks: 0, chains: 0, rails: 0, piers: 0, walls: 0, towers: 0, cables: 0 };
  let tun = null;
  const handle = { group, stats, dispose() { if (tun) tun.dispose(); if (group.parent) group.parent.remove(group); group.traverse(o => { if (o.isInstancedMesh) { o.dispose(); if (o.userData.ownGeo) o.geometry.dispose(); } else if (o.geometry && o.geometry !== BOXG && o.geometry !== CYLG && o.geometry !== CABG && !o.userData.shared) o.geometry.dispose(); }); } };
  if (opts.scene) opts.scene.add(group);
  const M = materials(); unitGeos();
  // one tiny copy of each material far under the ground, so the first build's shader compile (drive.compileScene)
  // covers them even where the first area has no bridge
  for (const m of [M.concrete, M.rail]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(0.01, 0.01), m); w.position.y = -5000; w.frustumCulled = false; group.add(w); }
  for (const m of [M.concreteI, M.steel, M.railI]) {
    const w = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.01, 0.01), m, 1); w.setMatrixAt(0, new THREE.Matrix4());
    if (m === M.steel) w.setColorAt(0, new THREE.Color(0x888888)); // (the cables carry a colour each)
    w.position.y = -5000; w.frustumCulled = false; w.userData.ownGeo = true; group.add(w);
  }
  if (!L || !L.edges) return handle;
  const open = opts.mode !== 'google';
  const lift = L.lift ?? 0.03;
  const collide = opts.collide;
  const ground = (x, z) => { let g = null; try { g = opts.groundAt ? opts.groundAt(x, z) : null; } catch (e) { g = null; } return g == null || !isFinite(g) ? null : g; };
  const surf = (x, z, y, skip) => { try { return R.surfaceAt(x, z, y, skip); } catch (e) { return null; } };
  const nodes = L.nodes;
  const anchored = (id) => { const n = nodes.get(id); return !!n && n.ends.some(x => !x.e.c.bridge); };
  const soup = new Soup(), steel = new Soup(), I = { box: [], cyl: [], cab: [], post: [] };
  const depthOf = (e) => 1.0 + Math.min(1.4, e.c.hw * 0.06) + (e.c.rank >= 9 ? 0.3 : 0);
  const chains = chainsOf(L);
  stats.chains = chains.length;
  // towers (suspension bridges) and the spans hanging from them, where no piers go
  if (open && opts.buildings) { try { towers(chains, opts.buildings, lift, ground, stats); } catch (e) { console.warn('bridge towers', e); } }

  for (const e of L.edges) {
    if (!e.c.bridge || !e.px || e.px.length < 2) continue;
    await Y();
    stats.decks++;
    const c = e.c, N = e.px.length, T = depthOf(e), dL = c.deckL ?? c.hw + 0.6, dR = c.deckR ?? c.hw + 0.6;
    const ch = e._chain, railing = !(c.rank >= 9 && ch && ch.len < 250);
    const PH = railing ? BASE_H : WALL_H;
    const s0a = anchored(e.ids[0]), s1a = anchored(e.ids[e.ids.length - 1]);
    // the samples (every 3 m or so) with their deck heights
    const S = [];
    for (let i = 0; i < N; i++) {
      const k = Math.min(1.6, e.mk[i] || 1), top = e.ph[i] + lift;
      S.push({ x: e.px[i], z: e.pz[i], s: e.ps[i], nx: e.nx[i], nz: e.nz[i], k, top, w: top + WALK, b: top - T });
    }
    // parapets: along each side, except where that line lies on another carriageway at this level (a fork on a
    // viaduct, a slip road joining)
    const rail = [[], []];
    for (let i = 1; i < N; i++) for (const [si, sd] of [[0, -1], [1, 1]]) {
      const a = S[i - 1], b = S[i], off = (sd < 0 ? dL : dR) - PW / 2;
      const mx = (a.x + b.x) / 2 + (a.nx * a.k + b.nx * b.k) / 2 * sd * off, mz = (a.z + b.z) / 2 + (a.nz * a.k + b.nz * b.k) / 2 * sd * off;
      const q = surf(mx, mz, (a.top + b.top) / 2);
      rail[si][i] = !(q && q.onRoad && q.edge < -0.25);
    }
    // collision: the parapets, in pieces of up to 6 m
    if (collide && collide.addSegment) for (const [si, sd] of [[0, -1], [1, 1]]) {
      let i0 = null;
      const flush = (i1) => {
        if (i0 == null) return;
        let a = i0;
        while (a < i1) {
          let b = a + 1; while (b < i1 && S[b].s - S[a].s < 6) b++;
          const A = S[a], B = S[b], off = (sd < 0 ? dL : dR) - PW / 2;
          const p = [A.x + A.nx * A.k * sd * off, A.z + A.nz * A.k * sd * off], q = [B.x + B.nx * B.k * sd * off, B.z + B.nz * B.k * sd * off];
          collide.addSegment(p, q, PW, Math.min(A.w, B.w) - 0.7, Math.max(A.w, B.w) + RAIL_TOP, 'rail');
          stats.rails++;
          a = b;
        }
        i0 = null;
      };
      for (let i = 1; i < N; i++) { if (rail[si][i]) { if (i0 == null) i0 = i - 1; } else flush(i - 1); }
      flush(N - 1);
    }
    if (!open) continue;
    // the slab: underside, fascia and parapet faces, segment by segment
    const P = (A, o, y) => [A.x + A.nx * A.k * o, y, A.z + A.nz * A.k * o];
    for (let i = 1; i < N; i++) {
      const A = S[i - 1], B = S[i], ua = A.s * 0.25, ub = B.s * 0.25;
      soup.quad(P(A, -dL, A.b), P(B, -dL, B.b), P(B, dR, B.b), P(A, dR, A.b), [0, -1, 0], [ua, -dL * 0.25], [ub, -dL * 0.25], [ub, dR * 0.25], [ua, dR * 0.25]);
      for (const [si, sd] of [[0, -1], [1, 1]]) {
        const off = sd < 0 ? dL : dR, has = rail[si][i];
        const nOut = [(A.nx + B.nx) / 2 * sd, 0, (A.nz + B.nz) / 2 * sd];
        const ta = has ? A.w + PH : A.w, tb = has ? B.w + PH : B.w;
        soup.quad(P(A, sd * off, A.b), P(B, sd * off, B.b), P(B, sd * off, tb), P(A, sd * off, ta), nOut, [ua, A.b * 0.25], [ub, B.b * 0.25], [ub, tb * 0.25], [ua, ta * 0.25]);
        if (!has) continue;
        const inn = sd * (off - PW), nIn = [-nOut[0], 0, -nOut[2]];
        soup.quad(P(A, inn, A.w - 0.05), P(B, inn, B.w - 0.05), P(B, inn, B.w + PH), P(A, inn, A.w + PH), nIn, [ua, 0], [ub, 0], [ub, PH * 0.25], [ua, PH * 0.25]);
        soup.quad(P(A, inn, A.w + PH), P(B, inn, B.w + PH), P(B, sd * off, B.w + PH), P(A, sd * off, A.w + PH), [0, 1, 0], [ua, 0], [ub, 0], [ub, PW * 0.25], [ua, PW * 0.25]);
        // ends of a parapet run
        const tx = B.x - A.x, tz = B.z - A.z;
        if (!rail[si][i - 1]) soup.quad(P(A, inn, A.w - 0.05), P(A, sd * off, A.w - 0.05), P(A, sd * off, A.w + PH), P(A, inn, A.w + PH), [-tx, 0, -tz]);
        if (i === N - 1 || !rail[si][i + 1]) soup.quad(P(B, inn, B.w - 0.05), P(B, sd * off, B.w - 0.05), P(B, sd * off, B.w + PH), P(B, inn, B.w + PH), [tx, 0, tz]);
        if (railing) {
          // two steel rails on posts over the low wall
          const ro = sd * (off - PW / 2);
          for (const [y, hh, ww] of [[RAIL_H - 0.08, 0.08, 0.1], [BASE_H + 0.28, 0.05, 0.06]]) {
            const a0 = P(A, ro - ww / 2, A.w + y), a1 = P(A, ro + ww / 2, A.w + y), b0 = P(B, ro - ww / 2, B.w + y), b1 = P(B, ro + ww / 2, B.w + y);
            const up = (p) => [p[0], p[1] + hh, p[2]];
            steel.quad(up(a0), up(b0), up(b1), up(a1), [0, 1, 0]);
            steel.quad(a0, b0, b1, a1, [0, -1, 0]);
            const nn = [(A.nx + B.nx) / 2, 0, (A.nz + B.nz) / 2]; // a0 lies on the -n side, a1 on the +n side
            steel.quad(a0, b0, up(b0), up(a0), [-nn[0], 0, -nn[2]]);
            steel.quad(a1, b1, up(b1), up(a1), nn);
          }
          const segL = Math.hypot(tx, tz), n = Math.max(1, Math.round(segL / 2.4));
          for (let k = 0; k < n; k++) {
            const t = k / n, x = A.x + tx * t, z = A.z + tz * t, w = A.w + (B.w - A.w) * t, nx = A.nx + (B.nx - A.nx) * t, nz = A.nz + (B.nz - A.nz) * t, kk = A.k;
            I.post.push(boxM(x + nx * kk * ro, z + nz * kk * ro, w + BASE_H - 0.02, w + RAIL_H - 0.04, 0.07, 0.07, nx, nz));
          }
        }
      }
    }
    // the ends of the slab: closed off where a deck meets the ground, down to it if the deck stands above it
    for (const [end, A] of [[0, S[0]], [1, S[N - 1]]]) {
      if (!(end ? s1a : s0a)) continue; // a deck that carries on into another bridge's
      const B = S[end ? N - 2 : 1], tx = (A.x - B.x), tz = (A.z - B.z), tl = Math.hypot(tx, tz) || 1, nEnd = [tx / tl, 0, tz / tl];
      const g = ground(A.x, A.z), lo = g != null && g < A.b - 0.3 ? g - 1 : A.b;
      soup.quad(P(A, -dL, lo), P(A, dR, lo), P(A, dR, A.w), P(A, -dL, A.w), nEnd, [-dL * 0.25, lo * 0.25], [dR * 0.25, lo * 0.25], [dR * 0.25, A.w * 0.25], [-dL * 0.25, A.w * 0.25]);
    }
    // piers, where the deck stands clear of the ground (none under a span hanging from towers)
    const span = e.len > 400 ? 55 : e.len > 150 ? 40 : 28;
    const m0 = s0a ? 7 : span / 2, m1 = s1a ? 7 : span / 2, run = e.len - m0 - m1;
    if (run > 0) {
      const n = Math.max(1, Math.round(run / span));
      const at = (s) => { let i = 1; while (i < N - 1 && S[i].s < s) i++; const A = S[i - 1], B = S[i], t = Math.max(0, Math.min(1, (s - A.s) / Math.max(1e-6, B.s - A.s))); return { x: A.x + (B.x - A.x) * t, z: A.z + (B.z - A.z) * t, b: A.b + (B.b - A.b) * t, nx: (A.nx + B.nx) / 2, nz: (A.nz + B.nz) / 2, s }; };
      const W = dL + dR, cols = W < 9 ? 1 : W < 19 ? 2 : 3, mid = (dR - dL) / 2;
      for (let k = 0; k <= n; k++) {
        const s = m0 + run * k / n;
        if (ch && ch.hung && ch.hung.some(([a, b]) => { const cs = ch.sOf(e, s); return cs > a && cs < b; })) continue;
        let q = null;
        for (const ds of [0, 5, -5, 10, -10]) {
          const p = at(Math.max(1, Math.min(e.len - 1, s + ds))), g = ground(p.x, p.z);
          if (g == null || p.b - g < 1.4) break;
          // never on a road under the deck
          let clear = true;
          for (let ci = 0; ci < cols && clear; ci++) {
            const o = cols === 1 ? mid : -dL + 1.6 + (W - 3.2) * ci / (cols - 1);
            // (any road under it whatever its height: a road in a cutting lies well under the ground's model)
            const rr = surf(p.x + p.nx * o, p.z + p.nz * o, g + 0.4, 1), r2 = surf(p.x + p.nx * o, p.z + p.nz * o, undefined, 1);
            if ((rr && (rr.onRoad || rr.edge < 1.5)) || (r2 && (r2.onRoad || r2.edge < 1.5) && (r2.h == null || r2.h < p.b))) clear = false;
          }
          if (clear) { q = { ...p, g }; break; }
        }
        if (!q) continue;
        const h = q.b - q.g, capH = Math.min(1.6, 0.7 + h * 0.03), r = Math.min(1.8, 0.55 + h * 0.014);
        I.box.push(boxM(q.x + q.nx * mid, q.z + q.nz * mid, q.b - capH, q.b, W * 0.9, 1.6, q.nx, q.nz));
        if (cols === 1) {
          const ww = Math.min(4.5, W * 0.45), th = Math.min(2.4, 1.1 + h * 0.012);
          I.box.push(boxM(q.x + q.nx * mid, q.z + q.nz * mid, q.g - 2, q.b - capH, ww, th, q.nx, q.nz));
          if (collide && collide.addSegment) collide.addSegment([q.x + q.nx * (mid - ww / 2), q.z + q.nz * (mid - ww / 2)], [q.x + q.nx * (mid + ww / 2), q.z + q.nz * (mid + ww / 2)], th, q.g - 2, q.b - capH, 'pier');
        } else for (let ci = 0; ci < cols; ci++) {
          const o = -dL + 1.6 + (W - 3.2) * ci / (cols - 1), x = q.x + q.nx * o, z = q.z + q.nz * o;
          I.cyl.push(cylM(x, z, q.g - 2, q.b - capH, r));
          if (collide && collide.addCircle) collide.addCircle(x, z, r, q.g - 2, q.b - capH, 'pier');
        }
        stats.piers++;
      }
    }
  }

  // bridge junctions (where only bridges meet): their underside and outer faces, from the junction's outline
  if (open && L.junctions) for (const j of L.junctions) {
    if (!j.outline || !j.E.every(x => x.e.c.bridge)) continue;
    const ol = j.outline, T = Math.max(...j.E.map(x => depthOf(x.e)));
    let mx = 0, mz = 0; for (const q of ol) { mx += q.x; mz += q.z; } mx /= ol.length; mz /= ol.length;
    // pushed out to the decks' edges (0.6 m past the carriageway)
    const out = ol.map(q => { const dx = q.x - mx, dz = q.z - mz, l = Math.hypot(dx, dz) || 1; return { x: q.x + dx / l * 0.6, z: q.z + dz / l * 0.6, top: q.h + lift }; });
    let tris = null;
    try { tris = THREE.ShapeUtils.triangulateShape(out.map(q => new THREE.Vector2(q.x, q.z)), []); } catch (e) { tris = null; }
    if (tris) for (const t of tris) { const [a, b, c] = t.map(k => out[k]); soup.tri([a.x, a.top - T, a.z], [b.x, b.top - T, b.z], [c.x, c.top - T, c.z], [0, -1, 0], [a.x * 0.25, a.z * 0.25], [b.x * 0.25, b.z * 0.25], [c.x * 0.25, c.z * 0.25]); }
    for (let i = 0; i < out.length; i++) {
      const a = out[i], b = out[(i + 1) % out.length];
      if (ol[i].cut) continue;
      const nx = b.z - a.z, nz = -(b.x - a.x), mxs = (a.x + b.x) / 2 - mx, mzs = (a.z + b.z) / 2 - mz, sg = nx * mxs + nz * mzs < 0 ? -1 : 1;
      soup.quad([a.x, a.top - T, a.z], [b.x, b.top - T, b.z], [b.x, b.top + WALK, b.z], [a.x, a.top + WALK, a.z], [nx * sg, 0, nz * sg], [0, 0], [1, 0], [1, 0.3], [0, 0.3]);
    }
  }

  // approach roads raised to meet a deck: retaining walls down to the ground, with a low wall and its collision on
  // top where the road stands well clear of the ground
  for (const e of L.edges) {
    if (e.c.bridge || !e.ramp || !e.px) continue;
    const c = e.c, N = e.px.length;
    for (const sd of [-1, 1]) {
      const off = c.hw + ((sd < 0 ? c.curbL : c.curbR) ? Math.min(3.5, sd < 0 ? c.swWL : c.swWR) : 0.3);
      let prev = null;
      for (let i = 0; i < N; i++) {
        const k = Math.min(1.6, e.mk[i] || 1), x = e.px[i] + e.nx[i] * k * sd * off, z = e.pz[i] + e.nz[i] * k * sd * off;
        const top = e.ph[i] + lift + WALK, g = ground(x, z);
        const cur = { x, z, top, g, rise: g == null ? 0 : top - g, nx: e.nx[i] * sd, nz: e.nz[i] * sd, s: e.ps[i] };
        if (prev && open && (prev.rise > 0.35 || cur.rise > 0.35) && prev.g != null && cur.g != null) {
          const wa = prev.rise > 1.2 ? WALL_H : 0, wb = cur.rise > 1.2 ? WALL_H : 0, n = [(prev.nx + cur.nx) / 2, 0, (prev.nz + cur.nz) / 2];
          soup.quad([prev.x, prev.g - 0.6, prev.z], [cur.x, cur.g - 0.6, cur.z], [cur.x, cur.top + wb, cur.z], [prev.x, prev.top + wa, prev.z], n, [prev.s * 0.25, (prev.g - 0.6) * 0.25], [cur.s * 0.25, (cur.g - 0.6) * 0.25], [cur.s * 0.25, (cur.top + wb) * 0.25], [prev.s * 0.25, (prev.top + wa) * 0.25]);
          if (wa || wb) {
            const ix = -n[0] * PW, iz = -n[2] * PW;
            soup.quad([prev.x + ix, prev.top - 0.1, prev.z + iz], [cur.x + ix, cur.top - 0.1, cur.z + iz], [cur.x + ix, cur.top + wb, cur.z + iz], [prev.x + ix, prev.top + wa, prev.z + iz], [-n[0], 0, -n[2]], [0, 0], [1, 0], [1, 0.2], [0, 0.2]);
            soup.quad([prev.x + ix, prev.top + wa, prev.z + iz], [cur.x + ix, cur.top + wb, cur.z + iz], [cur.x, cur.top + wb, cur.z], [prev.x, prev.top + wa, prev.z], [0, 1, 0]);
          }
          stats.walls++;
        }
        if (prev && collide && collide.addSegment && prev.rise > 1.2 && cur.rise > 1.2) collide.addSegment([prev.x - prev.nx * PW / 2, prev.z - prev.nz * PW / 2], [cur.x - cur.nx * PW / 2, cur.z - cur.nz * PW / 2], PW, Math.min(prev.top, cur.top) - 0.7, Math.max(prev.top, cur.top) + RAIL_TOP, 'rail');
        prev = cur;
      }
    }
  }

  // main cables and hangers
  if (open) { try { cables(chains, L, lift, I, stats); } catch (e) { console.warn('bridge cables', e); } }
  // tunnels (their linings, lamps, portals and walls) and the walls of roads cut into the ground (tunnels.js)
  { const t = performance.now(); busyT += t - sliceT; sliceMax = Math.max(sliceMax, t - sliceT); }
  try { tun = await buildTunnels(R, L, opts, group, M.concrete, stats); } catch (e) { console.warn('tunnels', e); }
  sliceT = performance.now();

  const g = soup.geometry();
  if (g) { const m = new THREE.Mesh(g, M.concrete); m.castShadow = true; m.receiveShadow = true; m.name = 'bridge-decks'; group.add(m); }
  const sg = steel.geometry();
  if (sg) { const m = new THREE.Mesh(sg, M.rail); m.castShadow = false; m.receiveShadow = true; m.name = 'bridge-rails'; group.add(m); }
  for (const m of [instMesh(BOXG, M.concreteI, I.box), instMesh(CYLG, M.concreteI, I.cyl), instMesh(CABG, M.steel, I.cab, true), instMesh(BOXG, M.railI, I.post)]) if (m) group.add(m);
  const post = group.children[group.children.length - 1]; if (post && post.isInstancedMesh && post.material === M.railI) post.castShadow = false;
  // nothing here moves: each matrix is made once, not every frame
  group.traverse(o => { o.updateMatrix(); o.matrixAutoUpdate = false; });
  { const t = performance.now(); busyT += t - sliceT; sliceMax = Math.max(sliceMax, t - sliceT); stats.work = Math.round(busyT); stats.slice = Math.round(sliceMax); }
  return handle;
}

// Towers: buildings taller than 25 m over the deck whose footprint the chain's centre line passes through (or
// within its width of). A chain with towers has a main span between them (a cable when it is over 120 m: Tower
// Bridge's middle is a bascule) and side spans out from the outer towers; ch.hung lists them (no piers there).
function towers(chains, buildings, lift, ground, stats) {
  const tall = [];
  for (const b of buildings) {
    if (!b.outer || b.outer.length < 3 || !(b.height > 35)) continue;
    let x = 0, z = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [px, pz] of b.outer) { x += px; z += pz; x0 = Math.min(x0, px); x1 = Math.max(x1, px); z0 = Math.min(z0, pz); z1 = Math.max(z1, pz); }
    x /= b.outer.length; z /= b.outer.length;
    if (x1 - x0 > 120 || z1 - z0 > 120) continue;
    tall.push({ b, x, z, r: Math.max(x1 - x0, z1 - z0) / 2 });
  }
  if (!tall.length) return;
  for (const ch of chains) {
    if (ch.len < 60) continue;
    const found = [];
    // (only the tall buildings near the chain: a city centre has hundreds)
    let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
    for (const { e } of ch.parts) for (let i = 0; i < e.px.length; i++) { bx0 = Math.min(bx0, e.px[i]); bx1 = Math.max(bx1, e.px[i]); bz0 = Math.min(bz0, e.pz[i]); bz1 = Math.max(bz1, e.pz[i]); }
    for (const t of tall) {
      if (t.x < bx0 - t.r - 40 || t.x > bx1 + t.r + 40 || t.z < bz0 - t.r - 40 || t.z > bz1 + t.r + 40) continue;
      let best = Infinity, bs = 0;
      for (const { e, rev, s0 } of ch.parts) {
        for (let i = 1; i < e.px.length; i++) {
          const ax = e.px[i - 1], az = e.pz[i - 1], dx = e.px[i] - ax, dz = e.pz[i] - az, L2 = dx * dx + dz * dz;
          const u = L2 > 0 ? Math.max(0, Math.min(1, ((t.x - ax) * dx + (t.z - az) * dz) / L2)) : 0;
          const d = Math.hypot(t.x - ax - dx * u, t.z - az - dz * u);
          if (d < best) { best = d; const es = e.ps[i - 1] + (e.ps[i] - e.ps[i - 1]) * u; bs = rev ? s0 + e.len - es : s0 + es; }
        }
      }
      const p = ch.at(bs, lift);
      if (best > t.r + Math.max(p.dL || 0, p.dR || 0, 6) + 4 || bs < 5 || bs > ch.len - 5) continue;
      if (!t.top) { let gmin = Infinity; for (const [px, pz] of t.b.outer) { const g = ground(px, pz); if (g != null && g < gmin) gmin = g; } t.top = isFinite(gmin) ? gmin + t.b.height : -Infinity; }
      if (t.top > p.y + 25 && !found.some(f => Math.abs(f.s - bs) < 15)) found.push({ s: bs, top: t.top - 2 });
    }
    if (!found.length) continue;
    found.sort((a, b) => a.s - b.s);
    ch.towers = found;
    stats.towers += found.length;
    const main = found[found.length - 1].s - found[0].s, side = Math.max(70, Math.min(350, main * 0.42));
    ch.side = side; ch.mainCable = found.length >= 2 && main > 120;
    ch.hung = [[found[0].s - side, found[found.length - 1].s + side]];
  }
}

// The cables: each side of a chain with towers (but a side with another bridge right beside it, a twin
// carriageway, whose own cable is on its far side): a parabola from tower top to tower top with its low point 2.5 m
// over the deck, side spans curving down from the outer towers to the deck, hangers every 15 m.
function cables(chains, L, lift, I, stats) {
  for (const ch of chains) {
    const T = ch.towers; if (!T || !T.length) continue;
    const name = ch.parts[0].e.way && ch.parts[0].e.way.tags && ch.parts[0].e.way.tags.name || '';
    const col = /golden gate/i.test(name) ? 0xb83a24 : 0x6f777e;
    const first = T[0], last = T[T.length - 1], side = ch.side;
    const s0 = Math.max(0, first.s - side), s1 = Math.min(ch.len, last.s + side);
    const cy = (s) => {
      if (s <= first.s) { const t = (s - s0) / Math.max(1, first.s - s0), d = ch.at(s0, lift).y + 1.5; return d + (first.top - d) * (0.35 * t + 0.65 * t * t); }
      if (s >= last.s) { const t = (s1 - s) / Math.max(1, s1 - last.s), d = ch.at(s1, lift).y + 1.5; return d + (last.top - d) * (0.35 * t + 0.65 * t * t); }
      for (let k = 1; k < T.length; k++) {
        const A = T[k - 1], B = T[k];
        if (s > B.s) continue;
        if (!ch.mainCable) return null;
        const u = (s - A.s) / Math.max(1, B.s - A.s), lo = ch.at((A.s + B.s) / 2, lift).y + 2.5, line = A.top + (B.top - A.top) * u;
        return line - 4 * ((A.top + B.top) / 2 - lo) * u * (1 - u);
      }
      return null;
    };
    for (const sd of [-1, 1]) {
      // a twin deck right beside this side has its own cable on its far side
      const mid = ch.at((s0 + s1) / 2, lift);
      let twin = false;
      for (const o of L.edges) {
        if (o._chain === ch || !o.c.bridge || !o.px) continue;
        for (let i = 0; i < o.px.length && !twin; i += 2) { const dx = o.px[i] - mid.x, dz = o.pz[i] - mid.z, lat = (dx * mid.nx + dz * mid.nz) * sd; if (lat > 2 && lat < 30 && Math.hypot(dx, dz) < 32) twin = true; }
        if (twin) break;
      }
      if (twin) continue;
      const step = Math.max(5, (s1 - s0) / 200);
      let prev = null;
      for (let s = s0; s <= s1 + 1e-6; s += step) {
        const ss = Math.min(s, s1), p = ch.at(ss, lift), y = cy(ss);
        if (y == null) { prev = null; continue; }
        const off = (sd < 0 ? p.dL : p.dR) + 0.3, q = [p.x + p.nx * sd * off, y, p.z + p.nz * sd * off];
        if (prev) { const m = segM(prev, q, 0.45); m.colour = col; I.cab.push(m); stats.cables++; }
        prev = q;
      }
      for (let s = s0 + 7.5; s < s1; s += 15) {
        if (T.some(t => Math.abs(t.s - s) < 5)) continue;
        const p = ch.at(s, lift), y = cy(s);
        if (y == null || y - p.y < 1.5) continue;
        const off = (sd < 0 ? p.dL : p.dR) + 0.3, x = p.x + p.nx * sd * off, z = p.z + p.nz * sd * off;
        const m = segM([x, p.y + WALK, z], [x, y, z], 0.07); m.colour = col; I.cab.push(m);
      }
    }
  }
}

export const bridges = { build };
export default bridges;
