// What skis do to snow: the track maps (pictures of the ground, drawn into by every ski, the board, a sled's runners, a
// fall) and the spray thrown off edges. The snow material (materials.js) reads the maps.
// A map's four channels, each the most any stamp left there (MAX blending):
//   r  the grooves' edges as a distance field: 0.5 on a groove's edge, more inside, less outside (uK per metre), so the
//      snow material draws the edge crisp at any distance however coarse the map's texels; a groove's softer outside
//      wall is a gentler slope of the field (its edge is drawn softer)
//   g  snow pushed up: the little lip beside a carve, the ridge along a skid, a powder trench's heaped sides (lumpy)
//   b  snow scraped smooth by a skidding base (a skid polishes, it does not dig)
//   a  how deep a groove is (0..1 of the snow kind's depth, env.js), deepest at a carve's inside wall
// A strong skid first rubs out what was under it (a MIN pass): a skid erases the carve lines and lips it slides over.
// The fine map (6.25 cm texels) covers 64 x 128 m round the rider, most of it behind, and wraps round (its texel for a
// place is fixed: the place modulo the map's size): as the rider moves it only fills the strip it uncovers (from the
// coarse map), never copies itself, so nothing pops or shifts. The coarse map covers the whole park and keeps every
// track; the snow fades from one to the other over the fine map's last few metres.
// The tracks follow what real skis leave: a carving edge cuts a narrow groove with a crisp, steep inside wall and a
// small lip on the outside of the turn; a skid scrapes a wide, flat, smoothed fan with loose snow along its outside;
// powder takes a deep soft-walled trench with lumps heaped beside it; ice only a fine white scratch; a landing presses a
// short flat patch; a fall leaves a hollow.
import * as THREE from 'three';
import { snowUniforms } from './materials.js?v=20';
import { height, surface, getPark } from './terrain.js?v=20';
import { snowKind, SNOW } from './env.js?v=20';
const SNOW_POWDER = SNOW.powder, SNOW_SPRING = SNOW.spring, SNOW_ICE = SNOW.ice;

const FINE = { W: 1024, H: 2048, SX: 64, SZ: 128, back: 0.72, step: 0.5, bx: -32, bz: 0 };   // (bx, bz: where its tiles start, so no tile edge runs down the Jump Line's middle lane)
const RAMP = 3;           // the edge field runs 3 texels past an edge (bilinear filtering then puts the edge exactly)
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// a stamp: the segment a..b of a ski's path, pushed out across it (in the shader, so the vertices only carry the segment
// and the stamp's numbers); drawn straight into a map's texels (uMap: the map's origin and size; the fine map's copies
// for each of its tiles the stamp reaches are offset by aTile)
const STAMP_VS = `
attribute vec4 aAB;     // the segment: a (x, z), b (x, z)
attribute vec4 aP1;     // groove half width (m), depth 0..1, the outside wall's slope (0..1, 1 as steep as the inside), which side the inside is (+1 left, -1 right, 0 none)
attribute vec4 aP2;     // heap height 0..1, heap width (m), which side it is heaped (+1 left, -1 right, 0 both), scrape 0..1
attribute vec2 aTile;   // the world origin of the fine map's tile this copy is for (position: corner across -1..1,
                        // corner along 0..1, the scraped band's half width m)
uniform vec4 uMap; uniform vec2 uTexel; uniform float uK; uniform float uUseTile;
varying vec3 vL; varying vec4 vP1; varying vec4 vP2; varying float vSW; varying vec2 vW; varying vec2 vT;
void main() {
  vec2 A = aAB.xy, dv = aAB.zw - A; float L = length(dv);
  vec2 t = L > 1e-5 ? dv / L : vec2(0.0, 1.0), nr = vec2(t.y, -t.x);    // nr: the rider's left of the way a to b
  // (a groove or band narrower than this map's texels can hold is widened to them, and made shallower in step)
  float minW = 0.7 * dot(abs(nr), uTexel);
  vP1 = aP1; vP2 = aP2; vSW = position.z;
  if (aP1.x > 0.0) { float hw = max(aP1.x, minW); vP1.y *= mix(1.0, aP1.x / hw, 0.6); vP1.x = hw; }
  if (vSW > 0.0) vSW = max(vSW, minW);
  vP2.y = max(vP2.y, minW);
  float ramp = 0.5 / uK / max(vP1.z, 0.25);
  float ext = max(vP1.x + ramp, max(vP1.x, vSW) + vP2.y) + 0.6 * max(uTexel.x, uTexel.y);
  float across = position.x * ext, along = mix(-ext, L + ext, position.y);
  vL = vec3(across, along, L);
  vec2 P = A + t * along + nr * across;
  vW = P; vT = t;
  gl_Position = vec4((P - uMap.xy - aTile * uUseTile) / uMap.zw * 2.0 - 1.0, 0.0, 1.0);
}`;
const STAMP_COMMON = `
uniform float uK; uniform vec2 uTexel;
varying vec3 vL; varying vec4 vP1; varying vec4 vP2; varying float vSW; varying vec2 vW; varying vec2 vT;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y); }
`;
const STAMP_FS = STAMP_COMMON + `
void main() {
  float a = vL.x, dist = length(vec2(a, max(0.0, max(-vL.y, vL.y - vL.z))));     // to the segment (round ends)
  float hw = vP1.x, R = 0.0, A = 0.0;
  if (hw > 0.0) {
    // (a wide hollow, a fall's or a trough's, has a broken, uneven edge)
    dist += (vnoise(vW * 6.0) - 0.5) * 0.1 * smoothstep(0.1, 0.3, hw);
    float s = a * vP1.w;                                                     // + towards the inside wall
    float sl = mix(vP1.z, 1.0, smoothstep(-0.4 * hw, 0.4 * hw, s));
    R = clamp(0.5 + uK * sl * (hw - dist), 0.0, 1.0);
    float tx = max(uTexel.x, uTexel.y);
    A = vP1.y * (0.55 + 0.45 * smoothstep(-hw, hw, s)) * (1.0 - smoothstep(hw + tx, hw + 2.0 * tx, dist));
  }
  // the scraped band, its edge ragged (the base catches and lets go), streaked along the way it slid (the edges'
  // scratches)
  float B = 0.0, edge = max(hw, vSW);
  if (vSW > 0.0) {
    float rag = (vnoise(vW * 9.0) - 0.5) * 0.08 + (vnoise(vW * 27.0) - 0.5) * 0.04;
    float streak = vnoise(vec2(dot(vW, vec2(vT.y, -vT.x)) * 7.0, dot(vW, vT) * 0.6));
    B = vP2.w * (1.0 - smoothstep(vSW - 0.06, vSW + 0.01, dist + rag)) * (0.68 + 0.32 * streak);
  }
  // the snow pushed out: beside the groove or band, on one side or both; a big heap breaks into lumps
  float G = 0.0;
  if (vP2.x > 0.0) {
    float u = (dist - edge * 0.9) / vP2.y;
    float side = mix(1.0, smoothstep(-0.3 * edge - 0.02, 0.3 * edge + 0.02, a * vP2.z), abs(vP2.z));
    float lump = 0.45 + 1.1 * vnoise(vW * 13.0) * (0.6 + 0.4 * vnoise(vW * 4.0));
    G = vP2.x * side * smoothstep(0.0, 0.25, u) * (1.0 - smoothstep(0.3, 1.0, u)) * mix(1.0, lump, smoothstep(0.25, 0.75, vP2.x));
  }
  gl_FragColor = vec4(R, clamp(G, 0.0, 1.0), B, A);
}`;
// before a strong skid's own stamp: what it slides over is rubbed out (MIN blending; 1 leaves a channel alone)
const ERASE_FS = STAMP_COMMON + `
void main() {
  float er = vSW > 0.0 ? step(0.6, vP2.w) : 0.0;
  if (er < 0.5) discard;
  float dist = length(vec2(vL.x, max(0.0, max(-vL.y, vL.y - vL.z))));
  float inside = 1.0 - smoothstep(vSW - 0.05, vSW, dist);
  // (the grooves' field minus the band: the band's own outside, as a field; exact for distance fields)
  gl_FragColor = vec4(clamp(0.5 + uK * (dist - vSW + 0.02), 0.0, 1.0), 1.0 - inside * 0.85, 1.0, 1.0 - inside);
}`;
// the fine map's newly uncovered texels, from the coarse map (its edge field in the fine map's units)
const FILL_VS = `
attribute vec2 aW; varying vec2 vW;
void main() { vW = aW; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FILL_FS = `
uniform sampler2D tCoarse; uniform vec2 uO2; uniform vec2 uS2; uniform vec2 uKs; varying vec2 vW;
void main() {
  vec2 c = (vW - uO2) / uS2;
  if (c.x < 0.0 || c.y < 0.0 || c.x > 1.0 || c.y > 1.0) { gl_FragColor = vec4(0.0); return; }
  vec4 t = texture2D(tCoarse, c);
  gl_FragColor = vec4(clamp(0.5 + (t.r - 0.5) / uKs.y * uKs.x, 0.0, 1.0), t.gba);
}`;

// the park's extent (the coarse map covers it): its fences, starts, kickers and rails, or the old whole run
function parkBounds() {
  const P = getPark();
  const D = { x0: -80, x1: 80, z0: -100, z1: 1520 };
  if (!P || P.pipe || P.qp || !P.kickers || !P.kickers.length) return D;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const add = (x, z) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); };
  for (const f of P.fences || []) { add(f[0], f[1]); add(f[2], f[3]); }
  for (const s of P.starts || []) add(s.x, s.z);
  for (const k of P.kickers) { if (Number.isFinite(k.x0)) add(k.x0, k.z0); if (Number.isFinite(k.x1)) add(k.x1, k.zMeet || k.z0); }
  for (const r of P.rails || []) for (const p of r.pts || []) add(p[0], p[1]);
  if (!Number.isFinite(x0)) return D;
  return { x0: x0 - 10, x1: x1 + 10, z0: z0 - 40, z1: z1 + 90 };
}

// the numbers of one stamp (filled in before each call: nothing is made per stamp)
const SP = { hw: 0, dep: 0, sl: 1, inSide: 0, berm: 0, bw: 0.1, bSide: 0, scrape: 0, sw: 0 };
const setSP = (hw, dep, sl, inSide, berm, bw, bSide, scrape, sw) => { SP.hw = hw; SP.dep = dep; SP.sl = sl; SP.inSide = inSide; SP.berm = berm; SP.bw = bw; SP.bSide = bSide; SP.scrape = scrape; SP.sw = sw; return SP; };

export class Tracks {
  constructor(renderer, q) {
    this.r = renderer;
    const low = q.tier === 'low';
    // ---- the fine map: wraps round, 6.25 cm texels
    this.W = FINE.W; this.H = FINE.H; this.SX = FINE.SX; this.SZ = FINE.SZ; this.tx = FINE.SX / FINE.W;
    this.kF = 0.5 / (RAMP * this.tx);
    const opt = { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false };
    this.rt = new THREE.WebGLRenderTarget(this.W, this.H, Object.assign({ wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping }, opt));
    this.rt.texture.wrapS = this.rt.texture.wrapT = THREE.RepeatWrapping;
    // ---- the coarse map: the whole park, fixed (on the Jump Line about 9 x 18 cm texels, 18 x 36 on the low tier)
    const B = parkBounds();
    this.o2 = new THREE.Vector2(B.x0, B.z0); this.s2 = new THREE.Vector2(B.x1 - B.x0, B.z1 - B.z0);
    const CW = low ? 512 : 1024, CH = low ? 2048 : 4096;
    this.t2 = new THREE.Vector2(this.s2.x / CW, this.s2.y / CH);
    this.kC = 0.5 / (RAMP * Math.max(this.t2.x, this.t2.y));
    this.rt2 = new THREE.WebGLRenderTarget(CW, CH, opt);
    // the park's sides: the fine map's middle stays over the park where it can (so all of its lanes stay fine)
    this.bx = B.x1 - B.x0 > this.SX ? [B.x0 + this.SX / 2, B.x1 - this.SX / 2] : [(B.x0 + B.x1) / 2, (B.x0 + B.x1) / 2];
    if (B.x0 === -80 && B.x1 === 80) this.bx = null;          // (no park to keep to: the old whole run)
    this.r = renderer; this.clearMaps();
    this.ox = 0; this.oz = 0; this.placed = false;
    const U = snowUniforms;
    U.uTrack.value = this.rt.texture; U.uTrackWin.value.set(-1e5, -1e5, this.SX, this.SZ);
    U.uTrack2.value = this.rt2.texture; U.uTrack2Origin.value.copy(this.o2); U.uTrack2Size.value.copy(this.s2); U.uTrack2Texel.value.set(1 / CW, 1 / CH);
    U.uTrackK.value.set(this.kF, this.kC, 1 / this.SX, 1 / this.SZ); U.uTrackBase.value.set(FINE.bx, FINE.bz, this.tx, 0);
    // ---- the stamps: up to N quads (four frames' worth: the coarse map takes them every fourth frame), MAX blending
    this.N = 128;
    const g = new THREE.BufferGeometry(), V = this.N * 4;
    this.aPos = new Float32Array(V * 3); this.aAB = new Float32Array(V * 4); this.aP1 = new Float32Array(V * 4); this.aP2 = new Float32Array(V * 4); this.aTile = new Float32Array(V * 2);
    const idx = new Uint16Array(this.N * 6);
    for (let i = 0; i < this.N; i++) {
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
      const C = [-1, 0, 1, 0, -1, 1, 1, 1];
      for (let k = 0; k < 4; k++) { this.aPos[(i * 4 + k) * 3] = C[k * 2]; this.aPos[(i * 4 + k) * 3 + 1] = C[k * 2 + 1]; }
    }
    const att = (name, arr, n) => { const a = new THREE.BufferAttribute(arr, n); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a; };
    this.atts = [att('position', this.aPos, 3), att('aAB', this.aAB, 4), att('aP1', this.aP1, 4), att('aP2', this.aP2, 4), att('aTile', this.aTile, 2)];
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo = g;
    this.mU = { uMap: { value: new THREE.Vector4() }, uTexel: { value: new THREE.Vector2() }, uK: { value: 1 }, uUseTile: { value: 1 } };
    const stampMat = new THREE.ShaderMaterial({ uniforms: this.mU, vertexShader: STAMP_VS, fragmentShader: STAMP_FS, depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor });
    const eraseMat = new THREE.ShaderMaterial({ uniforms: this.mU, vertexShader: STAMP_VS, fragmentShader: ERASE_FS, depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendEquation: THREE.MinEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor });
    // (one scene, so a frame's work on a map is one draw call each and one render: the fill first, then the rub-out,
    // then the stamps; what a frame does not need is hidden)
    const mesh = (geo, m, order) => { const o = new THREE.Mesh(geo, m); o.frustumCulled = false; o.renderOrder = order; o.matrixAutoUpdate = false; return o; };
    this.eraseMesh = mesh(g, eraseMat, 1); this.stampMesh = mesh(g, stampMat, 2);
    this.scene = new THREE.Scene(); this.scene.matrixWorldAutoUpdate = false;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
    // ---- filling what the fine map uncovers: up to 8 quads in the map's own texture space, each carrying its world place
    const fg = new THREE.BufferGeometry();
    this.fPos = new Float32Array(32 * 3); this.fW = new Float32Array(32 * 2);
    const fidx = new Uint16Array(8 * 6); for (let i = 0; i < 8; i++) fidx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
    this.fAtt = [new THREE.BufferAttribute(this.fPos, 3), new THREE.BufferAttribute(this.fW, 2)];
    for (const a of this.fAtt) a.setUsage(THREE.DynamicDrawUsage);
    fg.setAttribute('position', this.fAtt[0]); fg.setAttribute('aW', this.fAtt[1]); fg.setIndex(new THREE.BufferAttribute(fidx, 1));
    this.fGeo = fg;
    const fillMat = new THREE.ShaderMaterial({ uniforms: { tCoarse: { value: this.rt2.texture }, uO2: { value: this.o2 }, uS2: { value: this.s2 }, uKs: { value: new THREE.Vector2(this.kF, this.kC) } },
      vertexShader: FILL_VS, fragmentShader: FILL_FS, depthTest: false, depthWrite: false });
    this.fillMesh = mesh(fg, fillMat, 0);
    this.scene.add(this.fillMesh, this.eraseMesh, this.stampMesh);
    this.nf = 0;
    // every program these draw with is built now, with a map bound as when they draw (not in the first frame that
    // leaves a track)
    renderer.setRenderTarget(this.rt2); renderer.compile(this.scene, this.cam); renderer.setRenderTarget(null);
    this.n = 0; this.nF = 0; this.frame = 0; this.erF = false; this.erC = false;
    this.last = []; this.has = [];         // per track point: the last stamped place
    for (let i = 0; i < 10; i++) { this.last.push(new THREE.Vector2()); this.has.push(false); }
    this._f = new THREE.Vector3(); this._l = new THREE.Vector3();
    this._landSeen = null; this.skidK = 0; this.tv = new THREE.Vector2(0, 1);
  }

  // every track gone (both maps), for a fresh run of tests or a new map
  clear() {
    this.clearMaps();
    this.n = 0; this.nF = 0; this.nf = 0; for (let i = 0; i < this.has.length; i++) this.has[i] = false;
  }

  clearMaps() {
    const r = this.r, cc = r.getClearColor(new THREE.Color()), ca = r.getClearAlpha();     // (the renderer's own, put back)
    for (const t of [this.rt, this.rt2]) { r.setRenderTarget(t); r.setClearColor(0x000000, 0); r.clear(); }
    r.setRenderTarget(null); r.setClearColor(cc, ca);
  }

  // ---- the fine map follows the rider -------------------------------------------------------------------------------
  // its window: x on the rider (kept over the park), z with most of it behind (the rider goes down +z); it moves in half
  // metre steps, snapped to its texels, and only the strips it uncovers are filled (from the coarse map)
  follow(p) {
    const SX = this.SX, SZ = this.SZ, tx = this.tx;
    let cx = this.bx ? Math.min(this.bx[1], Math.max(this.bx[0], p.x)) : p.x;
    cx = Math.min(p.x + SX / 2 - 10, Math.max(p.x - SX / 2 + 10, cx));     // (and the rider always 10 m inside it)
    const nx = Math.round((cx - SX / 2) / tx) * tx, nz = Math.round((p.z - SZ * FINE.back) / tx) * tx;
    if (!this.placed) { this.placed = true; this.ox = nx; this.oz = nz; snowUniforms.uTrackWin.value.set(nx, nz, SX, SZ); return; }
    const dx = nx - this.ox, dz = nz - this.oz;
    if (Math.abs(dx) < FINE.step && Math.abs(dz) < FINE.step) return;
    if (this.nf) this.flush(false, true);           // (a fill still waiting: in before the window moves again)
    this.nf = 0;
    if (Math.abs(dx) >= SX || Math.abs(dz) >= SZ) this.fillRect(nx, nz, nx + SX, nz + SZ);
    else {
      if (dx > 0) this.fillRect(this.ox + SX, nz, nx + SX, nz + SZ); else if (dx < 0) this.fillRect(nx, nz, this.ox, nz + SZ);
      if (dz > 0) this.fillRect(nx, this.oz + SZ, nx + SX, nz + SZ); else if (dz < 0) this.fillRect(nx, nz, nx + SX, this.oz);
    }
    if (this.nf) { for (const a of this.fAtt) a.needsUpdate = true; this.fGeo.setDrawRange(0, this.nf * 6); }   // (drawn by flush)
    this.ox = nx; this.oz = nz;
    snowUniforms.uTrackWin.value.set(nx, nz, SX, SZ);
  }
  // a world rectangle into fill quads, cut where the map wraps
  fillRect(x0, z0, x1, z1) {
    const SX = this.SX, SZ = this.SZ, X0 = FINE.bx, Z0 = FINE.bz;
    const u0 = (x0 - X0) / SX, u1 = (x1 - X0) / SX, v0 = (z0 - Z0) / SZ, v1 = (z1 - Z0) / SZ;
    for (let i = Math.floor(u0); i < u1; i++) for (let j = Math.floor(v0); j < v1; j++) {
      if (this.nf >= 8) return;
      const a = Math.max(u0, i) - i, b = Math.min(u1, i + 1) - i, c = Math.max(v0, j) - j, d = Math.min(v1, j + 1) - j;
      if (b - a < 1e-6 || d - c < 1e-6) continue;
      const k = this.nf * 4;
      for (let m = 0; m < 4; m++) {
        const X = m & 1 ? b : a, Y = m & 2 ? d : c;      // (corners: a c, b c, a d, b d)
        this.fPos[(k + m) * 3] = X * 2 - 1; this.fPos[(k + m) * 3 + 1] = Y * 2 - 1;
        this.fW[(k + m) * 2] = X0 + (X + i) * SX; this.fW[(k + m) * 2 + 1] = Z0 + (Y + j) * SZ;
      }
      this.nf++;
    }
  }

  // ---- stamps ---------------------------------------------------------------------------------------------------------
  // the segment a..b (world x, z) with the numbers in P (SP); a copy for each tile of the fine map it reaches
  stamp(ax, az, bx, bz, P) {
    const ramp = 0.5 / this.kF / Math.max(P.sl, 0.25);
    const ext = Math.max(P.hw + ramp, Math.max(P.hw, P.sw) + Math.max(P.bw, 0.05)) + 0.1;
    const SX = this.SX, SZ = this.SZ, X0 = FINE.bx, Z0 = FINE.bz;
    const i0 = Math.floor((Math.min(ax, bx) - ext - X0) / SX), i1 = Math.floor((Math.max(ax, bx) + ext - X0) / SX);
    const j0 = Math.floor((Math.min(az, bz) - ext - Z0) / SZ), j1 = Math.floor((Math.max(az, bz) + ext - Z0) / SZ);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      if (this.n >= this.N) this.flush(true);
      const q = this.n++;
      for (let k = 0; k < 4; k++) {
        const v = q * 4 + k, o4 = v * 4;
        this.aPos[v * 3 + 2] = P.sw;
        this.aAB[o4] = ax; this.aAB[o4 + 1] = az; this.aAB[o4 + 2] = bx; this.aAB[o4 + 3] = bz;
        this.aP1[o4] = P.hw; this.aP1[o4 + 1] = Math.min(1, P.dep); this.aP1[o4 + 2] = P.sl; this.aP1[o4 + 3] = P.inSide;
        this.aP2[o4] = Math.min(1, P.berm); this.aP2[o4 + 1] = P.bw; this.aP2[o4 + 2] = P.bSide; this.aP2[o4 + 3] = Math.min(1, P.scrape);
        this.aTile[v * 2] = X0 + i * SX; this.aTile[v * 2 + 1] = Z0 + j * SZ;
      }
    }
    if (P.sw > 0 && P.scrape >= 0.6) { this.erF = true; this.erC = true; }
  }

  // every ski on the snow (or the board, or a ride's own track points) leaves its track
  fromSkier(sk, rig) {
    if (!rig.ready) return;
    const T = snowKind().track, K = sk.K || {};
    const one = K.tracks === 1 || rig.skiL === rig.skiR;
    const list = rig.tracks || null, nT = Math.min(8, list ? list.length : one ? 1 : 2);
    // (towed up a T-bar, tbar.js, the skis run on the snow of its track too; not on a chairlift)
    const towed = sk.state === 'lift' && sk.liftKind === 'tbar';
    const onSnow = sk.state === 'ground' || towed || (sk.state === 'crash' && sk.p.y < height(sk.p.x, sk.p.z) + 0.3);
    const crash = sk.state === 'crash';
    const turn = sk.turnRate || 0, edge = Math.min(1, Math.abs(sk.edge || 0)), sink = sk.sink || 0;
    const speed = Math.hypot(sk.v.x, sk.v.z), brake = sk.brake || 0;
    const lenS = one ? 1.5 : list ? 0.8 : 1.7;                 // how long a ski (board, runner) is along the snow
    const powder = surface(sk.p.x, sk.p.z) === 1 || snowKind() === SNOW_POWDER;
    const landed = sk.lastLanding && sk.lastLanding !== this._landSeen && sk.state === 'ground';
    if (sk.lastLanding !== this._landSeen) this._landSeen = sk.lastLanding;
    // the inside of the turn: + the rider's left (+x facing down the hill; turnRate > 0 turns right, towards -x)
    const inTurn = Math.abs(turn) > 0.08 ? -Math.sign(turn) : 0;
    let skidMax = 0;
    for (let i = 0; i < nT; i++) {
      const ski = list ? list[i] : i ? rig.skiR : rig.skiL;
      if (!ski) continue;
      const c = ski.position, L = this.last[i];
      if (!onSnow || crash) { this.has[i] = false; continue; }
      const halfW = list ? (ski.userData.hw || 0.05) : (K.trackW || (one ? 0.27 : 0.1)) / 2;
      const fwd = this._f.set(0, 0, 1).applyQuaternion(ski.quaternion); fwd.y = 0;
      const fl = Math.hypot(fwd.x, fwd.z) || 1; fwd.x /= fl; fwd.z /= fl;
      if (landed) {
        // a landing: the whole ski slapped flat on the snow (its own imprint), and round it a short patch pressed smooth
        // by the impact, the snow squeezed out at its sides
        const vn = Math.abs(sk.lastLanding.vn || 3), h = lenS * 0.45;
        const dep = Math.min(0.9, 0.35 + vn * 0.06) * T.depth;
        this.stamp(c.x - fwd.x * h, c.z - fwd.z * h, c.x + fwd.x * h, c.z + fwd.z * h,
          setSP(halfW * 1.25 * Math.min(1.5, T.width), powder ? Math.max(dep, 0.8) : dep, 0.8, 0, (0.3 + Math.min(0.4, vn * 0.04)) * T.berm, 0.08 + halfW, 0,
            powder ? 0.2 : 0.75, halfW + 0.1 + Math.min(0.14, vn * 0.02)));
      }
      if (!this.has[i]) { L.set(c.x, c.z); this.has[i] = true; continue; }
      const tx = c.x - L.x, tz = c.z - L.y, tl = Math.hypot(tx, tz);
      if (tl < 0.05) continue;
      if (tl > 4) { L.set(c.x, c.z); continue; }
      // how far the ski is turned across its way (sin of the slip; + it points left of the way)
      const cr = (fwd.x * tz - fwd.z * tx) / tl, across = Math.abs(cr);
      const ks = sstep(0.12, 0.42, across);                     // 0 carving or running straight .. 1 skidding
      skidMax = Math.max(skidMax, ks);
      let hw = halfW * Math.min(1.7, T.width), dep, sl, inSide, berm, bw, bSide, scrape, sw = 0;
      // the carve: as wide as the ski; set on edge, a crisp deep inside wall and a soft outside one with a little lip
      // beyond it; flat, a shallow even imprint
      const ek = sstep(0.1, 0.6, edge) * (inTurn ? 1 : 0);
      dep = ((0.3 + 0.7 * edge) * T.depth + sink * 3) * (1 - ks);
      sl = 1 - 0.65 * ek * Math.min(1, T.sharp); inSide = inTurn * ek;
      berm = (0.15 + 0.4 * ek) * T.berm; bw = 0.03 + hw * 0.9; bSide = -inTurn * ek;
      scrape = 0.15;
      if (ks > 0) {
        // the skid: the base sweeps a band as wide as the ski is turned across, scraping it smooth, and pushes the snow
        // it takes off to the outside of the turn (braking straight, ahead of the skis: the heap left where they stop)
        sw = halfW + across * lenS * 0.46;
        scrape = Math.max(scrape, ks * (0.55 + 0.45 * Math.max(brake, ks)));
        berm = Math.max(berm, ks * (0.45 + 0.35 * brake) * T.berm);
        bw = Math.max(bw, 0.08 + sw * 0.35);
        bSide = -inTurn;
        hw *= 1 - ks;
      }
      if (powder) {
        // powder: the skis sink in a deep trench with soft crumbling walls and lumps heaped both sides; a skid shoves a
        // wide trough rather than polishing anything
        if (ks > 0.3) { hw = Math.max(hw, sw); sw = 0; }
        dep = Math.max(dep, 0.75 + sink * 2); sl = Math.min(sl, 0.6); berm = Math.max(berm, 0.75) * Math.min(1.2, T.berm); bw = Math.max(bw, 0.06 + hw * 1.4);
        bSide *= 0.5; scrape *= 0.25;
      }
      if (hw < 0.003) hw = 0;
      this.stamp(L.x, L.y, c.x, c.z, setSP(hw, Math.max(0.05, dep), sl, inSide, berm, bw, bSide, scrape, sw));
      if (i === 0) this.tv.set(tx / tl, tz / tl);
      L.set(c.x, c.z);
    }
    // a skidded stop leaves a heap in front of the skis
    if (sk.state === 'ground' && this.skidK > 0.5 && speed < 1.2 && nT) {
      const ski = list ? list[0] : rig.skiL, c = ski.position, fwd = this._f.set(0, 0, 1).applyQuaternion(ski.quaternion);
      const h = lenS * 0.45, ox = this.tv.x * 0.14, oz = this.tv.y * 0.14;
      const side = Math.sign(fwd.z * this.tv.x - fwd.x * this.tv.y) || 1;        // the side of the ski the snow went
      this.stamp(c.x - fwd.x * h + ox, c.z - fwd.z * h + oz, c.x + fwd.x * h + ox, c.z + fwd.z * h + oz,
        setSP(0, 0, 1, 0, (powder ? 1 : 0.85) * Math.min(1.2, T.berm), 0.22, side, 0, 0));
      this.skidK = 0;
    } else if (sk.state === 'ground') this.skidK = speed > 2 ? Math.max(this.skidK * 0.98, skidMax * (brake > 0.2 || skidMax > 0.6 ? 1 : 0)) : this.skidK;
    else this.skidK = 0;
    // a fall: the body's hollow, dragged along the snow, with lumps thrown out round it
    const CI = 9, CL = this.last[CI];
    if (crash && onSnow) {
      if (this.has[CI]) {
        const d = Math.hypot(sk.p.x - CL.x, sk.p.z - CL.y);
        if (d > 0.08 && d < 5) { this.stamp(CL.x, CL.y, sk.p.x, sk.p.z, setSP(0.3, 0.85 * Math.max(0.6, T.depth), 0.2, 0, 0.8 * Math.min(1.3, T.berm), 0.25, 0, 0.35, 0.38)); CL.set(sk.p.x, sk.p.z); }
      } else { CL.set(sk.p.x, sk.p.z); this.has[CI] = true; }
    } else this.has[CI] = false;
  }

  // into the maps: the fine map every second frame (what the window uncovered, then the stamps; the newest piece of
  // track is under the ski anyway), the coarse map every fourth (or when the stamps fill up); fillOnly: just a waiting
  // fill. (Each is one render of three tiny draws: on a Chromebook a render's own cost is most of it.)
  flush(force = false, fillOnly = false) {
    if (!fillOnly) { this.frame++; if (!force && (this.frame & 1)) return; }
    const r = this.r, newSt = !fillOnly && this.n > this.nF;
    if (newSt || this.nf) {
      if (newSt) for (const a of this.atts) { a.clearUpdateRanges(); a.addUpdateRange(this.nF * 4 * a.itemSize, (this.n - this.nF) * 4 * a.itemSize); a.needsUpdate = true; }
      const ac = r.autoClear; r.autoClear = false;
      this.geo.setDrawRange(this.nF * 6, (this.n - this.nF) * 6);
      this.mU.uMap.value.set(0, 0, this.SX, this.SZ); this.mU.uTexel.value.set(this.tx, this.tx); this.mU.uK.value = this.kF; this.mU.uUseTile.value = 1;
      this.fillMesh.visible = this.nf > 0; this.eraseMesh.visible = newSt && this.erF; this.stampMesh.visible = newSt;
      r.setRenderTarget(this.rt); r.render(this.scene, this.cam); r.setRenderTarget(null);
      r.autoClear = ac;
      this.nf = 0;
      if (newSt) { this.nF = this.n; this.erF = false; }
    }
    if (!fillOnly && this.n && (force || this.frame % 4 === 0 || this.n > this.N - 32)) {
      const ac = r.autoClear; r.autoClear = false;
      this.geo.setDrawRange(0, this.n * 6);
      this.mU.uMap.value.set(this.o2.x, this.o2.y, this.s2.x, this.s2.y); this.mU.uTexel.value.copy(this.t2); this.mU.uK.value = this.kC; this.mU.uUseTile.value = 0;
      this.fillMesh.visible = false; this.eraseMesh.visible = this.erC; this.stampMesh.visible = true;
      r.setRenderTarget(this.rt2); r.render(this.scene, this.cam); r.setRenderTarget(null);
      r.autoClear = ac;
      this.n = 0; this.nF = 0; this.erC = false;
    }
  }
}

// ---- spray -------------------------------------------------------------------------------------------------------------
/* (2026-11-06, for "it is too laggy especially powder snow": in powder the grains were thrown back at about half the
   rider's speed, so they flew back through the chase camera, and a grain was drawn as big as 300 / its distance, up to
   1024 pixels across a moment before it passed the lens. Riding powder on the low tier the grains covered the screen
   1.8 times over on an average frame (up to 5 times), every pixel blended, and a grain at the lens was a white disc over
   most of the picture for a frame: a blink. Now a grain fades out over the last couple of metres to the camera and is
   never drawn bigger than a tenth of the picture's height (one that has faded out is not drawn at all), its size follows
   the picture's own size and the lens, and powder throws soft puffs of snow dust that hang in the air and spread,
   brighter with the sun behind them, instead of hard white discs.) */
const SPRAY_VS = `
attribute vec4 aLife;   // age, life, size (m), and the kind (whole part: 0 a grain, 1 a powder puff) + a random fraction
varying float vA; varying float vS; varying float vK;
uniform float uScale; uniform float uMaxPx;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float t = aLife.x / max(aLife.y, 0.001), kind = floor(aLife.w), d = -mv.z;
  // a puff spreads as it hangs; a grain grows a little as it breaks up
  float grow = kind > 0.5 ? 0.7 + t * 2.3 : 0.6 + t * 1.4;
  float a = (1.0 - t) * smoothstep(0.0, 0.08, t) * step(aLife.x, aLife.y) * smoothstep(0.7, 2.4, d);
  float px = min(aLife.z * grow * uScale / max(d, 0.3), uMaxPx);
  vA = a; vS = fract(aLife.w); vK = kind;
  // (gone, faded out at the lens or too small to see: nothing to draw, so not a fragment of it)
  if (a < 0.012 || px < 0.6) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  gl_PointSize = px;
  gl_Position = projectionMatrix * mv;
}`;
const SPRAY_FS = `
varying float vA; varying float vS; varying float vK;
uniform vec3 uSunV; uniform float uTime; uniform vec3 uSnowLit;
void main() {
  vec2 c = (gl_PointCoord - 0.5) * vec2(2.0, -2.0); float r2 = dot(c, c);    // 0 in the middle, 1 at the rim
  if (r2 > 1.0) discard;
  // a puff: snow dust, densest in the middle and thinning out with no edge; a grain: a small chip, a softer rim
  float a = vK > 0.5 ? exp(-r2 * 3.0) * (1.0 - r2) * 0.42 : smoothstep(1.0, 0.3, r2) * 0.78;
  a *= vA;
  if (a < 0.008) discard;
  // as bright as lit snow on the screen (env.js works that out), a touch brighter so it shows against the snow, and
  // brighter again with the sun ahead: fine snow in the air lets the light through (a grain glints now and then)
  float lit = 1.04 + 0.3 * pow(max(0.0, -uSunV.z), 3.0) * (1.0 - r2);
  float glint = vK > 0.5 ? 0.0 : step(0.93, fract(vS * 13.7 + uTime * 3.1)) * step(r2, 0.16);
  gl_FragColor = vec4(vec3(0.95, 0.97, 1.0) * uSnowLit * lit * (1.0 + glint * 0.6), a);
}`;
const _fw = new THREE.Vector3(), _sd = new THREE.Vector3(), _sp = new THREE.Vector3(), _db = new THREE.Vector2();
export class Spray {
  constructor(scene, q) {
    this.N = q.tier === 'low' ? 260 : q.tier === 'medium' ? 600 : 1000;
    const g = new THREE.BufferGeometry();
    this.p = new Float32Array(this.N * 3); this.v = new Float32Array(this.N * 3); this.life = new Float32Array(this.N * 4);
    for (let i = 0; i < this.N; i++) this.life[i * 4] = 99;
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3)); g.setAttribute('aLife', new THREE.BufferAttribute(this.life, 4));
    for (const k of ['position', 'aLife']) g.attributes[k].setUsage(THREE.DynamicDrawUsage);
    this.mat = new THREE.ShaderMaterial({ uniforms: { uScale: { value: 300 }, uMaxPx: { value: 60 }, uSunV: { value: new THREE.Vector3(0, 0, 1) }, uTime: { value: 0 }, uSnowLit: snowUniforms.uSnowLit },
      vertexShader: SPRAY_VS, fragmentShader: SPRAY_FS, transparent: true, depthWrite: false });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 5;
    this.points.matrixAutoUpdate = false;
    // the size on the screen from the picture's height and the lens (0.68 of a grain's size in metres at its distance:
    // what the old fixed 300 gave on the low tier's usual 614 pixel high picture), and the light's way in the camera's view
    const U = this.mat.uniforms;
    this.points.onBeforeRender = (r, sc, cam) => {
      const h = r.getDrawingBufferSize(_db).y;
      U.uScale.value = 0.342 * h * cam.projectionMatrix.elements[5];
      U.uMaxPx.value = Math.max(24, h * 0.1);
      U.uSunV.value.copy(snowUniforms.uSunDir.value).transformDirection(cam.matrixWorldInverse);
    };
    scene.add(this.points);
    this.k = 0; this.acc = 0; this.live = 0;
  }
  // kind: 0 a grain, 1 a powder puff
  emit(x, y, z, vx, vy, vz, size, life, kind = 0) {
    const i = this.k; this.k = (this.k + 1) % this.N;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.life[i * 4] = 0; this.life[i * 4 + 1] = life; this.life[i * 4 + 2] = size; this.life[i * 4 + 3] = kind + Math.random() * 0.999;
    this.live = 2;
  }
  fromSkier(sk, rig, dt) {
    if (!rig.ready) return;
    const sp = sk.v.length();
    let rate = 0;
    // (the snow kind: powder sprays big and soft everywhere, spring slush throws heavier wet clumps, ice only fine chips)
    const kind = snowKind(), powder = sk.surf === 1 || kind === SNOW_POWDER, wet = kind === SNOW_SPRING, ice = kind === SNOW_ICE;
    if (sk.state === 'ground') {
      rate = sk.slide * 40 + (Math.abs(sk.edge) > 0.45 && sp > 8 ? sp * 3 : 0) + (powder && sp > 3 ? sp * 9 : 0);
      if (sk.brake > 0.3) rate += sp * 30;
      rate *= ice ? 0.45 : wet ? 0.8 : 1;
    }
    if (sk.state === 'crash' && sp > 1) rate = sp * 25;
    this.acc += rate * dt;
    while (this.acc > 1) {
      this.acc--;
      const ski = Math.random() < 0.5 ? rig.skiL : rig.skiR;
      if (!ski) { this.acc = 0; break; }
      const t = (Math.random() - 0.3) * 0.8;
      // (scratch vectors: nothing is made per grain)
      const fwd = _fw.set(0, 0, 1).applyQuaternion(ski.quaternion);
      const side = _sd.set(1, 0, 0).applyQuaternion(ski.quaternion);
      // thrown off the outside of the turn (the side the skis slide towards)
      const out = Math.sign(side.dot(sk.v)) || 1;
      const p = _sp.copy(ski.position).addScaledVector(fwd, t).addScaledVector(side, out * 0.06);
      const k = 0.35 + Math.random() * 0.5;
      // (in powder most of it is dust: puffs that hang in the air behind; the rest grains)
      const puff = powder && Math.random() < 0.7;
      this.emit(p.x, p.y + 0.03, p.z,
        sk.v.x * k + side.x * out * (1 + Math.random() * 2.5) + (Math.random() - 0.5),
        1.2 + Math.random() * (powder ? 3.2 : 2.0),
        sk.v.z * k + side.z * out * (1 + Math.random() * 2.5) + (Math.random() - 0.5),
        powder ? (puff ? 0.42 + Math.random() * 0.42 : 0.12 + Math.random() * 0.14) : wet ? 0.18 + Math.random() * 0.2 : ice ? 0.06 + Math.random() * 0.08 : 0.12 + Math.random() * 0.16,
        wet ? 0.35 + Math.random() * 0.35 : puff ? 0.7 + Math.random() * 1.0 : 0.5 + Math.random() * (powder ? 0.8 : 0.6), puff ? 1 : 0);
    }
  }
  // the "schat": the snow packed on the bases flicking off as the skis meet a rail or swap on it, a short fan of fine
  // grains thrown out to both sides of the rail and up, a little along the way you go (dir)
  flick(at, dir, power = 1) {
    if (!at) return;
    const dx = dir ? dir.x : 0, dz = dir ? dir.z : 1, n = Math.round(8 + power * 16);
    for (let i = 0; i < n; i++) {
      const sgn = i & 1 ? 1 : -1, s = (1.2 + Math.random() * 2.4) * power, up = 0.6 + Math.random() * 1.8 * power, al = (Math.random() - 0.3) * 1.5;
      this.emit(at.x + (Math.random() - 0.5) * 0.3, at.y + 0.02, at.z + (Math.random() - 0.5) * 0.3,
        -dz * sgn * s + dx * al, up, dx * sgn * s + dz * al, 0.06 + Math.random() * 0.1, 0.25 + Math.random() * 0.35);
    }
  }
  burst(p, n, power) {
    const powder = snowKind() === SNOW_POWDER;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = power * (0.4 + Math.random()), puff = powder && (i & 1) === 1;
      this.emit(p.x, p.y + 0.05, p.z, Math.cos(a) * s, 0.8 + Math.random() * power * 0.9, Math.sin(a) * s,
        puff ? 0.35 + Math.random() * 0.35 : 0.25 + Math.random() * 0.35, puff ? 0.9 + Math.random() * 0.9 : 0.7 + Math.random() * 0.9, puff ? 1 : 0);
    }
  }
  update(dt, time) {
    // (nothing in the air, now or last frame: nothing to move, send or draw)
    if (!this.live) { this.points.visible = false; return; }
    let alive = 0;
    const L = this.life, V = this.v, P = this.p;
    for (let i = 0; i < this.N; i++) {
      const l = L[i * 4]; if (l > L[i * 4 + 1]) continue;
      L[i * 4] = l + dt; alive++;
      const o = i * 3;
      // (a puff of dust is light: the air slows it sooner and it falls slower, so it hangs behind the rider)
      const puff = L[i * 4 + 3] >= 1;
      V[o + 1] -= 9.81 * dt * (puff ? 0.3 : 0.55);
      const d = Math.max(0, 1 - dt * (puff ? 3.4 : 2.2)); V[o] *= d; V[o + 1] *= d; V[o + 2] *= d;
      P[o] += V[o] * dt; P[o + 1] += V[o + 1] * dt; P[o + 2] += V[o + 2] * dt;
    }
    // (one more frame sent after the last grain goes, so the buffer holds it gone)
    this.live = alive ? 2 : this.live - 1;
    this.points.visible = true;
    this.points.geometry.attributes.position.needsUpdate = true; this.points.geometry.attributes.aLife.needsUpdate = true;
    this.mat.uniforms.uTime.value = time;
  }
}
