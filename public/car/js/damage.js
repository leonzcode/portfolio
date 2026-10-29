// Crash damage for every car (the player's and the traffic's), derived from each model's own geometry.
//
// Metal: an impact is a rigid impactor (a wall, a pole, another car's front or side, the ground in a roll) that
// moves into the body by a crush depth worked out from the closing speed (about 3.5 cm per m/s over the elastic
// limit, as a real car's frontal crush goes, deeper for poles and sides). The body collapses progressively from
// the contact along the push: the soft crumple zones front and rear go first, the stiff cabin, sills and pillars
// last, and material already crushed gets stiffer. On top of that the compressed sheet folds in creases across the
// push, a bonnet or boot lid buckles up into a peak, and dents have the straight walls and crease lines of sheet
// metal rather than a round falloff. The same displacement field moves every mesh near the hit (paint, body,
// glass, lamps, chrome, interior), so nothing pokes through; meshes are subdivided where they bend, and normals are
// rebuilt only there. Paint cracks off along the creases (a strain value per vertex in the paint shader).
//
// Paint: a damage atlas per car (a render target drawn on the GPU), projected in the car's frame onto its sides,
// top, front and back: long scratches along the line of travel at the contact height when a side drags along a
// wall, kerb, car or pole, bare metal and primer showing through, scuffed clear coat.
//
// Parts: bumpers crack, hang by one corner, drag on the road and fall off; mirrors snap off; lamps break into red,
// amber and clear shards and stop lighting; doors can be forced open (and rig.doorNode(i) gives the hinge pivot of
// any door, for the people's getting in and out); wheels bend (camber and toe, the car pulls) or break off.
// Glass: windows are found as connected pieces of the glass meshes; the windscreen (laminated) cracks in a spider
// web and stays in place, side and rear windows (tempered) shatter into cubes that fall and glitter on the road and
// the seats. Smoke and steam from a broken engine. Body corners touch the ground, so a car on its roof slides on it.
//
// Events on drive.events: impact, glass, door (see the shared spec).
import * as THREE from 'three';
import { FX } from './damagefx.js?v=44';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3(), _p = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _n3 = new THREE.Matrix3(), _box = new THREE.Box3();
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = THREE.MathUtils.clamp;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// crush per m/s of closing speed over the elastic limit, for a full-width hit on a rigid wall (k = 800 N/m per kg)
const K_CRUSH = 1 / Math.sqrt(800);
const V_ELASTIC = 1.3;
const ANALYSIS = new Map(); // model (and version) -> what the geometry says: windows, lamps, mirrors, bumpers, doors

// ---------------------------------------------------------------------------------------------------------
// noise (value noise, deterministic in the car's frame, so every mesh at a point gets the same wrinkle)

const PERM = new Uint8Array(512);
{ let s = 1234567; for (let i = 0; i < 256; i++) PERM[i] = i; for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); const t = PERM[i]; PERM[i] = PERM[j]; PERM[j] = t; } for (let i = 0; i < 256; i++) PERM[256 + i] = PERM[i]; }
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), fx = x - xi, fy = y - yi, fz = z - zi;
  const X = xi & 255, Y = yi & 255, Z = zi & 255;
  const h = (a, b, c) => PERM[PERM[PERM[a] + b] + c] / 255;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(h(X, Y, Z), h(X + 1, Y, Z), sx), l(h(X, Y + 1, Z), h(X + 1, Y + 1, Z), sx), sy),
    l(l(h(X, Y, Z + 1), h(X + 1, Y, Z + 1), sx), l(h(X, Y + 1, Z + 1), h(X + 1, Y + 1, Z + 1), sx), sy), sz) * 2 - 1;
}
const fbm = (x, y, z) => vnoise(x, y, z) * 0.6 + vnoise(x * 2.1 + 7, y * 2.1, z * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3 + 3, z * 4.3) * 0.1;
// a fold: sharp crests and troughs (sheet metal creases), -1..1
const tri = x => { const f = x - Math.floor(x); return 1 - 4 * Math.abs(f - 0.5); };
// a smooth wave shaped like sin(x), cheap (no range reduction)
const wave = x => { const q = x * 0.15915494, f = q - Math.floor(q); const s = 1 - 4 * Math.abs(f - 0.5); return s * (1.5 - 0.5 * s * s); };

// ---------------------------------------------------------------------------------------------------------
// shader patches: the paint reads the damage atlas and its crease strain, the glass a crack map. The patch goes on
// every car's paint and glass as the rig is made (so the shaders are built with the rest during loading) with the
// damage switched off by a uniform; a damaged traffic car gets its own copies of the materials, which reuse the
// same compiled program.

let BLANK = null;
function blank() {
  if (!BLANK) { BLANK = new THREE.DataTexture(new Uint8Array(4), 1, 1); BLANK.needsUpdate = true; }
  return BLANK;
}
const UNIFORMS = new WeakMap(); // material -> its damage uniforms

const PAINT_VS_DECL = `
attribute vec3 _dp;
attribute vec3 _dn;
attribute float _ds;
varying vec3 vDp;
varying vec3 vDn;
varying float vDs;`;
const PAINT_VS_MAIN = `
  vDp = _dp; vDn = _dn; vDs = _ds;`;
const PAINT_FS_DECL = `
uniform sampler2D uDmgMap;
uniform float uDmgOn;
uniform vec4 uDmgA;   // car box min (xyz)
uniform vec2 uDmgS;   // atlas uv per metre (x, y)
uniform vec4 uDmgO1;  // region origins: left, right
uniform vec4 uDmgO2;  // top, front
uniform vec2 uDmgO3;  // rear
varying vec3 vDp;
varying vec3 vDn;
varying float vDs;
float dmgHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float dmgNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dmgHash(i), dmgHash(i + vec3(1, 0, 0)), f.x), mix(dmgHash(i + vec3(0, 1, 0)), dmgHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(dmgHash(i + vec3(0, 0, 1)), dmgHash(i + vec3(1, 0, 1)), f.x), mix(dmgHash(i + vec3(0, 1, 1)), dmgHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;
const PAINT_FS_MAIN = `
  float dmgCoat = 0.0;
  if (uDmgOn > 0.5) {
    vec3 q = vDp - uDmgA.xyz;
    vec3 an = abs(vDn); vec3 wt = an * an; wt *= wt; wt /= (wt.x + wt.y + wt.z + 1e-5);
    vec2 uvX = (vDn.x < 0.0 ? uDmgO1.xy : uDmgO1.zw) + vec2(q.z, q.y) * uDmgS;
    vec2 uvY = uDmgO2.xy + vec2(q.z, q.x) * uDmgS;
    vec2 uvZ = (vDn.z < 0.0 ? uDmgO2.zw : uDmgO3) + vec2(q.x, q.y) * uDmgS;
    vec4 d = texture2D(uDmgMap, uvX) * wt.x + texture2D(uDmgMap, uvY) * wt.y + texture2D(uDmgMap, uvZ) * wt.z;
    // paint cracked off along the sharpest creases: a few flakes of primer, fewer of bare metal (centimetre flakes:
    // finer ones read as black and white noise over a dented door from a few metres)
    float cr = smoothstep(0.93, 1.0, vDs);
    float fl = dmgNoise(vDp * 16.0) * 0.7 + dmgNoise(vDp * 42.0 + 3.7) * 0.3;
    d.g = max(d.g, cr * smoothstep(0.76, 0.8, fl));
    d.r = max(d.r, cr * cr * smoothstep(0.76, 0.8, fl) * 0.4);
    d.b = max(d.b, smoothstep(0.4, 0.95, vDs) * 0.1);
    d.a = max(d.a, smoothstep(0.2, 0.8, vDs) * 0.16);
    vec3 primer = vec3(0.46, 0.46, 0.44), bare = vec3(0.6, 0.6, 0.61);
    float sc = clamp(d.b, 0.0, 1.0), pr = clamp(d.g, 0.0, 1.0), mt = clamp(d.r, 0.0, 1.0);
    // scuffed clear coat: a lighter, duller paint; then primer; then bare steel
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.6 + vec3(0.22), sc * 0.75);
    diffuseColor.rgb = mix(diffuseColor.rgb, primer, pr);
    diffuseColor.rgb = mix(diffuseColor.rgb, bare, mt);
    diffuseColor.rgb *= 1.0 - 0.55 * clamp(d.a, 0.0, 1.0);
    roughnessFactor = mix(roughnessFactor, 0.62, max(sc * 0.8, pr));
    roughnessFactor = mix(roughnessFactor, 0.3, mt);
    metalnessFactor = mix(metalnessFactor, 0.0, pr);
    metalnessFactor = mix(metalnessFactor, 1.0, mt);
    dmgCoat = clamp(max(max(sc * 0.9, pr), mt), 0.0, 1.0);
  }`;
const PAINT_FS_COAT = `
#ifdef USE_CLEARCOAT
  material.clearcoat *= 1.0 - dmgCoat;
#endif`;

function patchPaint(m, U) {
  if (!m || UNIFORMS.has(m) || !(m.isMeshStandardMaterial)) return;
  UNIFORMS.set(m, U);
  const prev = m.onBeforeCompile;
  const key = m.customProgramCacheKey ? m.customProgramCacheKey() : '';
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(m, sh, r);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>' + PAINT_VS_DECL)
      .replace('#include <begin_vertex>', '#include <begin_vertex>' + PAINT_VS_MAIN);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>' + PAINT_FS_DECL)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>' + PAINT_FS_MAIN)
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>' + PAINT_FS_COAT);
  };
  m.customProgramCacheKey = () => key + '|car-dmg';
  m.needsUpdate = true;
}
function paintUniforms() {
  return {
    uDmgMap: { value: blank() }, uDmgOn: { value: 0 }, uDmgA: { value: new THREE.Vector4() }, uDmgS: { value: new THREE.Vector2(1, 1) },
    uDmgO1: { value: new THREE.Vector4() }, uDmgO2: { value: new THREE.Vector4() }, uDmgO3: { value: new THREE.Vector2() },
  };
}

const GLASS_VS_DECL = `
attribute vec2 _guv;
varying vec2 vGuv;`;
const GLASS_FS_DECL = `
uniform sampler2D uCrack;
uniform float uDmgOn;
varying vec2 vGuv;`;
const GLASS_FS_MAIN = `
  if (uDmgOn > 0.5) {
    vec4 ck = texture2D(uCrack, vGuv);
    float c = max(ck.r, ck.g * 0.7);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.86, 0.88), c * 0.9);
    diffuseColor.a = max(diffuseColor.a, c * 0.9);
    roughnessFactor = mix(roughnessFactor, 0.55, c);
  }`;
function patchGlass(m, U) {
  if (!m || UNIFORMS.has(m) || !m.isMeshStandardMaterial) return;
  UNIFORMS.set(m, U);
  const prev = m.onBeforeCompile;
  const key = m.customProgramCacheKey ? m.customProgramCacheKey() : '';
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(m, sh, r);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>' + GLASS_VS_DECL)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vGuv = _guv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>' + GLASS_FS_DECL)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>' + GLASS_FS_MAIN);
  };
  m.customProgramCacheKey = () => key + '|car-glass-dmg';
  m.needsUpdate = true;
}
const glassUniforms = () => ({ uCrack: { value: blank() }, uDmgOn: { value: 0 } });

// a copy of a patched material with its own uniforms (same program)
function ownCopy(m, kind) {
  const c = m.clone();
  c.name = m.name;
  const U = kind === 'glass' ? glassUniforms() : paintUniforms();
  if (kind === 'glass') patchGlass(c, U); else patchPaint(c, U);
  // a copy of the player's cabin-shaded paint is not made: only traffic paint (no cabin patch) comes through here
  return c;
}

// ---------------------------------------------------------------------------------------------------------
// the damage atlas: scratches and scuffs drawn on the GPU into a render target per car (max blending, so they
// only ever build up). Regions, all at one scale (metres to pixels the same both ways): left and right sides
// (z along, y up), the top (z along, x across), front and rear (x across, y up).

const STAMP_VS = `
precision highp float;
attribute vec3 position;
attribute vec4 aSeg;   // from (x, y) to (z, w), atlas pixels
attribute vec4 aVal;   // what it does to each channel: metal, primer, scuff, dirt
attribute vec3 aMore;  // half width (px), kind (0 scratch, 1 splat), seed
uniform vec2 uSize;
varying vec2 vL;
varying vec4 vVal;
varying vec3 vMore;
varying vec4 vTN;
void main() {
  vec2 a = aSeg.xy, b = aSeg.zw, d = b - a;
  float len = max(length(d), 0.5);
  vec2 t = d / len, n = vec2(-t.y, t.x);
  float hw = aMore.x;
  // the quad runs from a to b with a little margin at the ends, hw either side
  vec2 p = a + t * (position.x * (len + 2.0 * hw) - hw) + n * position.y * hw;
  vL = vec2((position.x * (len + 2.0 * hw) - hw) / len, position.y);
  vVal = aVal; vMore = vec3(len, aMore.yz); vTN = vec4(t, n);
  gl_Position = vec4(p / uSize * 2.0 - 1.0, 0.0, 1.0);
}`;
const STAMP_FS = `
precision highp float;
varying vec2 vL;
varying vec4 vVal;
varying vec3 vMore;
varying vec4 vTN;
uniform float uLane;
float h1(float n) { return fract(sin(n) * 43758.5453); }
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
void main() {
  float seed = vMore.z;
  vec4 o = vec4(0.0);
  if (vMore.y < 0.5) {
    // a scratch band: long parallel lines along the way it slid, each broken along its length; a soft scuff over
    // the band. The lines go by where the pixel is in the map, not in this stamp, so the many short stamps of one
    // scrape line up into long streaks (they made a blotchy smear when each had its own)
    float u = vL.x, v = vL.y;
    if (u < -0.02 || u > 1.02) discard;
    float along = dot(gl_FragCoord.xy, vTN.xy), across = dot(gl_FragCoord.xy, vTN.zw);
    float x = across / uLane, lane = floor(x), f = fract(x);
    float seg = floor(along / (uLane * 60.0));
    float pres = step(0.4, h1(lane * 7.13 + seg * 1.37));
    float deep = h1(lane * 3.71 + seg * 2.91);
    float line = pres * (1.0 - smoothstep(0.12, 0.45, abs(f - 0.5)));
    float brk = smoothstep(0.15, 0.32, vn(vec2(along / uLane * 0.05 + lane * 9.1, lane * 0.37)));
    float ends = smoothstep(0.0, 0.1, u) * smoothstep(1.0, 0.9, u);
    float edge = 1.0 - smoothstep(0.65, 1.0, abs(v));
    float sc = edge * ends * (0.7 + 0.3 * vn(vec2(along / uLane * 0.02, across / uLane * 0.25)));
    float ln = line * brk * ends * edge;
    // the band's core rubbed through to primer in patches, bright metal in the deepest lines
    float core = (1.0 - smoothstep(0.15, 0.7, abs(v))) * ends;
    float patchy = smoothstep(0.35, 0.6, vn(vec2(along / uLane * 0.03, across / uLane * 0.12)));
    o = vec4(ln * vVal.x * step(0.45, deep), max(ln * step(0.12, deep), core * patchy * 0.8) * vVal.y, sc * vVal.z, sc * vVal.w);
  } else {
    // a splat: chipped paint round an impact, ragged edge
    vec2 q = vec2(vL.x * 2.0 - 1.0, vL.y);
    float r = length(q);
    float nz = vn(q * 5.0 + seed * 7.0) * 0.5 + vn(q * 13.0 + seed) * 0.5;
    float body = 1.0 - smoothstep(0.55, 1.0, r + (nz - 0.5) * 0.6);
    // (chips where it was hit hardest, in flakes: finer ones read as noise from a few metres)
    float chips = step(0.66, vn(q * 9.0 + seed * 3.0)) * body * (1.0 - smoothstep(0.25, 0.75, r));
    o = vec4(chips * vVal.x * step(0.7, nz), chips * vVal.y, body * vVal.z, body * vVal.w);
  }
  if (max(max(o.r, o.g), max(o.b, o.a)) < 0.003) discard;
  gl_FragColor = o;
}`;

class Stamper {
  constructor(renderer) {
    this.renderer = renderer; this.max = 1024;
    const g = this.geo = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aSeg = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aVal = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aMore = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aSeg', this.aSeg); g.setAttribute('aVal', this.aVal); g.setAttribute('aMore', this.aMore);
    g.instanceCount = 0;
    this.mat = new THREE.RawShaderMaterial({
      vertexShader: STAMP_VS, fragmentShader: STAMP_FS, uniforms: { uSize: { value: new THREE.Vector2(2048, 1024) }, uLane: { value: 3 } },
      depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendEquationAlpha: THREE.MaxEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
    });
    this.mat.name = 'damage_stamp';
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.mesh);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    // build the (tiny) shader now: a raw shader's program is the same for any target
    try { renderer.compile(this.scene, this.cam); } catch (e) {}
  }
  target(w, h) {
    const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, stencilBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    rt.texture.name = 'damage_atlas';
    const R = this.renderer, prev = R.getRenderTarget(), cc = R.getClearColor(new THREE.Color()), ca = R.getClearAlpha();
    R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.clear(true, false, false);
    R.setRenderTarget(prev); R.setClearColor(cc, ca);
    return rt;
  }
  clearTarget(rt) {
    const R = this.renderer, prev = R.getRenderTarget(), cc = R.getClearColor(new THREE.Color()), ca = R.getClearAlpha();
    R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.clear(true, false, false);
    R.setRenderTarget(prev); R.setClearColor(cc, ca);
  }
  // list: [x0, y0, x1, y1, metal, primer, scuff, dirt, halfWidth, kind, seed] * n
  draw(rt, list) {
    let n = Math.min(this.max, list.length / 11 | 0);
    if (!n) return;
    const S = this.aSeg.array, V = this.aVal.array, M = this.aMore.array;
    for (let i = 0; i < n; i++) {
      const o = i * 11;
      S[i * 4] = list[o]; S[i * 4 + 1] = list[o + 1]; S[i * 4 + 2] = list[o + 2]; S[i * 4 + 3] = list[o + 3];
      V[i * 4] = list[o + 4]; V[i * 4 + 1] = list[o + 5]; V[i * 4 + 2] = list[o + 6]; V[i * 4 + 3] = list[o + 7];
      M[i * 3] = list[o + 8]; M[i * 3 + 1] = list[o + 9]; M[i * 3 + 2] = list[o + 10];
    }
    this.aSeg.needsUpdate = this.aVal.needsUpdate = this.aMore.needsUpdate = true;
    this.geo.instanceCount = n;
    this.mat.uniforms.uSize.value.set(rt.width, rt.height);
    const R = this.renderer, prev = R.getRenderTarget(), ac = R.autoClear, xr = R.xr.enabled;
    R.autoClear = false; R.xr.enabled = false;
    R.setRenderTarget(rt);
    R.render(this.scene, this.cam);
    R.setRenderTarget(prev); R.autoClear = ac; R.xr.enabled = xr;
    this.geo.instanceCount = 0;
  }
}

// ---------------------------------------------------------------------------------------------------------
// one mesh of a car, as damage sees it: its own copy of the geometry once touched, and the positions, rest
// positions and rest normals in the car's frame

const SKIP_ANCESTOR = /^(pivot_|spin_|wheel_|steer$|dmgbend_)/;
const _dirty = { a: new Uint8Array(0) };
function scratch(name, n, Type = Float32Array) { const k = '_s_' + name; if (!scratch[k] || scratch[k].length < n) scratch[k] = new Type(Math.max(n, 1024) * 1.3 | 0); return scratch[k]; }

class Entry {
  constructor(rd, mesh, role) {
    this.rd = rd; this.mesh = mesh; this.role = role;
    this.src = mesh.geometry; this.srcMat = mesh.material;
    this.geo = null; this.rest = this.restN = this.cur = this.strain = null; this.win = null;
    this.m2c = new THREE.Matrix4(); this.c2m = new THREE.Matrix4(); this.n2c = new THREE.Matrix3(); this.n2m = new THREE.Matrix3();
    this.ident = true; this.owned = new Set();
    this.relMatrix();
    this.box = new THREE.Box3();
    if (!this.src.boundingBox) this.src.computeBoundingBox();
    this.box.copy(this.src.boundingBox).applyMatrix4(this.m2c);
    this.L = role === 'paint' ? (rd.npc ? 0.075 : 0.04) : role === 'body' ? (rd.npc ? 0.09 : 0.055) : role === 'glass' ? (rd.npc ? 0.12 : 0.07) : role === 'lamp' ? 0.05 : 0.15;
  }
  relMatrix() {
    const root = this.rd.root;
    let M = _m.copy(this.mesh.matrix), o = this.mesh.parent;
    this.mesh.updateMatrix();
    M.copy(this.mesh.matrix);
    while (o && o !== root) { o.updateMatrix(); M.premultiply(o.matrix); o = o.parent; }
    this.m2c.copy(M); this.c2m.copy(M).invert();
    this.n2c.getNormalMatrix(this.m2c); this.n2m.getNormalMatrix(this.c2m);
    const e = M.elements;
    this.ident = Math.abs(e[0] - 1) + Math.abs(e[5] - 1) + Math.abs(e[10] - 1) + Math.abs(e[1]) + Math.abs(e[2]) + Math.abs(e[4]) + Math.abs(e[6]) + Math.abs(e[8]) + Math.abs(e[9]) + Math.abs(e[12]) + Math.abs(e[13]) + Math.abs(e[14]) < 1e-6;
  }
  // positions of the source geometry in the car's frame (for the model's analysis)
  srcPositions() {
    const p = this.src.attributes.position, n = p.count;
    if (this.ident && !p.isInterleavedBufferAttribute && !p.normalized && p.array instanceof Float32Array) return p.array.slice(0, n * 3);
    const out = new Float32Array(n * 3);
    const e = this.m2c.elements;
    for (let i = 0; i < n; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      out[i * 3] = e[0] * x + e[4] * y + e[8] * z + e[12]; out[i * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; out[i * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    }
    return out;
  }
  srcIndex() {
    if (this.src.index) return this.src.index.array;
    const n = this.src.attributes.position.count, a = new Uint32Array(n); for (let i = 0; i < n; i++) a[i] = i; return a;
  }
  // this rig's own geometry: positions and normals copied (the rest shared with the model until changed)
  // a geometry of this rig's own, sharing the model's buffers (enough to cut a part out: only its index changes)
  ownGeo() {
    if (this.geo) return this.geo;
    const s = this.src, g = new THREE.BufferGeometry();
    g.name = (s.name || '') + ':dmg';
    for (const k in s.attributes) g.setAttribute(k, s.attributes[k]);
    for (const k in s.morphAttributes) g.morphAttributes[k] = s.morphAttributes[k];
    if (s.index) g.setIndex(s.index);
    else { const n = s.attributes.position.count, a = new Uint32Array(n); for (let i = 0; i < n; i++) a[i] = i; g.setIndex(new THREE.BufferAttribute(a, 1)); this.owned.add(g.index); }
    for (const gr of s.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
    g.boundingSphere = s.boundingSphere ? s.boundingSphere.clone() : null;
    if (!g.boundingSphere) g.computeBoundingSphere();
    g.boundingSphere.radius += 0.5;
    this.geo = g; this.mesh.geometry = g;
    return g;
  }
  // drawn with a paint the damage patch is on (the far version of a traffic car's paint too)
  isPaint() { const ms = Array.isArray(this.mesh.material) ? this.mesh.material : [this.mesh.material]; return ms.some(m => m && UNIFORMS.has(m) && !('uCrack' in UNIFORMS.get(m))); }
  // and its own positions and normals (to move them), with the car-frame copies
  own() {
    const g = this.ownGeo();
    if (this.cur) return g;
    const s = g;
    const p = s.attributes.position, n = p.count;
    const plain = at => at && !at.isInterleavedBufferAttribute && !at.normalized && at.array instanceof Float32Array && at.itemSize === 3;
    const copy3 = at => { if (plain(at)) return at.array.slice(0, n * 3); const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = at.getX(i); a[i * 3 + 1] = at.getY(i); a[i * 3 + 2] = at.getZ(i); } return a; };
    const pos = new THREE.BufferAttribute(copy3(p), 3);
    g.setAttribute('position', pos); this.owned.add(pos);
    const sn = s.attributes.normal;
    if (sn) { const nr = new THREE.BufferAttribute(copy3(sn), 3); g.setAttribute('normal', nr); this.owned.add(nr); }
    // the car-frame arrays
    this.rest = new Float32Array(n * 3); this.restN = new Float32Array(n * 3); this.strain = new Float32Array(n);
    const e = this.m2c.elements, ne = this.n2c.elements, pa = pos.array, na = sn ? g.attributes.normal.array : null;
    if (this.ident) { this.rest.set(pa); if (na) for (let i = 0; i < n * 3; i += 3) { const l = Math.sqrt(na[i] * na[i] + na[i + 1] * na[i + 1] + na[i + 2] * na[i + 2]) || 1; this.restN[i] = na[i] / l; this.restN[i + 1] = na[i + 1] / l; this.restN[i + 2] = na[i + 2] / l; } }
    else for (let i = 0; i < n; i++) {
      const x = pa[i * 3], y = pa[i * 3 + 1], z = pa[i * 3 + 2];
      this.rest[i * 3] = e[0] * x + e[4] * y + e[8] * z + e[12]; this.rest[i * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; this.rest[i * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      if (na) {
        const a = na[i * 3], b = na[i * 3 + 1], c = na[i * 3 + 2];
        let X = ne[0] * a + ne[3] * b + ne[6] * c, Y = ne[1] * a + ne[4] * b + ne[7] * c, Z = ne[2] * a + ne[5] * b + ne[8] * c;
        const l = Math.hypot(X, Y, Z) || 1; this.restN[i * 3] = X / l; this.restN[i * 3 + 1] = Y / l; this.restN[i * 3 + 2] = Z / l;
      }
    }
    this.cur = this.rest.slice();
    if (this.role === 'paint' || this.isPaint()) {
      g.setAttribute('_dp', new THREE.BufferAttribute(this.rest, 3)); g.setAttribute('_dn', new THREE.BufferAttribute(this.restN, 3)); g.setAttribute('_ds', new THREE.BufferAttribute(this.strain, 1));
      this.owned.add(g.attributes._dp); this.owned.add(g.attributes._dn); this.owned.add(g.attributes._ds);
    }
    return g;
  }
  ownIndex() {
    const g = this.ownGeo();
    if (this.owned.has(g.index)) return g.index;
    const a = new THREE.BufferAttribute(g.index.array.slice(), 1);
    g.setIndex(a); this.owned.add(a);
    return a;
  }
  setIndex(arr) {
    const g = this.ownGeo();
    const big = g.attributes.position.count > 65535;
    const a = new THREE.BufferAttribute(big ? (arr instanceof Uint32Array ? arr : new Uint32Array(arr)) : new Uint16Array(arr), 1);
    if (g.index && this.owned.has(g.index)) this.owned.delete(g.index);
    g.setIndex(a); this.owned.add(a);
    if (g.groups.length) { g.clearGroups(); g.addGroup(0, a.count, 0); }
  }
  // put the car-frame positions back into the mesh's own frame
  writePositions() {
    const pos = this.geo.attributes.position, a = pos.array, c = this.cur, n = c.length / 3;
    if (this.ident) a.set(c);
    else { const e = this.c2m.elements; for (let i = 0; i < n; i++) { const x = c[i * 3], y = c[i * 3 + 1], z = c[i * 3 + 2]; a[i * 3] = e[0] * x + e[4] * y + e[8] * z + e[12]; a[i * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; a[i * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]; } }
    pos.needsUpdate = true;
  }
  restore() {
    if (!this.geo) return;
    this.mesh.geometry = this.src;
    const g = this.geo;
    for (const k of Object.keys(g.attributes)) if (!this.owned.has(g.attributes[k])) g.deleteAttribute(k);
    if (g.index && !this.owned.has(g.index)) g.setIndex(null);
    g.morphAttributes = {};
    g.dispose();
    this.geo = null; this.rest = this.restN = this.cur = this.strain = this.win = null; this.owned.clear();
    this.prefined = false; this.fine = undefined;
    this.mesh.visible = true;
  }
}

// subdivide the triangles whose edges are longer than L where `want(x, y, z)` says (edge middles, car frame), so a
// bend has vertices to bend with. Every long edge is split in both triangles that share it (no cracks).
function* refineGen(job, e, want, L, maxPasses = 4, ends = false) {
  const g = e.own();
  let changed = false;
  for (let pass = 0; pass < maxPasses; pass++) {
    const idx = g.index.array, cur = e.cur, n = cur.length / 3, L2 = L * L, nt = idx.length;
    // the midpoints, in an open-addressed table keyed by the edge's two vertices (grown as it fills: most passes
    // split few edges, and a table the size of the mesh was megabytes of garbage a crash)
    let cap = 4096, kA = new Int32Array(cap).fill(-1), kB = new Int32Array(cap), kV = new Int32Array(cap), mask = cap - 1;
    let pairs = new Int32Array(4096), np = 0;
    let out = new Uint32Array(nt + 4096); let o = 0;
    const put = (a, b, m) => { let h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663)) & mask; while (kA[h] !== -1) h = (h + 1) & mask; kA[h] = a; kB[h] = b; kV[h] = m; };
    const mid = (a, b) => {
      if (a > b) { const t = a; a = b; b = t; }
      let h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663)) & mask;
      while (kA[h] !== -1) { if (kA[h] === a && kB[h] === b) return kV[h]; h = (h + 1) & mask; }
      const m = n + np;
      if (np * 2 + 2 > cap) {
        // double the table and put everything back
        const oA = kA, oB = kB, oV = kV, oc = cap;
        cap *= 2; mask = cap - 1; kA = new Int32Array(cap).fill(-1); kB = new Int32Array(cap); kV = new Int32Array(cap);
        for (let i = 0; i < oc; i++) if (oA[i] !== -1) put(oA[i], oB[i], oV[i]);
        put(a, b, m);
      } else { kA[h] = a; kB[h] = b; kV[h] = m; }
      if (np * 2 + 2 > pairs.length) { const p2 = new Int32Array(pairs.length * 2); p2.set(pairs); pairs = p2; }
      pairs[np * 2] = a; pairs[np * 2 + 1] = b; np++;
      return m;
    };
    const room = k => { if (o + k > out.length) { const o2 = new Uint32Array(Math.max(out.length * 2, o + k + 4096)); o2.set(out.subarray(0, o)); out = o2; } };
    const isLong = (a, b) => {
      const a3 = a * 3, b3 = b * 3;
      const dx = cur[a3] - cur[b3], dy = cur[a3 + 1] - cur[b3 + 1], dz = cur[a3 + 2] - cur[b3 + 2];
      if (dx * dx + dy * dy + dz * dz <= L2) return false;
      if (want((cur[a3] + cur[b3]) * 0.5, (cur[a3 + 1] + cur[b3 + 1]) * 0.5, (cur[a3 + 2] + cur[b3 + 2]) * 0.5)) return true;
      return ends && (want(cur[a3], cur[a3 + 1], cur[a3 + 2]) || want(cur[b3], cur[b3 + 1], cur[b3 + 2]));
    };
    for (let t = 0, k = 0; t < nt; t += 3, k++) {
      if ((k & 2047) === 2047 && performance.now() >= job.deadline) yield;
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      const lab = isLong(a, b), lbc = isLong(b, c), lca = isLong(c, a);
      room(12);
      if (!lab && !lbc && !lca) { out[o++] = a; out[o++] = b; out[o++] = c; continue; }
      if (lab && lbc && lca) {
        const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
        out[o++] = a; out[o++] = ab; out[o++] = ca; out[o++] = ab; out[o++] = b; out[o++] = bc;
        out[o++] = ca; out[o++] = bc; out[o++] = c; out[o++] = ab; out[o++] = bc; out[o++] = ca;
      } else if (lab + lbc + lca === 1) {
        if (lab) { const m = mid(a, b); out[o++] = a; out[o++] = m; out[o++] = c; out[o++] = m; out[o++] = b; out[o++] = c; }
        else if (lbc) { const m = mid(b, c); out[o++] = b; out[o++] = m; out[o++] = a; out[o++] = m; out[o++] = c; out[o++] = a; }
        else { const m = mid(c, a); out[o++] = c; out[o++] = m; out[o++] = b; out[o++] = m; out[o++] = a; out[o++] = b; }
      } else {
        // two long edges: turned so the short one is (C, A)
        let A = a, B = b, C = c;
        if (!lab) { A = b; B = c; C = a; } else if (!lbc) { A = c; B = a; C = b; }
        const ab = mid(A, B), bc = mid(B, C);
        out[o++] = ab; out[o++] = B; out[o++] = bc; out[o++] = A; out[o++] = ab; out[o++] = bc; out[o++] = A; out[o++] = bc; out[o++] = C;
      }
    }
    const nv = np;
    if (!nv) break;
    changed = true;
    const N = n + nv;
    // every attribute, interpolated at the new vertices
    for (const name of Object.keys(g.attributes)) {
      if (name === '_dp' || name === '_dn' || name === '_ds') continue;
      const at = g.attributes[name], sz = at.itemSize, arr = new Float32Array(N * sz);
      if (at.isInterleavedBufferAttribute || at.normalized || !(at.array instanceof Float32Array)) {
        for (let i = 0; i < n; i++) for (let j = 0; j < sz; j++) arr[i * sz + j] = at.getComponent(i, j);
      } else arr.set(at.array.subarray(0, n * sz));
      const isN = name === 'normal' || name === 'tangent', code = name === '_lamp';
      for (let k = 0; k < nv; k++) {
        const a = pairs[k * 2], b = pairs[k * 2 + 1], oo = (n + k) * sz;
        for (let j = 0; j < sz; j++) { const va = arr[a * sz + j], vb = arr[b * sz + j]; arr[oo + j] = code ? (va === vb ? va : 0) : (va + vb) * 0.5; }
        if (isN) { const l = Math.hypot(arr[oo], arr[oo + 1], arr[oo + 2]) || 1; arr[oo] /= l; arr[oo + 1] /= l; arr[oo + 2] /= l; }
      }
      const nb = new THREE.BufferAttribute(arr, sz);
      if (e.owned.has(at)) e.owned.delete(at);
      g.setAttribute(name, nb); e.owned.add(nb);
    }
    const grow = (src, sz, norm) => {
      const arr = new Float32Array(N * sz); arr.set(src.subarray(0, n * sz));
      for (let k = 0; k < nv; k++) {
        const a = pairs[k * 2], b = pairs[k * 2 + 1], oo = (n + k) * sz;
        for (let j = 0; j < sz; j++) arr[oo + j] = (src[a * sz + j] + src[b * sz + j]) * 0.5;
        if (norm) { const l = Math.hypot(arr[oo], arr[oo + 1], arr[oo + 2]) || 1; arr[oo] /= l; arr[oo + 1] /= l; arr[oo + 2] /= l; }
      }
      return arr;
    };
    e.rest = grow(e.rest, 3); e.restN = grow(e.restN, 3, true); e.cur = grow(e.cur, 3); e.strain = grow(e.strain, 1);
    if (e.win) { const w = new Int16Array(N); w.set(e.win.subarray(0, n)); for (let k = 0; k < nv; k++) w[n + k] = e.win[pairs[k * 2]]; e.win = w; }
    if (g.attributes._dp) {
      for (const [nm, arr, sz] of [['_dp', e.rest, 3], ['_dn', e.restN, 3], ['_ds', e.strain, 1]]) {
        const old = g.attributes[nm]; if (old) e.owned.delete(old);
        const at = new THREE.BufferAttribute(arr, sz); g.setAttribute(nm, at); e.owned.add(at);
      }
    }
    e.setIndex(out.slice(0, o));
    yield;
  }
  return changed;
}
function refine(e, want, L, maxPasses = 4) { return runSync(refineGen(SYNC, e, want, L, maxPasses)); }

// cooperative work: a generator that yields at checkpoints; run with a time budget a frame, or all at once
const SYNC = { deadline: Infinity };
// (a job yields WAIT while it waits for another job's result, the model's analysis: its run ends at once, job.waiting
// is set, and the background list goes on to the next job; perf)
const WAIT = Symbol('wait');
function runSync(gen) { let r; do { r = gen.next(); } while (!r.done); return r.value; }
function makeJob(rd, gen, onDone) {
  const job = { rd, done: false, deadline: 0, waiting: false };
  const it = gen(job);
  job.run = budget => {
    if (job.done) return true;
    job.deadline = performance.now() + budget;
    job.waiting = false;
    try {
      for (;;) {
        const r = it.next();
        if (r.done) { job.done = true; if (onDone) onDone(r.value); break; }
        if (r.value === WAIT) { job.waiting = true; break; }
        if (performance.now() >= job.deadline) break;
      }
    } catch (err) { job.done = true; console.warn('damage job', err); }
    return job.done;
  };
  return job;
}


// the points next to a cut's boundary moved onto it: each edge with one end in and one out is searched for where it
// crosses, and the nearer end goes there. The cut then runs along the boundary instead of zigzagging round whole
// triangles (an opened door showed a ragged dark fringe of trim and seal triangles all round its outline).
function* snapGen(job, e, test) {
  const c = e.cur; if (!c || !e.geo || !e.geo.index) return 0;
  const idx = e.geo.index.array, n = c.length / 3;
  const ins = new Int8Array(n);
  for (let i = 0; i < n; i++) { if ((i & 8191) === 8191 && performance.now() >= job.deadline) yield; ins[i] = test(c[i * 3], c[i * 3 + 1], c[i * 3 + 2]) ? 1 : 0; }
  let best = null, moved = 0;
  for (let t = 0; t < idx.length; t += 3) {
    if ((t % 24576) === 24573 && performance.now() >= job.deadline) yield;
    for (let k = 0; k < 3; k++) {
      const a = idx[t + k], b = idx[t + (k + 1) % 3];
      if (ins[a] === ins[b]) continue;
      // where along a -> b the test changes (bisection)
      const a3 = a * 3, b3 = b * 3, ia = ins[a];
      let lo = 0, hi = 1;
      for (let it = 0; it < 7; it++) { const m = (lo + hi) / 2; if ((test(c[a3] + (c[b3] - c[a3]) * m, c[a3 + 1] + (c[b3 + 1] - c[a3 + 1]) * m, c[a3 + 2] + (c[b3 + 2] - c[a3 + 2]) * m) ? 1 : 0) === ia) lo = m; else hi = m; }
      const f = (lo + hi) / 2, v = f < 0.5 ? a : b;
      // (in metres: a long edge's end is never pulled far, or one long sliver of a triangle reached to the road)
      const el = Math.hypot(c[b3] - c[a3], c[b3 + 1] - c[a3 + 1], c[b3 + 2] - c[a3 + 2]), d = (f < 0.5 ? f : 1 - f) * el;
      if (d > 0.06) continue;
      if (!best) { best = new Float32Array(n * 4); for (let i = 0; i < n; i++) best[i * 4 + 3] = 2; }
      if (d < best[v * 4 + 3]) { best[v * 4] = c[a3] + (c[b3] - c[a3]) * f; best[v * 4 + 1] = c[a3 + 1] + (c[b3 + 1] - c[a3 + 1]) * f; best[v * 4 + 2] = c[a3 + 2] + (c[b3 + 2] - c[a3 + 2]) * f; best[v * 4 + 3] = d; }
    }
  }
  if (!best) return 0;
  const r = e.rest;
  for (let v = 0; v < n; v++) {
    if (best[v * 4 + 3] > 1) continue;
    const v3 = v * 3, dx = best[v * 4] - c[v3], dy = best[v * 4 + 1] - c[v3 + 1], dz = best[v * 4 + 2] - c[v3 + 2];
    c[v3] += dx; c[v3 + 1] += dy; c[v3 + 2] += dz;
    // (the rest shape moves with it, so the paint map and later crushes do not see it as stretched)
    if (r && r !== c) { r[v3] += dx; r[v3 + 1] += dy; r[v3 + 2] += dz; }
    moved++;
  }
  if (moved) e.writePositions();
  return moved;
}

// triangles stretched far past their own size by a crush are taken out of the mesh: a sheet that long would have
// torn (a hole shows, where a long thin needle of stretched skin showed before)
function* tearGen(job, e, dirty, coarse = false, keep = null) {
  const c = e.cur, r = e.rest; if (!c || !r || !e.geo || !e.geo.index) return 0;
  let idx = e.geo.index.array, owned = false, torn = 0;
  const nt = idx.length / 3;
  for (let t = 0; t < nt; t++) {
    if ((t & 4095) === 4095 && performance.now() >= job.deadline) yield;
    const t3 = t * 3, a = idx[t3], b = idx[t3 + 1], d = idx[t3 + 2];
    if (a === b && b === d) continue;
    if (!dirty[a] && !dirty[b] && !dirty[d]) continue;
    if (keep && keep(r[a * 3], r[a * 3 + 1], r[a * 3 + 2])) continue;
    let bad = false;
    for (let k = 0; k < 3 && !bad; k++) {
      const p = k === 0 ? a : k === 1 ? b : d, q = k === 0 ? b : k === 1 ? d : a, p3 = p * 3, q3 = q * 3;
      const cx = c[p3] - c[q3], cy = c[p3 + 1] - c[q3 + 1], cz = c[p3 + 2] - c[q3 + 2];
      const rx = r[p3] - r[q3], ry = r[p3 + 1] - r[q3 + 1], rz = r[p3 + 2] - r[q3 + 2];
      // (fine triangles only: a coarse one stretched reads as a smooth dent, and taking it out leaves a jagged hole)
      const cl = cx * cx + cy * cy + cz * cz, rl = Math.sqrt(rx * rx + ry * ry + rz * rz), lim = rl * 2.6 + 0.1;
      if ((coarse || rl < 0.09) && cl > lim * lim) bad = true;
    }
    if (!bad) continue;
    if (!owned) { idx = e.ownIndex().array; owned = true; }
    idx[t3 + 1] = a; idx[t3 + 2] = a; torn++;
  }
  if (torn) e.geo.index.needsUpdate = true;
  return torn;
}

// the mean edge length of a mesh (from its area and triangle count): fine meshes need no subdividing
function meanEdge(e) { return meanEdgeP(e.cur, e.geo.index.array); }
function meanEdgeP(c, idx) {
  let area = 0, nt = 0;
  const n = idx ? idx.length : c.length / 3;
  for (let t = 0; t + 2 < n; t += 9) {
    const a = (idx ? idx[t] : t) * 3, b = (idx ? idx[t + 1] : t + 1) * 3, cc = (idx ? idx[t + 2] : t + 2) * 3;
    const ux = c[b] - c[a], uy = c[b + 1] - c[a + 1], uz = c[b + 2] - c[a + 2], vx = c[cc] - c[a], vy = c[cc + 1] - c[a + 1], vz = c[cc + 2] - c[a + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    area += Math.sqrt(x * x + y * y + z * z) / 2; nt++;
  }
  // an equilateral triangle of that area
  return nt ? Math.sqrt(area / nt * 4 / Math.sqrt(3)) : 0;
}

// normals again where vertices moved: each vertex's normal turned by how its faces turned (so a model's own
// smoothing and hard edges stay), and a crease value (how much sharper the surface bends there than it did)
function* renormalGen(job, e, dirty) {
  const g = e.geo, idx = g.index.array, cur = e.cur, rest = e.rest, n = cur.length / 3, nt = idx.length;
  const buf = (k, len, T) => { let a = e[k]; if (!a || a.length < len) a = e[k] = new T(len); return a; };
  const aff = buf('_aff', n, Uint8Array); aff.fill(0, 0, n);
  // the triangles with a moved vertex (list 1), then those touching their vertices (list 2: one ring further)
  const L1 = buf('_L1', nt / 3 + 1, Int32Array), L2 = buf('_L2', nt / 3 + 1, Int32Array);
  let n1 = 0, n2 = 0;
  for (let t = 0; t < nt; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (dirty[a] | dirty[b] | dirty[c]) { aff[a] = aff[b] = aff[c] = 1; L1[n1++] = t; }
    if ((t % 24576) === 24573 && performance.now() >= job.deadline) yield;
  }
  if (!n1) return;
  yield;
  for (let t = 0; t < nt; t += 3) { const a = idx[t], b = idx[t + 1], c = idx[t + 2]; if ((aff[a] | aff[b] | aff[c]) && !(dirty[a] | dirty[b] | dirty[c])) L2[n2++] = t; if ((t % 24576) === 24573 && performance.now() >= job.deadline) yield; }
  yield;
  const sd = buf('_sd', n * 3, Float32Array), sr = buf('_sr', n * 3, Float32Array);
  for (let i = 0; i < n; i++) if (aff[i]) { const i3 = i * 3; sd[i3] = sd[i3 + 1] = sd[i3 + 2] = sr[i3] = sr[i3 + 1] = sr[i3 + 2] = 0; }
  for (let j = 0; j < n1 + n2; j++) {
    if ((j & 4095) === 4095 && performance.now() >= job.deadline) yield;
    const t = j < n1 ? L1[j] : L2[j - n1];
    const ia = idx[t], ib = idx[t + 1], ic = idx[t + 2], a = ia * 3, b = ib * 3, c = ic * 3;
    let ux = cur[b] - cur[a], uy = cur[b + 1] - cur[a + 1], uz = cur[b + 2] - cur[a + 2], vx = cur[c] - cur[a], vy = cur[c + 1] - cur[a + 1], vz = cur[c + 2] - cur[a + 2];
    const dx = uy * vz - uz * vy, dy = uz * vx - ux * vz, dz = ux * vy - uy * vx;
    ux = rest[b] - rest[a]; uy = rest[b + 1] - rest[a + 1]; uz = rest[b + 2] - rest[a + 2]; vx = rest[c] - rest[a]; vy = rest[c + 1] - rest[a + 1]; vz = rest[c + 2] - rest[a + 2];
    const rx = uy * vz - uz * vy, ry = uz * vx - ux * vz, rz = ux * vy - uy * vx;
    // (a long sliver turned over by a corner pushed across it is no guide to the surface: left out, or its far,
    // unmoved corners took its flipped normal, dark streaks across a whole door)
    if (dx * rx + dy * ry + dz * rz < 0) continue;
    if (aff[ia]) { sd[a] += dx; sd[a + 1] += dy; sd[a + 2] += dz; sr[a] += rx; sr[a + 1] += ry; sr[a + 2] += rz; }
    if (aff[ib]) { sd[b] += dx; sd[b + 1] += dy; sd[b + 2] += dz; sr[b] += rx; sr[b + 1] += ry; sr[b + 2] += rz; }
    if (aff[ic]) { sd[c] += dx; sd[c + 1] += dy; sd[c + 2] += dz; sr[c] += rx; sr[c + 1] += ry; sr[c + 2] += rz; }
  }
  yield;
  // (the geometry may have been replaced meanwhile: then this pass is dropped)
  if (e.geo !== g || e.cur !== cur) return;
  const nrm = g.attributes.normal;
  const R = e.restN, ne = e.n2m.elements, na = nrm ? nrm.array : null;
  for (let i = 0; i < n; i++) {
    if ((i & 8191) === 8191 && performance.now() >= job.deadline) yield;
    if (!aff[i]) continue;
    const i3 = i * 3;
    let dx = sd[i3], dy = sd[i3 + 1], dz = sd[i3 + 2], rx = sr[i3], ry = sr[i3 + 1], rz = sr[i3 + 2];
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz), rl = Math.sqrt(rx * rx + ry * ry + rz * rz);
    if (dl < 1e-14 || rl < 1e-14) { aff[i] = 0; continue; }
    dx /= dl; dy /= dl; dz /= dl; rx /= rl; ry /= rl; rz /= rl;
    sd[i3] = dx; sd[i3 + 1] = dy; sd[i3 + 2] = dz; sr[i3] = rx; sr[i3 + 1] = ry; sr[i3 + 2] = rz;
    if (!na) continue;
    // the rest normal turned by the rotation that takes the rest face normal to the deformed one
    const co = rx * dx + ry * dy + rz * dz;
    const vx = R[i3], vy = R[i3 + 1], vz = R[i3 + 2];
    let ox, oy, oz;
    if (co > -0.999) {
      const kx = ry * dz - rz * dy, ky = rz * dx - rx * dz, kz = rx * dy - ry * dx;
      const kv = kx * vx + ky * vy + kz * vz, f = 1 / (1 + co);
      ox = vx * co + (ky * vz - kz * vy) + kx * kv * f; oy = vy * co + (kz * vx - kx * vz) + ky * kv * f; oz = vz * co + (kx * vy - ky * vx) + kz * kv * f;
    } else { ox = dx; oy = dy; oz = dz; }
    if (e.ident) { na[i3] = ox; na[i3 + 1] = oy; na[i3 + 2] = oz; }
    else { na[i3] = ne[0] * ox + ne[3] * oy + ne[6] * oz; na[i3 + 1] = ne[1] * ox + ne[4] * oy + ne[7] * oz; na[i3 + 2] = ne[2] * ox + ne[5] * oy + ne[8] * oz; }
  }
  if (nrm) nrm.needsUpdate = true;
  yield;
  if (e.geo !== g || e.cur !== cur) return;
  // creases: a face turned well away from its vertices' average (more than it was) is a fold through the vertex
  const S = e.strain;
  const cr = (v, fx, fy, fz, gx, gy, gz) => {
    const v3 = v * 3;
    const k = ((fr(gx, gy, gz, v3)) - (fd(fx, fy, fz, v3))) * 6;
    if (k > S[v]) S[v] = k > 1 ? 1 : k;
  };
  const fd = (x, y, z, v3) => x * sd[v3] + y * sd[v3 + 1] + z * sd[v3 + 2];
  const fr = (x, y, z, v3) => x * sr[v3] + y * sr[v3 + 1] + z * sr[v3 + 2];
  for (let j = 0; j < n1; j++) {
    if ((j & 4095) === 4095 && performance.now() >= job.deadline) yield;
    const t = L1[j];
    const ia = idx[t], ib = idx[t + 1], ic = idx[t + 2], a = ia * 3, b = ib * 3, c = ic * 3;
    let ux = cur[b] - cur[a], uy = cur[b + 1] - cur[a + 1], uz = cur[b + 2] - cur[a + 2], vx = cur[c] - cur[a], vy = cur[c + 1] - cur[a + 1], vz = cur[c + 2] - cur[a + 2];
    let dx = uy * vz - uz * vy, dy = uz * vx - ux * vz, dz = ux * vy - uy * vx;
    ux = rest[b] - rest[a]; uy = rest[b + 1] - rest[a + 1]; uz = rest[b + 2] - rest[a + 2]; vx = rest[c] - rest[a]; vy = rest[c + 1] - rest[a + 1]; vz = rest[c + 2] - rest[a + 2];
    let rx = uy * vz - uz * vy, ry = uz * vx - ux * vz, rz = ux * vy - uy * vx;
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz), rl = Math.sqrt(rx * rx + ry * ry + rz * rz);
    if (dl < 1e-14 || rl < 1e-14) continue;
    dx /= dl; dy /= dl; dz /= dl; rx /= rl; ry /= rl; rz /= rl;
    if (aff[ia]) cr(ia, dx, dy, dz, rx, ry, rz);
    if (aff[ib]) cr(ib, dx, dy, dz, rx, ry, rz);
    if (aff[ic]) cr(ic, dx, dy, dz, rx, ry, rz);
  }
  if (g.attributes._ds) g.attributes._ds.needsUpdate = true;
}
function renormal(e, dirty) { runSync(renormalGen(SYNC, e, dirty)); }

// eigenvectors of a symmetric 3x3 (Jacobi), ascending
function eig3(c) {
  const A = [[c[0], c[1], c[2]], [c[1], c[3], c[4]], [c[2], c[4], c[5]]], V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let s = 0; s < 30; s++) {
    if (Math.abs(A[0][1]) + Math.abs(A[0][2]) + Math.abs(A[1][2]) < 1e-14) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(A[p][q]) < 1e-18) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), co = 1 / Math.sqrt(t * t + 1), si = t * co;
      for (let k = 0; k < 3; k++) { const x = A[k][p], y = A[k][q]; A[k][p] = co * x - si * y; A[k][q] = si * x + co * y; }
      for (let k = 0; k < 3; k++) { const x = A[p][k], y = A[q][k]; A[p][k] = co * x - si * y; A[q][k] = si * x + co * y; }
      for (let k = 0; k < 3; k++) { const x = V[k][p], y = V[k][q]; V[k][p] = co * x - si * y; V[k][q] = si * x + co * y; }
    }
  }
  return [0, 1, 2].sort((i, j) => A[i][i] - A[j][j]).map(i => new THREE.Vector3(V[0][i], V[1][i], V[2][i]));
}

// ---------------------------------------------------------------------------------------------------------
// what a model's geometry says (once per model): its box, the cabin and wheels, the windows, lamps, mirrors,
// bumpers and doors

function analyse(rd) { return runSync(analyseGen(SYNC, rd)); }
// (a step at a time, for the traffic's models worked out in the background before any crash)
function* analyseGen(job, rd) {
  const key = rd.rig.id + (rd.npc ? ':npc' : ':car') + ':' + rd.entries.length;
  if (ANALYSIS.has(key)) return ANALYSIS.get(key);
  const T0 = performance.now();
  const rig = rd.rig, d = rig.dims, E = rd.entries;
  const A = { entries: E.length };
  const P = [];
  for (const e of E) { P.push(e.role === 'proxy' ? null : (e._sp || (e._sp = e.srcPositions()))); if (performance.now() >= job.deadline) yield; }
  // the box and the body's half width (without mirrors: the 97th percentile of |x|)
  const box = new THREE.Box3();
  for (let k = 0; k < E.length; k++) { if (performance.now() >= job.deadline) yield; if (!P[k] || E[k].role === 'far') continue; for (let i = 0; i < P[k].length; i += 3) box.expandByPoint(_v.set(P[k][i], P[k][i + 1], P[k][i + 2])); }
  if (box.isEmpty()) box.set(new THREE.Vector3(-d.width / 2, 0, -d.front), new THREE.Vector3(d.width / 2, d.height, d.rear));
  A.box = box;
  const W = rig.wheels || [];
  const wf = W[0] ? W[0].pos.z : -d.wheelbase / 2, wr = W[2] ? W[2].pos.z : d.wheelbase / 2, wrad = W[0] ? W[0].radius : 0.33;
  A.zFA = wf; A.zRA = wr; A.wheelR = wrad;
  // windows: the glass meshes split into connected pieces, each classed by its facing
  const wins = [];
  const glassBox = new THREE.Box3();
  for (let k = 0; k < E.length; k++) if (E[k].role === 'glass' && P[k]) for (let i = 0; i < P[k].length; i += 3) glassBox.expandByPoint(_v.set(P[k][i], P[k][i + 1], P[k][i + 2]));
  const zMidG = glassBox.isEmpty() ? (wf + wr) / 2 : (glassBox.min.z + glassBox.max.z) / 2;
  const beltGuess = Math.max(d.height * 0.5, wrad * 2 + 0.05);
  A.winOf = {}; // entry index -> Int16Array window id per source vertex
  for (let k = 0; k < E.length; k++) { if (performance.now() >= job.deadline) yield;
    if (E[k].role !== 'glass' || !P[k]) continue;
    const pos = P[k], idx = E[k].srcIndex(), n = pos.length / 3, nt = idx.length / 3;
    // weld by position (1 mm)
    const weld = new Int32Array(n), wm = new Map();
    for (let i = 0; i < n; i++) { if ((i & 2047) === 2047 && performance.now() >= job.deadline) yield; const kk = Math.round(pos[i * 3] * 1000) + ',' + Math.round(pos[i * 3 + 1] * 1000) + ',' + Math.round(pos[i * 3 + 2] * 1000); let w = wm.get(kk); if (w === undefined) { w = i; wm.set(kk, w); } weld[i] = w; }
    const cls = new Int8Array(nt), area = new Float32Array(nt), cen = new Float32Array(nt * 3);
    for (let t = 0; t < nt; t++) {
      if ((t & 4095) === 4095 && performance.now() >= job.deadline) yield;
      const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
      _a.set(pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]);
      _b.set(pos[c * 3] - pos[a * 3], pos[c * 3 + 1] - pos[a * 3 + 1], pos[c * 3 + 2] - pos[a * 3 + 2]);
      _v.crossVectors(_a, _b); const ar = _v.length() / 2; area[t] = ar; _v.normalize();
      const cx = (pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3, cy = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3, cz = (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3;
      cen[t * 3] = cx; cen[t * 3 + 1] = cy; cen[t * 3 + 2] = cz;
      const ax = Math.abs(_v.x), ay = Math.abs(_v.y), az = Math.abs(_v.z);
      cls[t] = ay > 0.82 && cy > beltGuess ? 0 : az >= ax ? (cz < zMidG ? 1 : 2) : (cx < 0 ? 3 : 4); // roof, front, rear, left, right
    }
    // triangles join when they share a (welded) vertex and face the same way
    const par = new Int32Array(nt); for (let t = 0; t < nt; t++) par[t] = t;
    const find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    const byV = new Map();
    if (performance.now() >= job.deadline) yield;
    for (let t = 0; t < nt; t++) for (let j = 0; j < 3; j++) {
      if (j === 0 && (t & 4095) === 4095 && performance.now() >= job.deadline) yield;
      const w = weld[idx[t * 3 + j]], key2 = w * 8 + cls[t];
      const o = byV.get(key2); if (o === undefined) byV.set(key2, t); else { const ra = find(o), rb = find(t); if (ra !== rb) par[ra] = rb; }
    }
    const comp = new Map();
    if (performance.now() >= job.deadline) yield;
    for (let t = 0; t < nt; t++) {
      if ((t & 4095) === 4095 && performance.now() >= job.deadline) yield;
      const r = find(t); let c = comp.get(r);
      if (!c) comp.set(r, c = { tris: [], area: 0, cls: cls[t], box: new THREE.Box3(), cen: new THREE.Vector3() });
      c.tris.push(t); c.area += area[t]; c.cen.x += cen[t * 3] * area[t]; c.cen.y += cen[t * 3 + 1] * area[t]; c.cen.z += cen[t * 3 + 2] * area[t];
    }
    const comps = [...comp.values()];
    for (const c of comps) { c.cen.divideScalar(Math.max(c.area, 1e-9)); for (const t of c.tris) for (let j = 0; j < 3; j++) { const v = idx[t * 3 + j]; c.box.expandByPoint(_v.set(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2])); } }
    // small pieces (window rims, the thickness of the glass) join the nearest big one
    const big = comps.filter(c => c.area > 0.025), small = comps.filter(c => c.area <= 0.025);
    for (const s of small) {
      let best = null, bd = Infinity;
      for (const b of big) { const dd = b.box.distanceToPoint(s.cen); if (dd < bd) { bd = dd; best = b; } }
      if (best && bd < 0.08) { best.tris.push(...s.tris); best.box.union(s.box); } else if (s.area > 0.004) big.push(s);
    }
    const wid = new Int16Array(n).fill(-1);
    if (performance.now() >= job.deadline) yield;
    for (const c of big) {
      if (performance.now() >= job.deadline) yield;
      // the window's plane (fitted to its points): its normal and two axes along it
      let sx = 0, sy = 0, sz = 0, cnt = 0; const cv = [0, 0, 0, 0, 0, 0];
      const vs = new Set(); for (const t of c.tris) for (let j = 0; j < 3; j++) vs.add(idx[t * 3 + j]);
      for (const v of vs) { sx += pos[v * 3]; sy += pos[v * 3 + 1]; sz += pos[v * 3 + 2]; cnt++; }
      const mx = sx / cnt, my = sy / cnt, mz = sz / cnt;
      for (const v of vs) { const x = pos[v * 3] - mx, y = pos[v * 3 + 1] - my, z = pos[v * 3 + 2] - mz; cv[0] += x * x; cv[1] += x * y; cv[2] += x * z; cv[3] += y * y; cv[4] += y * z; cv[5] += z * z; }
      const ev = eig3(cv), nrm = ev[0];
      const U = new THREE.Vector3(0, 1, 0).cross(nrm); if (U.lengthSq() < 0.1) U.set(1, 0, 0).cross(nrm); U.normalize();
      const V = nrm.clone().cross(U).normalize();
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (const v of vs) { _v.set(pos[v * 3] - mx, pos[v * 3 + 1] - my, pos[v * 3 + 2] - mz); const a = _v.dot(U), b = _v.dot(V); u0 = Math.min(u0, a); u1 = Math.max(u1, a); v0 = Math.min(v0, b); v1 = Math.max(v1, b); }
      const w = {
        id: wins.length, entry: k, kind: 'side', side: 'C', area: c.area,
        center: new THREE.Vector3(mx, my, mz), normal: nrm, U, V, u0, u1, v0, v1, box: c.box.clone(), nv: vs.size,
      };
      w.laminated = w.kind === 'front';
      for (const v of vs) wid[v] = w.id;
      // welded twins (seams) too
      wins.push(w);
    }
    for (let i = 0; i < n; i++) if (wid[i] < 0 && wid[weld[i]] >= 0) wid[i] = wid[weld[i]];
    A.winOf[k] = wid;
  }
  // classed again by where each piece is and which way its plane faces: the side windows give the belt line
  // and the glasshouse's middle; below the belt is lamp glass; small glass inside is an instrument cover
  {
    const hwG = Math.max(0.3, d.width / 2);
    const sideW = wins.filter(w => Math.abs(w.normal.x) > 0.6 && w.area > 0.12 && Math.abs(w.center.x) > hwG * 0.5);
    const belt = sideW.length ? Math.min(...sideW.map(w => w.box.min.y)) : beltGuess;
    const zMid = sideW.length ? (Math.min(...sideW.map(w => w.box.min.z)) + Math.max(...sideW.map(w => w.box.max.z))) / 2 : zMidG;
    for (const w of wins) {
      const n = w.normal, c = w.center;
      if (w.area < 0.1 && Math.abs(c.x) < hwG * 0.62 && c.y < belt + 0.25 && c.y > 0.3) w.kind = 'inner';
      else if (c.y < belt - 0.04 || w.box.max.y < belt + 0.06) w.kind = 'lens';
      else if (Math.abs(n.x) > 0.6) w.kind = 'side';
      else if (Math.abs(n.y) > 0.975 && w.area > 0.25) w.kind = 'roof';
      // (a panoramic roof curves down at its ends: still the roof while it is over the cabin, not the rear window)
      else if (Math.abs(n.y) > 0.8 && w.area > 0.15 && c.y > belt + 0.2 && c.z < zMid + 0.6 && c.z > zMid - 1.2) w.kind = 'roof';
      else w.kind = c.z < zMid ? 'front' : 'rear';
      w.side = w.kind === 'side' ? (c.x < 0 ? 'L' : 'R') : 'C';
      // laminated glass cracks and stays: the windscreen, and roof glass (it does not rain into the cabin)
      w.laminated = w.kind === 'front' || w.kind === 'roof';
    }
    // the two faces of one pane (separate pieces in some models) are one window
    const alias = new Map();
    for (let i = 0; i < wins.length; i++) for (let j = 0; j < i; j++) {
      const a = wins[i], b = wins[j]; if (alias.has(j) || a.kind !== b.kind) continue;
      const I = a.box.clone().intersect(b.box); if (I.isEmpty()) continue;
      const vI = I.getSize(_v), va = a.box.getSize(_w), vb = b.box.getSize(_u);
      const vol = x => Math.max(x.x, 0.01) * Math.max(x.y, 0.01) * Math.max(x.z, 0.01);
      if (vol(vI) > 0.5 * Math.min(vol(va), vol(vb))) { alias.set(i, alias.get(j) ?? j); b.box.union(a.box); b.area = Math.max(a.area, b.area); break; }
    }
    if (alias.size) for (const k in A.winOf) { const wid = A.winOf[k]; for (let i = 0; i < wid.length; i++) if (wid[i] >= 0 && alias.has(wid[i])) wid[i] = alias.get(wid[i]); }
    for (const [i] of alias) wins[i].merged = true;
  }
  A.windows = wins;
  yield;
  // the cabin from the windows
  const real = wins.filter(w => w.kind !== 'lens' && w.kind !== 'inner' && !w.merged);
  const ws = real.filter(w => w.kind === 'front').sort((a, b) => b.area - a.area)[0];
  const rw = real.filter(w => w.kind === 'rear').sort((a, b) => b.area - a.area)[0];
  const sides = real.filter(w => w.kind === 'side');
  A.zA = ws ? ws.box.min.z : wf + Math.min(0.9, d.wheelbase * 0.3);
  A.yCowl = ws ? ws.box.min.y : d.height * 0.62;
  A.zC = rw ? rw.box.max.z : wr - Math.min(0.5, d.wheelbase * 0.15);
  A.belt = sides.length ? Math.min(...sides.map(w => w.box.min.y)) : d.height * 0.62;
  A.roofY = glassBox.isEmpty() ? d.height : Math.max(glassBox.max.y + 0.02, Math.min(d.height, glassBox.max.y + 0.08));
  if (A.zC < A.zA + 0.6) A.zC = A.zA + 0.6;
  // the body's half width at the shoulder, and in general
  const xs = [], xsAll = [];
  // (the long loops over every point check the clock every 16k points too: a bus's model ran 0.4 to 0.6 s without a
  // break; perf)
  let tick = 0;
  for (let k = 0; k < E.length; k++) { if (performance.now() >= job.deadline) yield;
    if (!P[k] || E[k].role === 'glass' || E[k].role === 'far') continue;
    const p = P[k];
    for (let i = 0; i < p.length; i += 9) {
      if (++tick > 16384) { tick = 0; if (performance.now() >= job.deadline) yield; }
      const x = Math.abs(p[i]), y = p[i + 1], z = p[i + 2];
      xsAll.push(x);
      if (y > A.belt - 0.35 && y < A.belt - 0.04 && z > A.zA && z < A.zC) xs.push(x);
    }
  }
  // (sorted as a typed array: a numeric sort, several times quicker than the plain array's sort with a comparison)
  const pct = (a, q) => { if (!a.length) return 0; const s = Float32Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
  yield;
  A.hw = pct(xsAll, 0.985) || d.width / 2;
  A.hwBelt = pct(xs, 0.97) || A.hw;
  // meshes inside the cabin (seats, dashboard): they move with the crush but get no folds and no subdivision
  A.interior = E.map((e, k) => {
    if (!P[k] || e.role !== 'body') return false;
    const p = P[k]; let inn = 0, tot = 0;
    for (let i = 0; i < p.length; i += 21) { tot++; if (Math.abs(p[i]) < A.hwBelt - 0.1 && p[i + 1] > 0.22 && p[i + 1] < A.roofY - 0.06 && p[i + 2] > A.zA + 0.02 && p[i + 2] < A.zC - 0.02) inn++; }
    return tot > 0 && inn / tot > 0.7;
  });
  // the top of the body over each point (for the bonnet and boot lid)
  const GX = 24, GZ = Math.max(16, Math.ceil((box.max.z - box.min.z) / 0.1));
  const top = new Float32Array(GX * GZ).fill(-1);
  for (let k = 0; k < E.length; k++) { if (performance.now() >= job.deadline) yield;
    if (!P[k] || E[k].role === 'far' || E[k].role === 'proxy') continue;
    const p = P[k];
    for (let i = 0; i < p.length; i += 3) {
      if (++tick > 16384) { tick = 0; if (performance.now() >= job.deadline) yield; }
      const gx = clamp(Math.floor((p[i] - box.min.x) / (box.max.x - box.min.x) * GX), 0, GX - 1), gz = clamp(Math.floor((p[i + 2] - box.min.z) / (box.max.z - box.min.z) * GZ), 0, GZ - 1);
      if (p[i + 1] > top[gz * GX + gx]) top[gz * GX + gx] = p[i + 1];
    }
  }
  A.top = { GX, GZ, a: top, x0: box.min.x, x1: box.max.x, z0: box.min.z, z1: box.max.z };
  yield;
  // lamps: the player's lens meshes, or the traffic body's lamp codes
  A.lamps = [];
  for (let k = 0; k < E.length; k++) { if (performance.now() >= job.deadline) yield;
    const e = E[k];
    if (e.role === 'lamp' && P[k]) {
      const lm = /lamp_(head|tail|brake|signal|reverse)_([LRC])/.exec(e.lampName || '');
      const b = new THREE.Box3(); for (let i = 0; i < P[k].length; i += 3) b.expandByPoint(_v.set(P[k][i], P[k][i + 1], P[k][i + 2]));
      if (b.isEmpty()) continue;
      A.lamps.push({ entry: k, role: lm ? lm[1] : 'tail', side: lm ? lm[2] : 'C', center: b.getCenter(new THREE.Vector3()), r: Math.max(0.08, b.getSize(_v).length() / 2), box: b });
    }
    if (e.src.attributes._lamp && P[k]) {
      const la = e.src.attributes._lamp, groups = new Map();
      for (let i = 0; i < la.count; i++) {
        if (++tick > 16384) { tick = 0; if (performance.now() >= job.deadline) yield; }
        const code = Math.round(la.getX(i)); if (code < 1) continue;
        const fr = P[k][i * 3 + 2] < 0 ? 0 : 1, key2 = code * 2 + fr;
        let g = groups.get(key2); if (!g) groups.set(key2, g = { code, fr, b: new THREE.Box3() });
        g.b.expandByPoint(_v.set(P[k][i * 3], P[k][i * 3 + 1], P[k][i * 3 + 2]));
      }
      const ROLES = ['head', 'tail', 'brake', 'signal', 'reverse'];
      for (const g of groups.values()) A.lamps.push({ entry: k, code: g.code, role: ROLES[Math.floor((g.code - 1) / 3)] || 'tail', side: 'LRC'[(g.code - 1) % 3], center: g.b.getCenter(new THREE.Vector3()), r: Math.max(0.08, g.b.getSize(_v).length() / 2), box: g.b, front: g.fr === 0 });
    }
  }
  // bumpers: the lowest front and rear strip, up to the lamps
  const len = box.max.z - box.min.z, bd = clamp(len * 0.055, 0.16, 0.3);
  const heads = A.lamps.filter(l => l.role === 'head' && l.center.z < 0), tails = A.lamps.filter(l => (l.role === 'tail' || l.role === 'brake') && l.center.z > 0);
  const yTopF = Math.min(d.height * 0.5, heads.length ? Math.min(...heads.map(l => l.box.min.y)) - 0.01 : d.height * 0.4);
  const yTopR = Math.min(d.height * 0.5, tails.length ? Math.min(...tails.map(l => l.box.min.y)) - 0.01 : d.height * 0.42);
  A.bumpers = {
    front: { z0: box.min.z - 0.05, z1: box.min.z + bd, y0: 0.03, y1: Math.max(0.3, yTopF), front: true },
    rear: { z0: box.max.z - bd, z1: box.max.z + 0.05, y0: 0.03, y1: Math.max(0.3, yTopR), front: false },
  };
  // mirrors: what sticks out past the door under it, near the windscreen's foot (a sports car's wide hips make
  // the body's overall width no guide: the 930's mirror is 2 cm past it, the Gallardo's sits 0.8 m behind the pillar)
  A.mirrors = [];
  for (const sg of [-1, 1]) {
    const Y0 = A.belt - 0.4, Z0 = A.zA - 0.5, NY = 19, NZ = 19, g = new Float32Array(NY * NZ);
    const cell = (y, z) => { const iy = Math.floor((y - Y0) / 0.05), iz = Math.floor((z - Z0) / 0.1); return iy < 0 || iy >= NY || iz < 0 || iz >= NZ ? -1 : iy * NZ + iz; };
    const solid = k => P[k] && E[k].role !== 'far' && E[k].role !== 'proxy' && E[k].role !== 'glass' && !A.interior[k];
    for (let k = 0; k < E.length; k++) { if (performance.now() >= job.deadline) yield;
      if (!solid(k)) continue;
      const p = P[k];
      for (let i = 0; i < p.length; i += 3) { if (++tick > 16384) { tick = 0; if (performance.now() >= job.deadline) yield; } const c = cell(p[i + 1], p[i + 2]); if (c >= 0 && p[i] * sg > g[c]) g[c] = p[i] * sg; }
    }
    // the door's skin under each column (its neighbours too: a seam leaves a column empty)
    const base = new Float32Array(NZ);
    for (let iz = 0; iz < NZ; iz++) for (let iy = 1; iy <= 6; iy++) for (let dz = -1; dz <= 1; dz++) { const z = iz + dz; if (z >= 0 && z < NZ) base[iz] = Math.max(base[iz], g[iy * NZ + z]); }
    // and the body at the same height 0.2 to 0.3 m ahead and behind (a wheel arch under the wing has no skin to go by)
    const side = (iy, iz, d0, d1) => { let m = 0; for (let dy = -1; dy <= 1; dy++) for (let d = d0; d <= d1; d++) { const y = iy + dy, z = iz + d; if (y >= 0 && y < NY && z >= 0 && z < NZ) m = Math.max(m, g[y * NZ + z]); } return m; };
    const cand = new Uint8Array(NY * NZ); let best = -1, bx = 0;
    for (let iy = 5; iy < NY; iy++) for (let iz = 0; iz < NZ; iz++) {
      const c = iy * NZ + iz, ex = Math.min(g[c] - base[iz], g[c] - Math.max(side(iy, iz, -3, -2), side(iy, iz, 2, 3)));
      if (!base[iz] || ex < 0.04) continue;
      cand[c] = 1; if (ex > bx) { bx = ex; best = c; }
    }
    let b = new THREE.Box3(), cnt = 0;
    if (best >= 0) {
      // the connected cells round the one that sticks out most
      const keep = new Uint8Array(NY * NZ), st = [best]; keep[best] = 1;
      while (st.length) { const c = st.pop(), iy = (c / NZ) | 0, iz = c % NZ; for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) { const y = iy + dy, z = iz + dz; if (y < 0 || y >= NY || z < 0 || z >= NZ) continue; const n = y * NZ + z; if (cand[n] && !keep[n]) { keep[n] = 1; st.push(n); } } }
      // its edges (the stalk, the rim of the housing) stand out less: two rings more where it is past the door
      for (let r = 0; r < 2; r++) {
        const add = [];
        for (let c = 0; c < NY * NZ; c++) { if (!keep[c]) continue; const iy = (c / NZ) | 0, iz = c % NZ; for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) { const y = iy + dy, z = iz + dz; if (y < 4 || y >= NY || z < 0 || z >= NZ) continue; const n = y * NZ + z; if (!keep[n] && base[z] && g[n] - base[z] > 0.02) add.push(n); } }
        for (const n of add) keep[n] = 1;
      }
      let inner = Infinity;
      for (let k = 0; k < E.length; k++) { if (performance.now() >= job.deadline) yield;
        if (!solid(k)) continue;
        const p = P[k];
        for (let i = 0; i < p.length; i += 3) { if (++tick > 16384) { tick = 0; if (performance.now() >= job.deadline) yield; } const c = cell(p[i + 1], p[i + 2]); if (c < 0 || !keep[c] || p[i] * sg < base[c % NZ] + 0.015) continue; b.expandByPoint(_v.set(p[i], p[i + 1], p[i + 2])); cnt++; inner = Math.min(inner, base[c % NZ]); }
      }
      const sz = b.getSize(_a);
      if (cnt < 6 || sz.z > 0.5 || sz.y > 0.4 || sz.x > 0.4) cnt = 0;
      else if (sg < 0) b.max.x = -(inner + 0.01); else b.min.x = inner + 0.01; // the stalk's root stays on the door
    }
    if (!cnt) {
      // the old way: past the shoulder near the windscreen's foot
      b = new THREE.Box3();
      for (let k = 0; k < E.length; k++) { if (performance.now() >= job.deadline) yield;
        if (!P[k] || E[k].role === 'far' || E[k].role === 'proxy' || E[k].role === 'glass') continue;
        const p = P[k];
        for (let i = 0; i < p.length; i += 3) {
          if (++tick > 16384) { tick = 0; if (performance.now() >= job.deadline) yield; }
          const x = p[i], y = p[i + 1], z = p[i + 2];
          if (x * sg < A.hwBelt + 0.035 || y < A.belt - 0.15 || y > A.belt + 0.45 || z < A.zA - 0.35 || z > A.zA + 0.6) continue;
          b.expandByPoint(_v.set(x, y, z)); cnt++;
        }
      }
      if (cnt < 6 || b.max.x - b.min.x >= 0.4) cnt = 0;
      else if (sg < 0) b.max.x = -(A.hwBelt - 0.03); else b.min.x = A.hwBelt - 0.03;
    }
    if (cnt) { b.expandByScalar(0.015); A.mirrors.push({ side: sg < 0 ? 'L' : 'R', box: b }); }
  }
  // a bus's or a truck's mirrors: big heads on arms out past the cab's sides, up high, round the windscreen
  if (A.mirrors.length < 2 && d.height > 2.2) {
    for (const sg of [-1, 1]) {
      if (A.mirrors.some(m => (m.side === 'L') === (sg < 0))) continue;
      const xs = [];
      for (let k = 0; k < E.length; k++) {
        if (performance.now() >= job.deadline) yield;
        if (!P[k] || E[k].role === 'far' || E[k].role === 'proxy') continue;
        const p = P[k];
        for (let i = 0; i < p.length; i += 3) { if (++tick > 16384) { tick = 0; if (performance.now() >= job.deadline) yield; } const y = p[i + 1], z = p[i + 2]; if (y > 1.0 && y < A.roofY - 0.2 && z > A.zA + 0.3 && z < A.zA + 1.5 && p[i] * sg > 0) xs.push(p[i] * sg); }
      }
      if (xs.length < 20) continue;
      xs.sort((a, b) => a - b);
      const ref = xs[Math.floor(xs.length * 0.9)];
      const b = new THREE.Box3(); let cnt = 0;
      for (let k = 0; k < E.length; k++) {
        if (performance.now() >= job.deadline) yield;
        if (!P[k] || E[k].role === 'far' || E[k].role === 'proxy') continue;
        const p = P[k];
        for (let i = 0; i < p.length; i += 3) { if (++tick > 16384) { tick = 0; if (performance.now() >= job.deadline) yield; } const x = p[i], y = p[i + 1], z = p[i + 2]; if (y > 1.0 && z < A.zA + 0.6 && x * sg > ref + 0.05) { b.expandByPoint(_v.set(x, y, z)); cnt++; } }
      }
      const sz = b.getSize(_a);
      if (cnt < 6 || sz.x > 0.8 || sz.y > 1.5 || sz.z > 2.0) continue;
      if (sg < 0) b.max.x = -(ref + 0.03); else b.min.x = ref + 0.03;
      b.expandByScalar(0.015);
      A.mirrors.push({ side: sg < 0 ? 'L' : 'R', box: b });
    }
  }
  // the side's profile: how far out the body reaches at each height (a wall scrapes the widest parts first)
  {
    const NB = 40, top = A.roofY, prof = new Float32Array(NB);
    for (let k = 0; k < E.length; k++) { if (performance.now() >= job.deadline) yield;
      if (!P[k] || E[k].role === 'far' || E[k].role === 'proxy' || E[k].role === 'glass' || A.interior[k]) continue;
      const p = P[k];
      for (let i = 0; i < p.length; i += 6) {
        if (++tick > 16384) { tick = 0; if (performance.now() >= job.deadline) yield; }
        const x = Math.abs(p[i]), y = p[i + 1], z = p[i + 2];
        if (y < 0.1 || y > top || z < box.min.z + 0.25 || z > box.max.z - 0.25) continue;
        if (A.mirrors.some(m => m.box.containsPoint(_v.set(p[i], y, z)))) continue;
        const b = Math.min(NB - 1, Math.floor(y / top * NB));
        if (x > prof[b]) prof[b] = x;
      }
    }
    A.side = { NB, top, prof };
  }
  yield;
  // doors: from the side windows (each door has one) unless the car's spec says
  A.doors = doorsFrom(rd, A, sides);
  A.ms = Math.round(performance.now() - T0);
  ANALYSIS.set(key, A);
  return A;
}

function doorsFrom(rd, A, sides) {
  const spec = rd.spec || {}, d = rd.rig.dims, R = A.wheelR;
  if (Array.isArray(spec.doors) && spec.doors.length) {
    const list = spec.doors.map(s => {
      const b = new THREE.Box3(new THREE.Vector3().fromArray(s.box[0]), new THREE.Vector3().fromArray(s.box[1]));
      const side = s.side || (b.getCenter(_v).x < 0 ? 'L' : 'R');
      return { side, front: (b.min.z + b.max.z) / 2 < (rd.rig.wheels && rd.rig.wheels[0] ? (rd.rig.wheels[0].pos.z + rd.rig.wheels[2].pos.z) / 2 : 0), hinge: new THREE.Vector3().fromArray(s.hinge), axis: new THREE.Vector3().fromArray(s.axis || [0, side === 'L' ? -1 : 1, 0]).normalize(), open: s.open ?? 65, box: b, test: (x, y, z) => x >= b.min.x && x <= b.max.x && y >= b.min.y && y <= b.max.y && z >= b.min.z && z <= b.max.z };
    });
    // boxes on one side that overlap along the car: each stops where the one behind it starts
    for (const sd of ['L', 'R']) {
      const on = list.filter(o => o.side === sd).sort((a, b) => a.box.min.z - b.box.min.z);
      for (let i = 0; i + 1 < on.length; i++) if (on[i].box.max.z > on[i + 1].box.min.z - 0.005) on[i].box.max.z = Math.max(on[i].box.min.z + 0.2, on[i + 1].box.min.z - 0.005);
    }
    return list;
  }
  if (d.length > 7.5) return []; // buses and trucks: their own doors come from the spec
  const out = [];
  for (const sd of ['L', 'R']) {
    const sg = sd === 'L' ? -1 : 1;
    const list = sides.filter(w => w.side === sd && w.box.max.z - w.box.min.z > 0.3 && w.box.min.y < A.belt + 0.15).sort((a, b) => a.box.min.z - b.box.min.z);
    const doorWins = [];
    for (const w of list) {
      const cz = (w.box.min.z + w.box.max.z) / 2;
      // a rear quarter window over the rear wheel is not a door
      if (doorWins.length && cz > A.zRA - 0.3) continue;
      if (doorWins.length >= 2) break;
      doorWins.push(w);
    }
    if (!doorWins.length) {
      // no side glass found: one door between the wheels
      doorWins.push({ box: new THREE.Box3(new THREE.Vector3(0, A.belt, A.zFA + R + 0.15), new THREE.Vector3(0, A.roofY - 0.05, A.zFA + R + 1.1)) });
    }
    doorWins.forEach((w, i) => {
      const frontDoor = i === 0;
      const zf = frontDoor ? Math.max(A.zFA + R * 1.1, w.box.min.z - 0.1) : w.box.min.z - 0.03;
      let zr = w.box.max.z + 0.03;
      const next = doorWins[i + 1];
      if (next) zr = Math.min(zr, next.box.min.z - 0.05);
      const y0 = Math.max(0.16, R * 0.85), y1 = Math.min(A.roofY - 0.02, w.box.max.y + 0.035);
      const xin = Math.max(A.hwBelt - 0.3, (w.box ? Math.min(Math.abs(w.box.min.x), Math.abs(w.box.max.x)) : A.hwBelt) - 0.16);
      const archTop = R * 2 + 0.06;
      const zfLow = Math.max(zf, A.zFA + R + 0.06), zrLow = Math.min(zr, A.zRA - R - 0.03);
      const test = (x, y, z) => {
        if (x * sg < xin || y < y0 || y > y1) return false;
        if (y < archTop) return z > zfLow && z < zrLow;
        return z > zf && z < zr;
      };
      const hx = sg * (A.hwBelt - 0.02);
      out.push({ side: sd, front: frontDoor, hinge: new THREE.Vector3(hx, (y0 + y1) / 2, zf + 0.03), axis: new THREE.Vector3(0, sg, 0), open: 66,
        box: new THREE.Box3(new THREE.Vector3(sd === 'L' ? -A.hw - 0.2 : xin, y0, zf), new THREE.Vector3(sd === 'L' ? -xin : A.hw + 0.2, y1, zr)), test });
    });
  }
  // the order is front left, front right, rear left, rear right
  const fl = out.filter(o => o.front && o.side === 'L'), fr = out.filter(o => o.front && o.side === 'R'), rl = out.filter(o => !o.front && o.side === 'L'), rr = out.filter(o => !o.front && o.side === 'R');
  return [...fl, ...fr, ...rl, ...rr];
}

// ---------------------------------------------------------------------------------------------------------
// one car's damage

const BROKEN_LENS = new THREE.MeshStandardMaterial({ name: 'damage_broken_lens', color: 0x8c9096, roughness: 0.32, metalness: 0.85 });
// what is behind the grille (the models are hollow): radiator fins, the engine, the dark of the bay
let _finTex = null;
function finTexture() {
  if (_finTex) return _finTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#5c5f62'; g.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 64; y += 4) { g.fillStyle = y % 8 ? '#7d8084' : '#979a9e'; g.fillRect(0, y, 64, 2); }
  for (let x = 0; x < 64; x += 16) { g.fillStyle = '#2e3032'; g.fillRect(x, 0, 2, 64); }
  _finTex = new THREE.CanvasTexture(c); _finTex.wrapS = _finTex.wrapT = THREE.RepeatWrapping; _finTex.repeat.set(6, 3); _finTex.colorSpace = THREE.SRGBColorSpace;
  return _finTex;
}
const BAY_FINS = new THREE.MeshStandardMaterial({ name: 'damage_radiator', color: 0xffffff, roughness: 0.6, metalness: 0.3, map: finTexture() });
const BAY_ENGINE = new THREE.MeshStandardMaterial({ name: 'damage_engine', color: 0x2a2b2d, roughness: 0.5, metalness: 0.7 });
const BAY_DARK = new THREE.MeshStandardMaterial({ name: 'damage_bay', color: 0x45474a, roughness: 0.95, metalness: 0.0, envMapIntensity: 0.35, side: THREE.BackSide });
// an engine bay's parts, coloured per part (plastic, aluminium, rubber, the coolant tank, the white absorber)
const BAY_PARTS = new THREE.MeshStandardMaterial({ name: 'damage_bay_parts', vertexColors: true, roughness: 0.6, metalness: 0.1, envMapIntensity: 0.6 });
// a curtain airbag: pale grey nylon, a little see-through
const CURTAIN = new THREE.MeshStandardMaterial({ name: 'damage_curtain', color: 0x9ea6a1, roughness: 0.9, metalness: 0, transparent: true, opacity: 0.94, side: THREE.DoubleSide, depthWrite: false });
CURTAIN.forceSinglePass = true; // (both faces in one draw: three.js otherwise draws it twice and looks its program up before each, every frame, perf)
const BAG = new THREE.MeshStandardMaterial({ name: 'damage_airbag', color: 0xcfcec8, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
let _bagGeo = null, _curtainGeo = null;
function bagGeometry() {
  // a sphere puckered by its seams and folds: a bag just after it fired
  if (_bagGeo) return _bagGeo;
  const g = new THREE.IcosahedronGeometry(1, 4), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.06 * Math.sin(x * 11 + y * 3) * Math.cos(z * 9 - x * 4) + 0.04 * Math.sin(y * 17 + z * 5);
    p.setXYZ(i, x * k, y * k, z * k * 0.55);
  }
  g.computeVertexNormals();
  return (_bagGeo = g);
}
function curtainGeometry() {
  // a long quilted panel: puffy cells in a row
  if (_curtainGeo) return _curtainGeo;
  const g = new THREE.PlaneGeometry(1, 1, 36, 6), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const puff = Math.max(0, Math.sin((x + 0.5) * Math.PI * 9)) * Math.sin((y + 0.5) * Math.PI) * 0.06;
    p.setZ(i, puff);
  }
  g.computeVertexNormals();
  return (_curtainGeo = g);
}
const BROKEN_GLOW = new Set();

class CarDamage {
  constructor(mgr, rig) {
    this.mgr = mgr; this.rig = rig; this.npc = !!rig.npc; this.spec = rig.spec || {};
    this.root = rig.object;
    this.entries = null; this.A = null;
    this.damaged = false; this.parts = new Map(); this.doors = [];
    this.windows = null; this.queue = [];
    this.crushTotal = 0; this.front = 0; this.rear = 0; this.left = 0; this.right = 0; this.roof = 0;
    this.engine = 0; this.bonnetH = 0; this.bootH = 0; this.cracks = {}; this.bonnetApex = rnd(0.5, 0.62); this.bonnetSkew = rnd(-0.25, 0.25);
    this.hard = null; this.atlas = null; this.crack = null; this.mats = null;
    this.lampsBroken = new Set(); this.wheels = [{}, {}, {}, {}];
    this.scrapeT = 0; this.lastImpact = 0;
    this.stamps = [];
  }

  get mass() { return this.spec.mass || 1500; }
  // work that can wait a frame or two (cutting a part out of the body), in the manager's queue
  later(key, fn) {
    if (!this.pending) this.pending = new Set();
    if (this.pending.has(key)) return;
    this.pending.add(key);
    const self = this;
    // fn(job) may hand back a generator (a part cut out over several frames)
    this.mgr.jobs.push(makeJob(this, function* (job) { try { const r = fn(job); if (r && typeof r.next === 'function') yield* r; } finally { if (self.pending) self.pending.delete(key); } }));
  }
  curFront() {
    let m = Infinity;
    for (const e of this.list()) { if (e.role !== 'paint' && e.role !== 'body') continue; if (e.mesh.userData.dmgBay) continue; const c = e.cur; if (!c) { m = Math.min(m, e.box.min.z); continue; } for (let i = 2; i < c.length; i += 15) if (c[i] < m) m = c[i]; }
    return Number.isFinite(m) ? m : this.A.box.min.z;
  }
  // a window's state on this car (the analysis is shared by every car of the model)
  ws(w) { if (!this.winState) this.winState = new Map(); let s = this.winState.get(w.id); if (!s) this.winState.set(w.id, s = {}); return s; }

  list() {
    if (this.entries) return this.entries;
    const E = this.entries = [];
    this.root.updateMatrixWorld(true);
    // the car's own model only (people sitting in it hang from the same object, and are not the car)
    const rig = this.rig, roots = this.root.children.filter(c => c === rig.model || c === rig.lod || c.name === 'shadow_proxy' || c.isLOD);
    if (!roots.length) roots.push(this.root);
    for (const R of roots) R.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.name === 'contact_shadow' || o.userData.dmgPart || o.userData.person) return;
      let a = o, lamp = '', far = false;
      while (a && a !== this.root) { if (SKIP_ANCESTOR.test(a.name)) return; if (/^lamp_/.test(a.name)) lamp = a.name; if (a.name === 'far') far = true; a = a.parent; }
      if (!o.geometry || !o.geometry.attributes.position) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      let role = 'body';
      if (o.name === 'shadow_proxy') role = 'proxy';
      else if (far) role = 'far';
      else if (lamp) role = 'lamp';
      else if (mats.some(m => m && m.name === 'glass')) role = 'glass';
      else if (mats.some(m => m && (m.name === 'paint' || UNIFORMS.has(m) && !('uCrack' in UNIFORMS.get(m))))) role = 'paint';
      const e = new Entry(this, o, role);
      e.lampName = lamp;
      E.push(e);
    });
    return E;
  }
  analysis() { if (!this.A) { this.list(); this.A = analyse(this); } return this.A; }

  // the materials this car's damage draws on: the player's own, or copies for a traffic car
  materials() {
    if (this.mats) return this.mats;
    const M = this.mats = { paint: [], glass: [], copies: new Map() };
    const rig = this.rig;
    for (const e of this.list()) {
      const list = Array.isArray(e.mesh.material) ? e.mesh.material : [e.mesh.material];
      const fix = m => {
        if (!m || !UNIFORMS.has(m)) return m;
        const U = UNIFORMS.get(m), glass = 'uCrack' in U;
        if (!this.npc && !e.rd.sharedMat(m)) { (glass ? M.glass : M.paint).includes(m) || (glass ? M.glass : M.paint).push(m); return m; }
        let c = M.copies.get(m);
        if (!c) { c = ownCopy(m, glass ? 'glass' : 'paint'); M.copies.set(m, c); (glass ? M.glass : M.paint).push(c); }
        return c;
      };
      const out = list.map(fix);
      e.mesh.material = Array.isArray(e.mesh.material) ? out : out[0];
    }
    // the traffic body swaps its paint by colour through setPaint: keep this car's copy on
    if (this.npc && rig._paintMeshes) {
      const orig = rig.setPaint.bind(rig);
      this._setPaint = rig.setPaint;
      rig.setPaint = c => { orig(c); this.mats = null; this.materials(); this.applyUniforms(); };
    }
    return M;
  }
  sharedMat(m) { return this.npc || this.mgr.shared.has(m); }

  // the damage atlas (and the uniforms that map it)
  atlasReady() {
    if (this.atlas) return this.atlas;
    const A = this.analysis(), b = A.box;
    const Wd = this.npc ? 512 : 2048, Ht = Wd / 2;
    const L = b.max.z - b.min.z + 0.1, Wm = b.max.x - b.min.x + 0.1, H = b.max.y - b.min.y + 0.1;
    const s = Math.min((Wd - 8) / Math.max(2 * L, L + 2 * Wm), (Ht - 6) / (H + Math.max(Wm, H)));
    const rt = this.mgr.stamper.target(Wd, Ht);
    const off = { L: [2, 2], R: [L * s + 4, 2], T: [2, H * s + 4], F: [L * s + 4, H * s + 4], B: [L * s + Wm * s + 6, H * s + 4] };
    this.atlas = { rt, s, W: Wd, H: Ht, min: new THREE.Vector3(b.min.x - 0.05, b.min.y - 0.05, b.min.z - 0.05), off };
    this.applyUniforms();
    return this.atlas;
  }
  applyUniforms() {
    const at = this.atlas, M = this.materials();
    // every mesh in a damaged paint needs the attributes the paint reads (without them the shader reads whatever
    // the GPU's default for that attribute slot is)
    if (at) for (const e of this.list()) { if (e.cur || e.role === 'proxy' || e.role === 'glass') continue; if (e.isPaint()) e.own(); }
    for (const m of M.paint) {
      const U = UNIFORMS.get(m); if (!U || !at) continue;
      U.uDmgMap.value = at.rt.texture; U.uDmgOn.value = 1;
      U.uDmgA.value.set(at.min.x, at.min.y, at.min.z, 0);
      U.uDmgS.value.set(at.s / at.W, at.s / at.H);
      const o = at.off, f = (p, i) => p[i] / (i === 0 ? at.W : at.H);
      U.uDmgO1.value.set(f(o.L, 0), f(o.L, 1), f(o.R, 0), f(o.R, 1));
      U.uDmgO2.value.set(f(o.T, 0), f(o.T, 1), f(o.F, 0), f(o.F, 1));
      U.uDmgO3.value.set(f(o.B, 0), f(o.B, 1));
    }
    if (this.crack) for (const m of M.glass) { const U = UNIFORMS.get(m); if (U) { U.uCrack.value = this.crack.tex; U.uDmgOn.value = 1; } }
  }
  // a point of the car (car frame) on one face of the atlas, in pixels
  atlasPx(face, x, y, z) {
    const at = this.atlas, o = at.off[face], m = at.min, s = at.s;
    if (face === 'L' || face === 'R') return [o[0] + (z - m.z) * s, o[1] + (y - m.y) * s];
    if (face === 'T') return [o[0] + (z - m.z) * s, o[1] + (x - m.x) * s];
    return [o[0] + (x - m.x) * s, o[1] + (y - m.y) * s];
  }
  // a scratch from a to b (car frame) facing n, half width hw (m); val: [metal, primer, scuff, dirt]
  scratch(a, b, n, hw, val, kind = 0, seed = Math.random() * 100) {
    this.atlasReady();
    const faces = [];
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    if (ax > 0.3) faces.push([n.x < 0 ? 'L' : 'R', ax]);
    if (ay > 0.3) faces.push(['T', ay]);
    if (az > 0.3) faces.push([n.z < 0 ? 'F' : 'B', az]);
    for (const [f, wgt] of faces) {
      const p = this.atlasPx(f, a.x, a.y, a.z), q = this.atlasPx(f, b.x, b.y, b.z);
      const k = Math.min(1, wgt * 1.3);
      this.stamps.push(p[0], p[1], q[0], q[1], val[0] * k, val[1] * k, val[2] * k, val[3] * k, Math.max(0.8, hw * this.atlas.s), kind, seed);
    }
    this.damaged = true;
  }
  flushStamps() {
    if (!this.stamps.length || !this.atlas) return;
    // a scratch line about a centimetre and a half across, whatever the map's scale
    this.mgr.stamper.mat.uniforms.uLane.value = Math.max(1.6, 0.015 * this.atlas.s);
    this.mgr.stamper.draw(this.atlas.rt, this.stamps);
    this.stamps.length = 0;
  }

  // the crack map for the glass: a canvas with a slot per window
  crackReady() {
    if (this.crack) { if (this.crack.fresh) { this.crack.fresh = false; this.applyUniforms(); } return this.crack; }
    const A = this.analysis();
    const S = this.npc ? 256 : 512, c = document.createElement('canvas'); c.width = c.height = S;
    // a canvas kept in memory (an accelerated one is read back from the graphics card to upload: a fifth of a second)
    const g = c.getContext('2d', { willReadFrequently: true }); g.clearRect(0, 0, S, S);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.NoColorSpace; tex.flipY = false; tex.premultiplyAlpha = true;
    const slots = new Map(); let sx = 0, sy = S / 2, big = S / 2, small = S / 4;
    const order = A.windows.filter(w => !w.merged && w.kind !== 'inner').sort((a, b) => (b.kind === 'front') - (a.kind === 'front') || b.area - a.area);
    let next = 0;
    const free = [];
    for (let y = 0; y < S; y += small) for (let x = 0; x < S; x += small) if (!(x < big && y < big)) free.push([x, y]);
    for (const w of order) {
      if (w.kind === 'front' && !slots.size) slots.set(w.id, [0, 0, big, big]);
      else if (next < free.length - 1) { const f = free[next++]; slots.set(w.id, [f[0], f[1], small, small]); }
    }
    this.crack = { canvas: c, g, tex, slots, S };
    this.applyUniforms();
    return this.crack;
  }
  // _guv for a glass entry's vertices: where on its window's slot each falls
  glassUV(e) {
    const A = this.analysis(), C = this.crackReady();
    const n = e.cur.length / 3, uv = new Float32Array(n * 2), S = C.S;
    for (let i = 0; i < n; i++) {
      const w = e.win ? e.win[i] : -1, W = w >= 0 ? A.windows[w] : null, sl = W ? C.slots.get(W.id) : null;
      if (!sl) { uv[i * 2] = (S - 0.5) / S; uv[i * 2 + 1] = (S - 0.5) / S; continue; }
      _v.set(e.rest[i * 3] - W.center.x, e.rest[i * 3 + 1] - W.center.y, e.rest[i * 3 + 2] - W.center.z);
      const u = (_v.dot(W.U) - W.u0) / Math.max(1e-3, W.u1 - W.u0), v = (_v.dot(W.V) - W.v0) / Math.max(1e-3, W.v1 - W.v0);
      uv[i * 2] = (sl[0] + 2 + clamp(u, 0, 1) * (sl[2] - 4)) / S; uv[i * 2 + 1] = (sl[1] + 2 + clamp(v, 0, 1) * (sl[3] - 4)) / S;
    }
    const at = new THREE.BufferAttribute(uv, 2);
    if (e.geo.attributes._guv) e.owned.delete(e.geo.attributes._guv);
    e.geo.setAttribute('_guv', at); e.owned.add(at);
  }
  ownGlass(e) {
    if (e.geo && e.win) return;
    e.own();
    const A = this.analysis(), k = this.entries.indexOf(e), src = A.winOf[k];
    if (src && !e.win) { e.win = new Int16Array(e.cur.length / 3); e.win.set(src.subarray(0, Math.min(src.length, e.win.length))); }
    this.glassUV(e);
  }

  // the stiffness of the structure at a point (car frame): 1 a crumple zone, small for the cabin, sills, pillars
  compliance(x, y, z, N) {
    const A = this.A, R = A.wheelR;
    let cz;
    if (z < A.zFA - R * 0.6) cz = 1.0;
    else if (z < A.zA - 0.05) cz = 0.5;
    else if (z <= A.zC + 0.05) cz = 0.1;
    else if (z < A.zRA + R * 0.6) cz = 0.55;
    else cz = 1.0;
    const dSide = A.hw - Math.abs(x);
    let cx = dSide < 0.14 ? 0.95 : dSide < 0.3 ? 0.45 : 0.2;
    if (cz >= 1) cx = Math.max(cx, 0.75);
    if (y < 0.3) cx *= 0.35; // the sill
    const cy = y > A.belt ? 0.6 : 0.07;
    let c = N.x * N.x * cx + N.y * N.y * cy + N.z * N.z * cz;
    if (this.hard) c *= 1 - this.hardAt(x, y, z);
    return Math.max(0.025, c);
  }
  hardAt(x, y, z) {
    const H = this.hard; if (!H) return 0;
    const i = Math.floor((x - H.x0) / 0.1), j = Math.floor((y - H.y0) / 0.1), k = Math.floor((z - H.z0) / 0.1);
    if (i < 0 || j < 0 || k < 0 || i >= H.nx || j >= H.ny || k >= H.nz) return 0;
    return H.a[(k * H.ny + j) * H.nx + i];
  }
  hardAdd(x, y, z, v) {
    let H = this.hard;
    if (!H) {
      const b = this.A.box;
      H = this.hard = { x0: b.min.x - 0.3, y0: b.min.y - 0.3, z0: b.min.z - 0.3, nx: Math.ceil((b.max.x - b.min.x + 0.6) / 0.1), ny: Math.ceil((b.max.y - b.min.y + 0.6) / 0.1), nz: Math.ceil((b.max.z - b.min.z + 0.6) / 0.1) };
      H.a = new Float32Array(H.nx * H.ny * H.nz);
    }
    const i = Math.floor((x - H.x0) / 0.1), j = Math.floor((y - H.y0) / 0.1), k = Math.floor((z - H.z0) / 0.1);
    if (i < 0 || j < 0 || k < 0 || i >= H.nx || j >= H.ny || k >= H.nz) return;
    const o = (k * H.ny + j) * H.nx + i; H.a[o] = Math.min(0.9, Math.max(H.a[o], v));
  }
  topAt(x, z) {
    const t = this.A.top, gx = clamp(Math.floor((x - t.x0) / (t.x1 - t.x0) * t.GX), 0, t.GX - 1), gz = clamp(Math.floor((z - t.z0) / (t.z1 - t.z0) * t.GZ), 0, t.GZ - 1);
    return t.a[gz * t.GX + gx];
  }

  // ---- the crush: imp { P, N (car frame, N into the car), D, kind 'flat'|'pole'|'car'|'ground', r, t0, t1, b0, b1, edge }
  crush(imp) { return runSync(this.crushGen(SYNC, imp)); }
  *crushGen(job, imp) {
    const A = this.analysis(), E = this.list();
    const T0 = performance.now();
    const N = imp.N.clone().normalize(), P = imp.P;
    const T = Math.abs(N.y) < 0.8 ? new THREE.Vector3(0, 1, 0).cross(N).normalize() : new THREE.Vector3(0, 0, 1).cross(N).normalize();
    const B = N.clone().cross(T);
    const Nx = N.x, Ny = N.y, Nz = N.z, Tx = T.x, Ty = T.y, Tz = T.z, Bx = B.x, By = B.y, Bz = B.z, Px = P.x, Py = P.y, Pz = P.z;
    const D = imp.D;
    const pole = (imp.kind || 'flat') === 'pole', car = imp.kind === 'car';
    const t0 = imp.t0 ?? -Infinity, t1 = imp.t1 ?? Infinity, b0 = imp.b0 ?? -Infinity, b1 = imp.b1 ?? Infinity;
    const r = imp.r || 0.15, edge = imp.edge ?? (car ? 0.3 : 0.03);
    const w = 0.06 + 0.32 * D, iw = 1 / w;
    // how far the impactor's face is set back at (t, b) (SB_E), and how far outside its outline (SB_O)
    let SB_E = 0, SB_O = 0;
    // past the pole the sheet wraps round it at a slant: gently across a car's front (the bumper beam pulls its ends
    // back), steeply on a side (a door folds round the pole in a narrow V, as in NHTSA's side pole test)
    const poleSlope = Math.abs(N.x) > 0.6 ? 1.35 : 0.55;
    const setback = (t, b) => {
      if (pole) {
        const at = t < 0 ? -t : t;
        // (past the pole the sheet wraps round it at a slant: a beam bent round a pole pulls its ends back too)
        // (on a side, steep for 15 cm past the pole, then a long shallow slope: the door pushed in broadly round the wrap,
        // the S60 in NHTSA's side pole test)
        SB_E = at < r ? r - Math.sqrt(r * r - at * at) : poleSlope > 1 && at > r + 0.15 ? r + 0.15 * poleSlope + (at - r - 0.15) * 0.55 : r + (at - r) * poleSlope;
        SB_O = at > r ? at - r : 0;
        if (b < b0) { SB_E += (b0 - b) * 1.5; SB_O += b0 - b; } else if (b > b1) { SB_E += (b - b1) * 1.5; SB_O += b - b1; }
        return;
      }
      const dl = t < t0 ? t0 - t : t > t1 ? t - t1 : 0;
      const bo = b < b0 ? b0 - b : b > b1 ? b - b1 : 0;
      if (dl > 0 || bo > 0) { SB_O = dl > 0 && bo > 0 ? Math.sqrt(dl * dl + bo * bo) : dl + bo; SB_E = edge + SB_O * 1.2; }
      else {
        SB_O = 0;
        const dIn = Math.min(t - t0, t1 - t, b - b0, b1 - b);
        SB_E = dIn < edge ? edge - Math.sqrt(Math.max(0, edge * edge - (edge - dIn) * (edge - dIn))) : 0;
      }
      // another car's bonnet slopes back above its nose
      if (car && b > b1) SB_E += (b - b1) * 0.8;
    };
    const Dh = D * 0.5;
    // a hit on the side: the sill below and the roof rail above hold, the door between gives most
    const sideHit = Math.abs(Nx) > 0.6 && Math.abs(Ny) < 0.5, yS = 0.2, yS1 = 0.42, yB = A.belt - 0.05, yR = A.roofY;
    const hProf = y => y < yS ? 0.3 : y < yS1 ? 0.3 + 0.7 * (y - yS) / (yS1 - yS) : y < yB ? 1 : y < yR ? 1 - 0.6 * (y - yB) / Math.max(0.1, yR - yB) : 0.4;
    const reachAt = (t, b) => { setback(t, b); let core = D - SB_E, drape = SB_O < w ? Dh * (1 - SB_O * iw) : 0; if (sideHit) { const k = hProf(b + Py); core *= k; drape *= k; } return core > drape ? core : drape; };
    // the first point the impactor meets
    let s0 = Infinity;
    const boxS = e => { const b = e.cur ? (e._bb || e.box) : e.box; let m = Infinity; for (let k = 0; k < 8; k++) { const s = ((k & 1 ? b.max.x : b.min.x) - Px) * Nx + ((k & 2 ? b.max.y : b.min.y) - Py) * Ny + ((k & 4 ? b.max.z : b.min.z) - Pz) * Nz; if (s < m) m = s; } return m; };
    const byS = E.filter(e => e.role !== 'proxy' && e.role !== 'far').map(e => [boxS(e), e]).sort((a, b) => a[0] - b[0]);
    for (const [bs, e] of byS) {
      if (performance.now() >= job.deadline) yield;
      if (bs - 0.2 > s0) break;
      const p = e.cur || (e._sp || (e._sp = e.srcPositions()));
      for (let i = 0; i < p.length; i += 3) {
        if ((i % 24576) === 24573 && performance.now() >= job.deadline) yield;
        const x = p[i] - Px, y = p[i + 1] - Py, z = p[i + 2] - Pz;
        const s = x * Nx + y * Ny + z * Nz;
        if (s > s0) continue;
        setback(x * Tx + y * Ty + z * Tz, x * Bx + y * By + z * Bz);
        if (SB_E > D + 0.05) continue;
        if (s + SB_E < s0) s0 = s + SB_E;
      }
    }
    if (!Number.isFinite(s0)) return null;
    const tS0 = performance.now();
    // how the structure collapses along the push: the shortening Sh(sigma) built up from the contact inward
    const STEP = 0.01, NS = 520, Sh = new Float32Array(NS + 1);
    const lc = new THREE.Vector3(Px, Py, Pz).addScaledVector(N, s0);
    if (Math.abs(Ny) < 0.8) lc.y = clamp(Number.isFinite(b0) && Number.isFinite(b1) ? (b0 + b1) / 2 : (imp.yMid ?? A.belt * 0.65), 0.25, A.belt);
    if (performance.now() >= job.deadline) yield;
    for (let i = 1; i <= NS; i++) {
      const sg = i * STEP - STEP / 2;
      Sh[i] = Sh[i - 1] + 0.88 * this.compliance(lc.x + Nx * sg, lc.y + Ny * sg, lc.z + Nz * sg, N) * STEP;
    }
    const total = Sh[NS] * 0.92;
    const Dc = Math.min(D, total);
    const shAt = sg => { if (sg <= 0) return sg; const f = sg / STEP; if (f >= NS) return Sh[NS] + (sg - NS * STEP) * 0.02; const i = f | 0; return Sh[i] + (Sh[i + 1] - Sh[i]) * (f - i); };
    // how soft the structure is at a depth (crumple zone 1, engine bay a half, cabin a tenth): where it gives, it folds
    const cAt = sg => { if (sg <= 0) return 1; const f = sg / STEP; if (f >= NS) return 0.02; const i = f | 0; return (Sh[i + 1] - Sh[i]) / STEP; };
    const front = R => { if (R <= 0) return 0; let lo = 0, hi = NS; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (Sh[m] < R) lo = m; else hi = m; } return hi * STEP; };
    const sigMax = front(Dc) + 0.1;
    const lam = rnd(0.16, 0.25), phase = Math.random() * 10, seed = Math.random() * 100;
    // folds bulge out from the car's core line along the push
    const cx0 = 0, cy0 = A.belt * 0.6, cz0 = (A.zA + A.zC) / 2;
    // the bonnet (or boot lid) buckling up: how much shorter it gets
    const frontHit = Nz > 0.6, rearHit = Nz < -0.6;
    // the wings' painted skin (above the bumper, out at the sides) never tears in a front or rear crush
    const wingTop = Math.max(A.bumpers.front.y1, A.bumpers.rear.y1);
    const wingKeep = (x, y, z) => (frontHit || rearHit) && (x < 0 ? -x : x) > A.hw * 0.5 && y > wingTop - 0.02;
    // the wings between the front wheels and the windscreen pillars buckle out and up in a hard frontal (the
    // structure behind them is pushed back: NHTSA's 56 km/h cars show the wing kinked over and behind the wheel)
    const wingAmp = frontHit && Math.abs(Ny) < 0.5 && !this.npc ? 0.07 * clamp((Dc - 0.25) / 0.3, 0, 1) - (this.wingDone || 0) : 0;
    const wz0 = A.zFA - A.wheelR * 0.3, wz1 = A.zA - 0.05, wy0 = A.wheelR * 1.15, wy1 = A.belt + 0.04;
    if (wingAmp > 0.005) this.wingDone = (this.wingDone || 0) + wingAmp;
    let bulgeAdd = 0, bz = null;
    if ((frontHit || rearHit) && Math.abs(Ny) < 0.5) {
      const zEdge = frontHit ? A.box.min.z + 0.12 : A.box.max.z - 0.12, zEnd = frontHit ? A.zA : A.zC;
      const len = Math.abs(zEnd - zEdge);
      const yT = this.topAt(0, zEdge);
      const x = -Px, y = yT - Py, z = zEdge - Pz;
      const sg = x * Nx + y * Ny + z * Nz - s0;
      const R = Math.min(reachAt(x * Tx + y * Ty + z * Tz, x * Bx + y * By + z * Bz), Dc), u = Math.max(0, R - shAt(sg));
      const prev = frontHit ? this.bonnetH : this.bootH;
      const sh = (frontHit ? this.front : this.rear) + u;
      const h = Math.min(len * 0.45, 1.0 * Math.sqrt(Math.max(0, (len / 2) ** 2 - ((len - Math.min(sh, len * 0.8)) / 2) ** 2)));
      if (h > prev + 0.002) bulgeAdd = h - prev;
      bz = { zEdge, zEnd, len, frontHit, apex: this.bonnetApex, skew: this.bonnetSkew + (Px / Math.max(0.5, A.hw)) * 0.2 };
      if (frontHit) { this.bonnetH = Math.max(prev, h); this.front = sh; } else { this.bootH = Math.max(prev, h); this.rear = sh; }
      // past 0.4 m the lid's catch and hinges give: its front edge stands 15 to 25 cm off the grille, folded back,
      // higher on one side (the XC90 after NHTSA's 56 km/h)
      if (frontHit && !this.npc) {
        const want = 0.2 * clamp((sh - 0.38) / 0.12, 0, 1);
        bz && (bz.edgeAdd = Math.max(0, want - (this.lidEdge || 0)));
        if (bz && bz.edgeAdd > 0.003) { this.lidEdge = (this.lidEdge || 0) + bz.edgeAdd; if (!bulgeAdd) bulgeAdd = 1e-6; }
        // and past 0.45 m the front third folds right back (once)
        if (bz && Dc > 0.45 && !this.lidFolded) { this.lidFolded = true; bz.fold = 1.95; bz.edgeAdd = Math.max(bz.edgeAdd || 0, 0.004); if (!bulgeAdd) bulgeAdd = 1e-6; }
      }
      if (!bulgeAdd) bz = null;
    }
    // the lowest top over the lid's stretch: anything under it is not on the lid (most points, quickly)
    let topMin = Infinity;
    if (bz) { const t = A.top; for (let gz = 0; gz < t.GZ; gz++) { const z = t.z0 + (gz + 0.5) / t.GZ * (t.z1 - t.z0); if (bz.frontHit ? (z > bz.zEnd || z < bz.zEdge - 0.25) : (z < bz.zEnd || z > bz.zEdge + 0.25)) continue; for (let gx = 2; gx < t.GX - 2; gx++) { const v = t.a[gz * t.GX + gx]; if (v > 0 && v < topMin) topMin = v; } } }
    const inBulge = (x, y, z) => {
      if (!bz || y < topMin - 0.1) return false;
      if (bz.frontHit ? (z > bz.zEnd || z < bz.zEdge - 0.25) : (z < bz.zEnd || z > bz.zEdge + 0.25)) return false;
      return y > this.topAt(x, z) - 0.09 && Math.abs(x) < A.hw - 0.04;
    };
    // where vertices will move: refine there first (where meshes are coarse)
    const willMove = (X, Y, Z) => {
      const x = X - Px, y = Y - Py, z = Z - Pz;
      const sg = x * Nx + y * Ny + z * Nz - s0;
      if (sg > sigMax) return inBulge(X, Y, Z);
      const R = Math.min(reachAt(x * Tx + y * Ty + z * Tz, x * Bx + y * By + z * Bz), Dc);
      return R > 0.006 && sg < front(R) + 0.05;
    };
    const near = [];
    for (const e of E) if (this.boxNear(e, P, N, s0, sigMax + 0.2, bz)) near.push(e);
    // the outside first (what is seen), then the inside and the shadow's stand-in
    const rank = e => e.role === 'paint' ? 0 : e.role === 'lamp' || e.role === 'glass' ? 2 : e.role === 'body' ? (A.interior && A.interior[this.entries.indexOf(e)] ? 3 : 1) : 4;
    near.sort((a, b) => rank(a) - rank(b));
    const res = { windows: new Map(), maxU: 0, uAt: null };
    const foldMax = Math.min(0.12, 0.22 * Math.min(Dc, 0.55)) * (Math.abs(Nz) > 0.6 ? 0.6 : 1);
    const frontal = Math.abs(Nz) > 0.6 && Math.abs(Ny) < 0.5;
    const stats = { own: 0, refine: 0, move: 0, normals: 0, newVerts: 0, zone: 0, moved: 0, prof: this.mgr.prof ? [] : null };
    // the work: each mesh subdivided where it bends, its points moved, its normals again; it yields whenever the
    // frame's time is up, so a crash is spread over frames and never holds one up (the outside first)
    const self = this;
    function* work(job, which) {
      // every mesh's points first (the crush shows within a few frames), then their normals (the slow part)
      const later = [];
      for (const e of near) {
        const rk = rank(e);
        if ((which === 'out' && rk > 2) || (which === 'in' && rk <= 2)) continue;
        const te = performance.now();
        // (the cabin's trim and the engine bay box move with the crush but take no folds)
        const inner = (A.interior && A.interior[self.entries.indexOf(e)]) || !!e.mesh.userData.dmgBay;
        if (e.role === 'glass') self.ownGlass(e); else e.own();
        if (performance.now() >= job.deadline) yield;
        // every outside mesh split where this crush moves it (a mesh fine on average can still have long triangles
        // across a door or a bonnet: moved at one corner, they made flat facets and dark streaks, and no crease)
        if (e.role !== 'proxy' && e.role !== 'far' && !inner) {
          const before = e.cur.length, tr = performance.now(); yield* refineGen(job, e, willMove, e.L, self.npc ? 2 : 4, true); stats.newVerts += (e.cur.length - before) / 3; stats.refine += performance.now() - tr;
        }
        let tm = performance.now();
        const c = e.cur, rest = e.rest, n = c.length / 3;
        const dirty = new Uint8Array(n);
        const glass = e.role === 'glass';
        let any = false, maxU = 0, lidF = null;
        for (let i = 0; i < n; i++) {
          if ((i & 1023) === 1023 && performance.now() >= job.deadline) { stats.move += performance.now() - tm; yield; tm = performance.now(); }
          const i3 = i * 3, X = c[i3], Y = c[i3 + 1], Z = c[i3 + 2];
          const x = X - Px, y = Y - Py, z = Z - Pz;
          const sg = x * Nx + y * Ny + z * Nz - s0;
          let dx = 0, dy = 0, dz = 0;
          if (sg < sigMax) {
            stats.zone++;
            const t = x * Tx + y * Ty + z * Tz, b = x * Bx + y * By + z * Bz;
            let R = reachAt(t, b); if (R > Dc) R = Dc;
            if (R > 0.002) {
              let u = R - shAt(sg);
              if (u > 0) {
                const rx = rest[i3], ry = rest[i3 + 1], rz = rest[i3 + 2];
                // (the folds go with how much the metal there gave: a cabin pushed back whole does not crinkle)
                const lid = (bulgeAdd > 0 && !glass && !inner && inBulge(rx, ry, rz)) || (frontal && !glass && (rx < 0 ? -rx : rx) < A.hw * 0.42 && ry > A.bumpers.front.y1 - 0.06 && ry < A.yCowl && rz < A.box.min.z + 0.35);
                const env = Math.min(1, u * 25) * Math.min(1, R * 16) * clamp(cAt(sg) * 1.6, 0.15, 1) * (lid ? 0.15 : 1);
                // wrinkles in the crushed sheet
                if (!glass && !lid) u += R * (Math.abs(Nz) > 0.6 || pole ? 0.04 : 0.09) * wave(rx * 9.1 + seed + wave(ry * 7.3 + rz * 5.1) * 1.7) * wave(rz * 8.3 - ry * 4.7 + seed + 1.57) * env;
                dx = Nx * u; dy = Ny * u; dz = Nz * u;
                if (!glass && !inner && sideHit && pole) {
                  // a door wrapped round a pole: upright creases beside it, as the pole's own line (the Crown's front door
                  // folded in vertical pleats each side of the pole, the panels a hand's width away still flat)
                  const at = t < 0 ? -t : t;
                  const amp = foldMax * 0.7 * env * Math.exp(-at / 0.18) * (0.7 + 0.3 * wave(ry * 4.1 + seed));
                  const f = tri(at / (lam * 0.55) + phase + 0.12 * wave(b * 3.7 + seed)) * amp;
                  // and away from it, over the door's lower half, long creases along the door
                  const amp2 = ry < A.belt - 0.05 ? foldMax * 0.3 * env * (1 - Math.exp(-at / 0.2)) * Math.exp(-at / 0.8) : 0;
                  const f2 = amp2 > 0 ? tri(ry / (lam * 0.8) + phase * 0.7 + 0.15 * wave(t * 2.3 + seed)) * amp2 : 0;
                  dx += Nx * (f + f2); dy += Ny * (f + f2); dz += Nz * (f + f2);
                } else if (!glass && !inner && sideHit) {
                  // a side folds round the impactor in upright creases
                  const amp = foldMax * 0.7 * env * (0.6 + 0.4 * wave(ry * 4.1 + seed));
                  const f = tri(t / (lam * 1.2) + phase + 0.2 * wave(b * 5.3 + seed)) * amp;
                  dx += Nx * f; dy += Ny * f; dz += Nz * f;
                } else if (!glass && !inner) {
                  // folds across the push, out from the core line
                  let ax = X - cx0, ay = Y - cy0, az = Z - cz0;
                  const ad = ax * Nx + ay * Ny + az * Nz; ax -= Nx * ad; ay -= Ny * ad; az -= Nz * ad;
                  const al = Math.sqrt(ax * ax + ay * ay + az * az);
                  if (al > 1e-3) {
                    const amp = foldMax * env * (0.6 + 0.4 * wave(rx * 3.1 + seed) * wave(ry * 2.7 + rz * 3.3 + 1.57)) * (frontal && Math.abs(rx) > A.hw * 0.55 && ry > A.wheelR ? 1.7 : 1);
                    const ph = phase + 0.45 * wave(t * 2.3 + seed) + 0.3 * wave(b * 3.1 - t * 1.3);
                    // the sheet buckles out more than in (a crushed wing splays and stands up)
                    const f = (tri(sg / lam + ph) + 0.55) * amp / al;
                    dx += ax * f; dy += ay * f; dz += az * f;
                    // a crushed front rises and twists a little as it folds
                    if (frontal && Y > A.belt * 0.55) dy += env * Math.min(Dc, 0.6) * 0.1 * (0.6 + 0.4 * wave(rx * 2.3 + seed * 0.7));
                  }
                }
                if (u > maxU) maxU = u;
              }
            }
          }
          if (wingAmp > 0.005 && !glass && !inner) {
            const xr = rest[i3], yr = rest[i3 + 1], zr = rest[i3 + 2], ax = xr < 0 ? -xr : xr;
            if (ax > A.hw * 0.68 && yr > wy0 && yr < wy1 && zr > wz0 && zr < wz1) {
              const fz = (zr - wz0) / (wz1 - wz0), fy = (yr - wy0) / (wy1 - wy0);
              // one kink over the wheel's back and a smaller one before the pillar, strongest at the wing's top
              const k = Math.max(0, Math.sin(Math.PI * fz)) * (0.65 + 0.35 * Math.sin(Math.PI * 3 * fz + 0.6)) * (0.35 + 0.65 * fy) * Math.min(1, (ax - A.hw * 0.68) / (A.hw * 0.2));
              dx += (xr < 0 ? -1 : 1) * wingAmp * k; dy += wingAmp * 0.6 * k; dz += wingAmp * 0.3 * k;
            }
          }
          // the bonnet buckles up into a peak (the lid only, not the glass behind it)
          // (the lid's own skin only: the bay's parts under it, struts and air box, were swung up with its fold into spikes)
          if (bulgeAdd > 0 && !glass && !inner && inBulge(rest[i3], rest[i3 + 1], rest[i3 + 2])) {
            const zr = rest[i3 + 2];
            const xi = clamp(Math.abs(zr - bz.zEdge) / bz.len, 0, 1);
            const ap = clamp(bz.apex + bz.skew * (rest[i3] / Math.max(0.4, A.hw)) * 0.5, 0.2, 0.75);
            let pk = xi < ap ? xi / ap : (1 - xi) / (1 - ap);
            pk = Math.max(0, pk);
            const lat = 0.8 + 0.2 * Math.cos(Math.PI * 0.5 * clamp(rest[i3] / Math.max(0.4, A.hw), -1, 1));
            // the lid's front lifts a little too (its catch lets go)
            // (the front edge raised less than the ridge, so the lid reads as a tent from any side, not a raised plate)
            const lift = bulgeAdd * (pk * lat + (xi < 0.25 ? 0.4 * (1 - xi / 0.25) : 0));
            dy += lift;
            dz += (bz.frontHit ? -1 : 1) * lift * 0.12;
            if (bz.edgeAdd > 0) {
              if (!lidF) lidF = new Float32Array(n);
              lidF[i] = 0.001;
              if (xi < 0.4) {
                const f = 1 - xi / 0.4, side = 0.6 + 0.4 * clamp((bz.skew >= 0 ? 1 : -1) * rest[i3] / Math.max(0.4, A.hw), -1, 1);
                if (bz.fold > 0 && xi < 0.36) {
                  // turned about a line across the lid a third of the way back: up, then back over itself
                  const d = (0.36 - xi) * bz.len, th = bz.fold * (0.75 + 0.25 * side);
                  dy += d * Math.sin(th) + bz.edgeAdd * 0.5 * side; dz += (bz.frontHit ? 1 : -1) * d * (1 - Math.cos(th));
                } else { dy += bz.edgeAdd * f * f * side; dz += bz.edgeAdd * 0.45 * f * side; }
                lidF[i] = Math.max(0.001, f * side);
              }
            }
          }
          // (a front or rear crush splays the sheet out, but not past the car's own width: a bumper's end stood out to
          // the side of a crushed corner as a flap)
          if (dx !== 0 && (frontHit || rearHit)) { const lim = A.hw + 0.03, nxp = X + dx; if (nxp > lim && nxp > X) dx = Math.max(0, lim - X); else if (nxp < -lim && nxp < X) dx = Math.min(0, -lim - X); }
          if (dx !== 0 || dy !== 0 || dz !== 0) {
            c[i3] += dx; c[i3 + 1] += dy; c[i3 + 2] += dz;
            dirty[i] = 1; any = true; stats.moved++;
          }
        }
        stats.move += performance.now() - tm;
        if (any) {
          e.writePositions();
          if (Dc > 0.4 && e.geo.boundingSphere) e.geo.boundingSphere.radius = Math.max(e.geo.boundingSphere.radius, (e.src.boundingSphere ? e.src.boundingSphere.radius : 3) + 0.6);
          // (the engine bay's boxes, the cabin's trim and unpainted plastics may tear anywhere: a hole there shows little;
          // a long stretched triangle of a liner stood out of a crushed corner as a dark flap)
          // (painted sheet tears only in small pieces, now that it is split where it moves: gaps, not big holes)
          if (e.role !== 'proxy' && e.role !== 'far' && Dc > 0.12) stats.torn = (stats.torn || 0) + (yield* tearGen(job, e, dirty, inner || (e.role === 'body' && !e.isPaint()), (e.role === 'paint' || e.isPaint()) ? wingKeep : null));
          // the lifted lid parts from the grille and the wings at its front: triangles from its lifted edge to the
          // body round it go (the bay gapes there, as the XC90's)
          if (lidF && !glass) {
            const ix = e.ownIndex().array; let cut = 0;
            for (let t = 0; t < ix.length; t += 3) {
              if ((t % 24576) === 24573 && performance.now() >= job.deadline) yield;
              const a = ix[t], b = ix[t + 1], d = ix[t + 2]; if (a === b && b === d) continue;
              const fa = lidF[a], fb = lidF[b], fd = lidF[d], hi = Math.max(fa, fb, fd);
              if (hi > 0.25 && (fa === 0 || fb === 0 || fd === 0)) { ix[t + 1] = a; ix[t + 2] = a; cut++; }
            }
            if (cut) e.geo.index.needsUpdate = true;
          }
          // the normals after (the cabin's own trim keeps its normals: it moves little and is mostly out of sight)
          if (e.role !== 'proxy' && e.role !== 'far' && !inner) later.push([e, dirty]);
        }
        if (stats.prof) stats.prof.push([e.mesh.name + '/' + e.role, n, Math.round((performance.now() - te) * 10) / 10]);
        yield;
      }
      for (const [e, dirty] of later) {
        if (!e.cur || e.cur.length / 3 !== dirty.length) continue; // (cut or reset meanwhile)
        const tn = performance.now(); yield* renormalGen(job, e, dirty); stats.normals += performance.now() - tn;
        yield;
      }
    }
    // material that was crushed is stiffer now
    if (Dc > 0.02) {
      const lb = (lc.x - Px) * Bx + (lc.y - Py) * By + (lc.z - Pz) * Bz;
      for (let sg = 0, k = 0; sg < front(Dc) && k < 40; sg += 0.05, k++) {
        const u0 = Dc - shAt(sg); if (u0 <= 0.01) break;
        for (let dt = -0.6; dt <= 0.6; dt += 0.1) for (let db = -0.4; db <= 0.4; db += 0.1) {
          let Rl = reachAt(dt, db + lb); if (Rl > Dc) Rl = Dc;
          const ul = Rl - shAt(sg);
          if (ul > 0.01) this.hardAdd(lc.x + Nx * (sg + ul) + Tx * dt + Bx * db, lc.y + Ny * (sg + ul) + Ty * dt + By * db, lc.z + Nz * (sg + ul) + Tz * dt + Bz * db, 0.55 + 0.35 * Math.min(1, ul / 0.2));
        }
      }
    }
    // the deepest point: where the push's line meets the car, moved in by the crush
    const maxU = Dc + (bulgeAdd > 0 ? 0 : 0);
    res.uAt = lc.clone();
    this.crushTotal += maxU;
    this.damaged = true;
    res.maxU = maxU; res.s0 = s0; res.N = N; res.T = T; res.B = B; res.reachAt = (t, b) => Math.min(reachAt(t, b), Dc); res.shAt = shAt; res.D = Dc;
    // displacement of a car-frame point by this crush (for what breaks: windows, lamps, wheels), without moving it
    res.uOf = (X, Y, Z) => { const x = X - Px, y = Y - Py, z = Z - Pz; const sg = x * Nx + y * Ny + z * Nz - s0; if (sg >= sigMax) return 0; const R = Math.min(reachAt(x * Tx + y * Ty + z * Tz, x * Bx + y * By + z * Bz), Dc); return Math.max(0, R - shAt(sg)); };
    const setup = performance.now() - T0;
    const finish = () => {
      const ms = { setup: Math.round(setup), refine: Math.round(stats.refine), move: Math.round(stats.move), normals: Math.round(stats.normals), newVerts: stats.newVerts, entries: near.length, zone: stats.zone, moved: stats.moved, torn: stats.torn || 0, all: Math.round(performance.now() - T0) };
      if (stats.prof) ms.prof = stats.prof.sort((a, b) => b[2] - a[2]).slice(0, 12);
      this.mgr.lastCrush = ms; res.ms = ms;
    };
    res.work = work; res.finish = finish;
    const cjob = makeJob(this, work, finish);
    res.job = cjob; this.job = cjob;
    return res;
  }
  // could this entry be in the crushed zone (a quick test of its box against the slab along the push)
  boxNear(e, P, N, s0, sMax, bulge) {
    if (bulge && e.role !== 'glass') return true;
    let b = e.box;
    if (e.cur) {
      b = e._bb || (e._bb = new THREE.Box3()); b.makeEmpty();
      const c = e.cur; for (let i = 0; i < c.length; i += 30) { if (c[i] < b.min.x) b.min.x = c[i]; if (c[i] > b.max.x) b.max.x = c[i]; if (c[i + 1] < b.min.y) b.min.y = c[i + 1]; if (c[i + 1] > b.max.y) b.max.y = c[i + 1]; if (c[i + 2] < b.min.z) b.min.z = c[i + 2]; if (c[i + 2] > b.max.z) b.max.z = c[i + 2]; }
      b.expandByScalar(0.15);
    }
    // the smallest s over the box's corners
    let smin = Infinity;
    for (let k = 0; k < 8; k++) { const s = ((k & 1 ? b.max.x : b.min.x) - P.x) * N.x + ((k & 2 ? b.max.y : b.min.y) - P.y) * N.y + ((k & 4 ? b.max.z : b.min.z) - P.z) * N.z; if (s < smin) smin = s; }
    return smin - s0 < sMax;
  }

  // what an impact breaks, after the crush
  consequences(imp, res) { runSync(this.consequencesGen(SYNC, imp, res)); }
  *consequencesGen(job, imp, res) {
    const mgr = this.mgr, A = this.A;
    const E = imp.energy || 0, sp = imp.speed || 0;
    // the hit's point at its height (the crush's deepest point, or the contact at the band's middle)
    const hp = imp.Ph = res && res.uAt ? res.uAt.clone() : imp.P.clone().setY(Number.isFinite(imp.b0) && Number.isFinite(imp.b1) ? clamp((imp.b0 + imp.b1) / 2, 0.2, A.belt) : (imp.yMid ?? A.belt * 0.7));
    // windows
    const W = A.windows;
    for (const w of W) {
      if (w.merged || w.kind === 'inner' || this.ws(w).state === 'broken') continue;
      // distortion of the frame: the window's corners moved unlike each other
      let dist = 0;
      if (res && res.uOf) {
        let lo = Infinity, hi = 0;
        for (let k = 0; k < 9; k++) { const b = w.box, p = k < 8 ? _a.set(k & 1 ? b.max.x : b.min.x, k & 2 ? b.max.y : b.min.y, k & 4 ? b.max.z : b.min.z) : w.center; const u = res.uOf(p.x, p.y, p.z); if (u < lo) lo = u; if (u > hi) hi = u; }
        dist = (hi - lo) + hi * 0.4;
      }
      const nearHit = w.box.distanceToPoint(hp) < 0.25 && sp > 4;
      const roll = imp.kind === 'ground' && imp.side === 'roof';
      if (w.kind === 'lens') { if (dist > 0.01 || nearHit) { this.breakWindow(w, imp, res); yield; } continue; }
      if (w.laminated) {
        // the windscreen cracks (and stays): from the frame bending, a hard hit nearby, a big crash anywhere
        // (in NCAP's 56 km/h full frontal the windscreen usually stays whole: it cracks from a bent frame, a hit
        // near it, or crashes well past that energy)
        const frontal = imp.side === 'front' ? (E > 4e5 ? 0.5 : E > 2.6e5 ? 0.2 : 0) : 0;
        // (the S60's and the Crown's windscreens crazed over their struck half: the A-pillar and roof rail bent at the pole)
        const poleSide = imp.kind === 'pole' && (imp.side === 'left' || imp.side === 'right') && w.kind === 'front' && res && res.maxU > 0.25 ? 1.8 : 0;
        const s = dist * 18 + (nearHit ? 0.6 : 0) + (E > 4e5 ? 0.6 : E > 2.6e5 ? 0.2 : 0) + frontal + (roll ? 0.7 : 0) + poleSide;
        if (s > 0.5) { this.crackWindow(w, imp, res, s); yield; }
      } else {
        // a door pushed in twists its window frame: the side windows on the struck side burst
        const reach = imp.kind === 'pole' ? 0.35 : 0.9;
        const struck = w.kind === 'side' && res && ((imp.side === 'left' && w.side === 'L') || (imp.side === 'right' && w.side === 'R')) && w.box.distanceToPoint(hp) < reach ? res.maxU * 3 * (0.6 + Math.random() * 0.6) : 0;
        const s = dist * (imp.kind === 'pole' ? 12 : 25) + (nearHit ? 0.9 : 0) + (roll ? 0.8 * Math.random() + 0.3 : 0) + (E > 6e5 ? 0.4 : 0) + struck;
        if (s > 0.85) { this.breakWindow(w, imp, res); yield; }
      }
    }
    // lamps hit
    for (const L of A.lamps) {
      const key = L.entry + ':' + (L.code || 0) + ':' + (L.front ? 1 : 0) + ':' + L.role + L.side;
      if (this.lampsBroken.has(key)) continue;
      let u = 0;
      if (res) { _v.copy(L.center).sub(imp.P); const sg = _v.dot(res.N) - res.s0, R = Math.min(res.reachAt(_v.dot(res.T), _v.dot(res.B)), res.D); u = Math.max(0, R - res.shAt(sg)); }
      if (u > 0.015 || (L.center.distanceTo(hp) < L.r + 0.15 && sp > 3)) { this.breakLamp(L, key, imp); if (performance.now() >= job.deadline) yield; }
    }
    // mirrors snap off, bumpers hang, doors spring, wheels bend
    for (const m of A.mirrors) {
      if (this.parts.has('mirror' + m.side)) continue;
      const c = m.box.getCenter(_v);
      const d = c.distanceTo(hp);
      let u = 0;
      if (res) { _a.copy(c).sub(imp.P); const sg = _a.dot(res.N) - res.s0, R = Math.min(res.reachAt(_a.dot(res.T), _a.dot(res.B)), res.D); u = Math.max(0, R - res.shAt(sg)); }
      if (u > 0.04 || (d < 0.45 && sp > 3.5) || (imp.scrape && d < 0.5 && imp.speedT > 3)) { const hang = Math.random() < 0.3 && sp < 9; this.later('mirror' + m.side, jb => this.detachGen(jb, 'mirror' + m.side, imp, { kind: 'mirror', box: m.box, test: (x, y, z) => m.box.containsPoint(_a.set(x, y, z)), hang })); }
    }
    if (res && res.maxU > 0.01) {
      for (const which of ['front', 'rear']) {
        const bz = A.bumpers[which];
        // (a side hit reaches a bumper only near its end of the car)
        if ((imp.side === 'left' || imp.side === 'right') && (imp.P.z < bz.z0 - 0.8 || imp.P.z > bz.z1 + 0.8)) continue;
        const cz = (bz.z0 + bz.z1) / 2, cy = (bz.y0 + bz.y1) / 2;
        let um = 0, side = 0;
        for (const fx of [-0.7, 0, 0.7]) {
          _a.set(fx * A.hw, cy, cz).sub(imp.P);
          const sg = _a.dot(res.N) - res.s0, R = Math.min(res.reachAt(_a.dot(res.T), _a.dot(res.B)), res.D), u = Math.max(0, R - res.shAt(sg));
          if (u > um) { um = u; side = fx; }
        }
        const p = this.parts.get('bumper' + which);
        // cracks across the cover where it was pushed in (dark hairlines in the paint)
        if (um > 0.1 && !this.cracks[which]) {
          this.cracks[which] = true;
          const n = new THREE.Vector3(0, 0, which === 'front' ? -1 : 1), zf = which === 'front' ? bz.z0 + 0.06 : bz.z1 - 0.06;
          for (let k = 0; k < 3 + Math.round(um * 4); k++) {
            const x = rnd(-0.75, 0.75) * A.hw, y = rnd(bz.y0 + 0.05, bz.y1 - 0.03), L = rnd(0.08, 0.22), ang = rnd(-1.2, 1.2);
            this.scratch(new THREE.Vector3(x, y, zf), new THREE.Vector3(x + Math.cos(ang) * L, y + Math.sin(ang) * L * 0.6, zf), n, 0.005, [0, 0.15, 0.05, 1], 0);
          }
        }
        if (um > 0.15 && !p && !this.cracks[which + 'sag']) {
          this.cracks[which + 'sag'] = true;
          const sgx = side === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(side), amt = Math.min(0.09, 0.045 + um * 0.07), zs = which === 'front' ? -1 : 1;
          for (const e of this.list()) {
            if (!e.cur || e.partOf || e.role === 'glass' || e.role === 'proxy' || e.role === 'far' || e.mesh.userData.dmgBay) continue;
            const c = e.cur, r = e.rest; let any = false; const dirty = new Uint8Array(c.length / 3);
            for (let k = 0; k < c.length; k += 3) {
              if ((k % 24576) === 24573 && performance.now() >= job.deadline) yield;
              const x = r[k] * sgx, y = r[k + 1], z = r[k + 2];
              if (x < A.hw * 0.35 || y > bz.y0 + (bz.y1 - bz.y0) * 0.55 || z < bz.z0 - 0.25 || z > bz.z1 + 0.25) continue;
              const fx = Math.min(1, (x - A.hw * 0.35) / (A.hw * 0.5)), fy = 1 - Math.min(1, Math.max(0, y - bz.y0) / ((bz.y1 - bz.y0) * 0.55));
              const f = fx * fy;
              c[k + 1] -= amt * f * f; c[k] += sgx * amt * 0.6 * f; c[k + 2] += zs * amt * 0.35 * f;
              dirty[k / 3] = 1; any = true;
            }
            if (any) { e.writePositions(); yield* renormalGen(job, e, dirty); }
            if (performance.now() >= job.deadline) yield;
          }
        }
        if (um > (which === 'front' ? 0.55 : 0.5) && !p) {
          const free = side === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(side);
          if (um > 0.8 || (um > 0.68 && Math.random() < 0.4)) this.later('bumper' + which, jb => this.detachGen(jb, 'bumper' + which, imp, { kind: 'bumper', test: (x, y, z) => z > bz.z0 && z < bz.z1 && y > bz.y0 && y < bz.y1, which }));
          else this.later('bumper' + which, jb => this.hangBumperGen(jb, which, free, um));
        } else if (p && p.state === 'hang' && um > 0.12) this.later('bumper' + which, jb => this.detachGen(jb, 'bumper' + which, imp, { kind: 'bumper', which }));
      }
      // wheels: pushed in, bent, or off
      const W4 = this.rig.wheels || [];
      W4.forEach((wh, i) => {
        if (!wh || this.wheels[i].off) return;
        // (how far the crush reaches into the tyre's near edge: the suspension arms go when that is deep)
        _a.copy(wh.pos); _a.x += Math.sign(wh.pos.x) * 0.1; _a.addScaledVector(res.N, -(wh.radius || 0.33) * 0.8); _a.sub(imp.P);
        const sg = _a.dot(res.N) - res.s0, R = Math.min(res.reachAt(_a.dot(res.T), _a.dot(res.B)), res.D), u = Math.max(0, R - res.shAt(sg));
        // a crush that reaches past the tyre's front on that side (an offset crash misses the frame rails and drives
        // the wheel back: its arms break)
        const endZ = imp.side === 'front' ? A.box.min.z : imp.side === 'rear' ? A.box.max.z : NaN;
        const over = Math.abs(wh.pos.z - endZ) - (wh.radius || 0.33), atEnd = imp.side === 'front' ? wh.pos.z < 0 : wh.pos.z > 0;
        const offset = Number.isFinite(endZ) && atEnd && res.reachAt(_a.dot(res.T), _a.dot(res.B)) > res.D * 0.6 && res.D > over * 0.85 && sp > 16;
        if ((u > 0.32 && sp > 12 && Math.random() < 0.6) || (offset && Math.random() < 0.5)) this.wheelOff(i, imp);
        else if (u > 0.05) { this.bendWheel(i, u, res.N); this.pushWheel(i, u, res.N); }
      });
      // doors: forced open by a big frontal, rear or roll crash; jammed by a side hit on them
      const doors = this.doorList();
      for (let i = 0; i < doors.length; i++) {
        const dd = doors[i]; if (this.doorState(i).forced) continue;
        // (after NCAP's frontal, about 0.5 m of crush, the doors stay shut and still open: only far worse springs them)
        const bigFR = (imp.side === 'front' || imp.side === 'rear') && res.maxU > 0.75;
        const roll = imp.side === 'roof' && res.maxU > 0.12;
        // (struck doors stay latched in NHTSA's side tests: one springs only in a far harder side crash)
        const sideNear = (imp.side === 'left' && dd.side === 'L' || imp.side === 'right' && dd.side === 'R') && res.maxU > 0.55 && dd.box.distanceToPoint(hp) < 0.6;
        if ((bigFR && Math.random() < (dd.front ? 0.25 : 0.12)) || (roll && Math.random() < 0.2) || (sideNear && Math.random() < 0.15)) this.later('door' + i, jb => this.forceDoorGen(jb, i, imp));
        // a pole at a door's trailing edge splits it from the pillar: the door stands a few centimetres ajar there,
        // its folded skin and the dark door structure showing in the gap (NHTSA's side pole photos)
        else if (imp.kind === 'pole' && res.maxU > 0.2 && ((imp.side === 'left' && dd.side === 'L') || (imp.side === 'right' && dd.side === 'R')) && Math.abs(dd.box.max.z - hp.z) < 0.45) {
          const self = this;
          this.later('door' + i, function* (jb) {
            const st = self.doorState(i);
            if (st.forced) return;
            yield* self.doorNodeGen(jb, i);
            if (st.forced || !st.pivot) return;
            st.forced = true; st.target = 0.05 + Math.min(0.05, res.maxU * 0.1); st.sagT = 0.01;
            const part = self.parts.get('door' + i); if (!part) return;
            const sg = dd.side === 'L' ? -1 : 1, zE = dd.box.max.z, yH = hp.y;
            for (const pe of part.entries) {
              if (!pe.cur || !pe.rest || pe.role === 'glass') continue;
              const c = pe.cur, r = pe.rest; let any = false; const dirty = new Uint8Array(c.length / 3);
              for (let k = 0; k < c.length; k += 3) {
                const back = r[k + 2] - (zE - 0.16); if (back <= 0) continue;
                const fy = 1 - Math.min(1, Math.abs(r[k + 1] - yH) / 0.42); if (fy <= 0) continue;
                const f = Math.min(1, back / 0.16) * fy;
                // forward off the pillar (a gap of up to 8 cm), the lip folded out at the very edge
                c[k + 2] -= 0.07 * f; c[k] += sg * 0.05 * f * f; c[k + 1] += 0.01 * f;
                dirty[k / 3] = 1; any = true;
              }
              if (any) { pe.writePositions(); yield* renormalGen(jb, pe, dirty); }
              if (performance.now() >= jb.deadline) yield;
            }
            // the door's own inner structure, dark grey, just inside the skin at the split (seen through the gap
            // instead of the pillar behind)
            const pe0 = part.entries.find(q => q.role !== 'glass' && q.mesh && q.mesh.parent);
            if (pe0) {
              const A = self.A, w = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.1), BAY_ENGINE);
              w.name = 'dmg_doorinner'; w.userData.dmgOwnGeo = true; w.castShadow = false; w.receiveShadow = true;
              // (as deep as the crushed skin there, a few centimetres inside it)
              const wy = Math.min(A.belt - 0.08, Math.max(0.35, yH)), wz = zE - 0.12, du = res.uOf ? res.uOf(sg * A.hwBelt, wy, wz) : 0;
              w.position.set(sg * (A.hwBelt - 0.09 - du), wy, wz); w.updateMatrix();
              w.applyMatrix4(new THREE.Matrix4().multiplyMatrices(pe0.mesh.matrix, pe0.c2m));
              pe0.mesh.parent.add(w);
            }
          });
        }
      }
      // a deep frontal knocks the near headlamp out of its mounts and splits the bumper cover's lower part open
      if (imp.side === 'front' && !this.npc && (this.front > 0.4 || res.maxU > 0.42) && !this.cracks.deep) {
        this.cracks.deep = true;
        const near = this.bonnetSkew >= 0 ? 'R' : 'L';
        const L = A.lamps.find(q => q.role === 'head' && q.side === near && q.center.z < 0) || A.lamps.find(q => q.role === 'head' && q.center.z < 0);
        if (L) {
          const du = res.uOf ? res.uOf(L.center.x, L.center.y, L.center.z) : 0;
          const lb = L.box.clone().expandByScalar(0.035); lb.min.z += du; lb.max.z += du + 0.05;
          this.later('headlamp', jb => this.detachGen(jb, 'headlamp', imp, { kind: 'part', box: lb, test: (x, y, z) => lb.containsPoint(_a.set(x, y, z)), skip: e => !!e.mesh.userData.dmgBay }));
        }
        const bz = A.bumpers.front, yH = bz.y0 + (bz.y1 - bz.y0) * 0.5, self = this;
        if (res.maxU > 0.45) {
          const sgn = near === 'R' ? 1 : -1, zArch = A.zFA - A.wheelR * 0.85, yTop = A.belt + 0.06, yBot = bz.y1 - 0.04;
          const wb = new THREE.Box3(new THREE.Vector3(sgn < 0 ? -A.hw - 0.3 : A.hw * 0.52, yBot, A.box.min.z - 0.4), new THREE.Vector3(sgn < 0 ? -A.hw * 0.52 : A.hw + 0.3, yTop, zArch));
          this.later('wingfront', jb => this.detachGen(jb, 'wingfront', imp, { kind: 'part', box: wb, test: (x, y, z) => wb.containsPoint(_a.set(x, y, z)), skip: e => !!e.mesh.userData.dmgBay || e.role === 'glass' }));
        }
        if (this.front > 0.45 && false) {
          const sgn = near === 'R' ? 1 : -1, amt = Math.min(0.12, 0.06 + (this.front - 0.45) * 0.4), wz0 = this.curFront(), wz1 = A.zA - 0.1;
          this.later('wingout', function* (jb) {
            for (const e of self.list()) {
              if (!e.cur || e.partOf || e.role === 'glass' || e.role === 'proxy' || e.role === 'far' || e.mesh.userData.dmgBay || A.interior[self.entries.indexOf(e)]) continue;
              const c = e.cur, r = e.rest; let any = false; const dirty = new Uint8Array(c.length / 3);
              for (let k = 0; k < c.length; k += 3) {
                if ((k % 24576) === 24573 && performance.now() >= jb.deadline) yield;
                const x = r[k] * sgn, y = r[k + 1], z = c[k + 2];
                if (x < A.hw * 0.55 || y < bz.y1 - 0.05 || y > A.belt + 0.05 || z > wz1) continue;
                const fz = Math.max(0, Math.min(1, (wz1 - z) / Math.max(0.2, wz1 - wz0))), fx = Math.min(1, (x - A.hw * 0.55) / (A.hw * 0.3)), f = fz * fx;
                c[k] += sgn * amt * f; c[k + 2] += amt * 0.5 * f; c[k + 1] -= amt * 0.15 * f;
                dirty[k / 3] = 1; any = true;
              }
              if (any) { e.writePositions(); yield* renormalGen(jb, e, dirty); }
              if (performance.now() >= jb.deadline) yield;
            }
          });
        }
        this.later('bumpersplit', function* (jb) {
          for (const e of self.list()) {
            if (!e.cur || e.partOf || e.role === 'glass' || e.role === 'proxy' || e.role === 'far' || e.mesh.userData.dmgBay) continue;
            const c = e.cur, r = e.rest; let any = false; const dirty = new Uint8Array(c.length / 3);
            for (let k = 0; k < c.length; k += 3) {
              if ((k % 24576) === 24573 && performance.now() >= jb.deadline) yield;
              const x = r[k], y = r[k + 1], z = r[k + 2];
              if (y > yH || y < bz.y0 - 0.05 || z > bz.z1 + 0.05 || Math.abs(x) > A.hw * 0.78) continue;
              const t = (yH - y) / (yH - bz.y0 + 0.05), fx = 1 - Math.pow(Math.abs(x) / (A.hw * 0.78), 3);
              // hanging forward and down from its upper edge
              c[k + 1] -= 0.05 * t * fx; c[k + 2] -= 0.12 * t * fx;
              dirty[k / 3] = 1; any = true;
            }
            if (any) { e.writePositions(); yield* renormalGen(jb, e, dirty); }
            if (performance.now() >= jb.deadline) yield;
          }
        });
      }
      // a hard front crash tears the grille out (the radiator behind it shows)
      if (imp.side === 'front' && res.maxU > 0.62 && this.bay && !this.parts.has('grille')) {
        const bz = A.bumpers.front, cf = this.curFront(), tp = this;
        const gbox = new THREE.Box3(new THREE.Vector3(-A.hw * 0.66, bz.y1 - 0.03, cf - 0.05), new THREE.Vector3(A.hw * 0.66, A.yCowl, cf + 0.32));
        this.later('grille', jb => this.detachGen(jb, 'grille', imp, { kind: 'part', box: gbox, skip: e => !!e.mesh.userData.dmgBay, test: (x, y, z) => z < cf + 0.32 && y > bz.y1 - 0.03 && Math.abs(x) < A.hw * 0.66 && y < tp.topAt(x, z) - 0.035 }));
      }
      // airbags: in front in a hard frontal crash, a side's curtain in a side crash or a roll
      if (!this.npc || true) {
        if ((imp.side === 'front' || imp.side === 'rear' && sp > 12) && sp > 7 && res.maxU > 0.12) this.deployBags('front');
        if ((imp.side === 'left' || imp.side === 'right') && sp > 5 && res.maxU > 0.08) this.deployBags(imp.side === 'left' ? 'L' : 'R');
        if (imp.side === 'roof' && res) this.roofDrop = (this.roofDrop || 0) + res.maxU;
        if (imp.side === 'roof' || imp.rollover) { this.deployBags('L'); this.deployBags('R'); }
      }
      // the engine: steam from the radiator, then smoke, then flames
      if (imp.side === 'front' && res.maxU > 0.18) {
        this.engine = Math.max(this.engine, res.maxU);
        // (over the engine, just behind where the front is now)
        const at = new THREE.Vector3(0, A.yCowl * 0.85, Math.min(this.curFront() + 0.35, A.zA - 0.15));
        mgr.fx.emit(this.root, at, 'steam', 10 + res.maxU * 20, 40 + res.maxU * 60);
        if (this.engine > 0.55) mgr.fx.emit(this.root, at.clone().setY(A.yCowl), 'smoke', 6 + this.engine * 6, 120);
        if (this.engine > 0.95 && (this.engine > 1.05 || Math.random() < 0.5)) mgr.fx.emit(this.root, at.clone().setY(A.yCowl * 0.9), 'fire', 40, 60);
      }
    }
  }

  // ---- glass
  crackWindow(w, imp, res, s) {
    const C = this.crackReady(), sl = C.slots.get(w.id);
    if (!sl) return;
    const ws = this.ws(w);
    ws.cracks = (ws.cracks || 0) + 1;
    if (ws.cracks > 6) return;
    // where on the window: the point of it nearest the hit
    const p = w.box.clampPoint(imp.Ph || imp.P, new THREE.Vector3());
    if (res && res.uAt && w.box.distanceToPoint(res.uAt) < 0.4) p.copy(w.box.clampPoint(res.uAt, _v));
    _v.copy(p).sub(w.center);
    const u = clamp((_v.dot(w.U) - w.u0) / Math.max(1e-3, w.u1 - w.u0), 0.05, 0.95), v = clamp((_v.dot(w.V) - w.v0) / Math.max(1e-3, w.v1 - w.v0), 0.05, 0.95);
    const g = C.g, cx = sl[0] + 2 + u * (sl[2] - 4), cy = sl[1] + 2 + v * (sl[3] - 4);
    const size = Math.min(sl[2], sl[3]) * clamp(0.25 + s * 0.35, 0.25, 1.1);
    spiderWeb(g, cx, cy, size, sl, s);
    C.tex.needsUpdate = true;
    this.ownAllGlass();
    this.applyUniforms();
    this.damaged = true;
    this.mgr.emit({ type: 'glass', car: this.rig, window: w.id, point: this.toWorld(p), cracked: true, kind: w.kind });
    if (ws.cracks === 1) this.mgr.fx.sound.glass(0.35);
  }
  ownAllGlass() { for (const e of this.list()) if (e.role === 'glass') this.ownGlass(e); }
  breakWindow(w, imp, res) {
    const ws = this.ws(w);
    if (ws.state === 'broken') return;
    ws.state = 'broken';
    const e = this.entries[w.entry];
    this.ownGlass(e);
    // the window's triangles go; their points seed the burst
    const idx = e.geo.index.array, keep = [], pts = [];
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      if (e.win[a] === w.id || e.win[b] === w.id || e.win[c] === w.id) {
        if (pts.length < 400) for (let k = 0; k < 2; k++) { const r1 = Math.random(), r2 = Math.random(), sq = Math.sqrt(r1); const wa = 1 - sq, wb = sq * (1 - r2), wc = sq * r2; pts.push(new THREE.Vector3(e.cur[a * 3] * wa + e.cur[b * 3] * wb + e.cur[c * 3] * wc, e.cur[a * 3 + 1] * wa + e.cur[b * 3 + 1] * wb + e.cur[c * 3 + 1] * wc, e.cur[a * 3 + 2] * wa + e.cur[b * 3 + 2] * wb + e.cur[c * 3 + 2] * wc)); }
        continue;
      }
      keep.push(a, b, c);
    }
    e.setIndex(keep.length && e.cur.length / 3 > 65535 ? new Uint32Array(keep) : keep);
    if (!pts.length) return;
    // the cubes: in the world, with the car's own motion, most outward (the hit pushes in, the rest fall out)
    const mgr = this.mgr, fx = mgr.fx;
    this.root.updateWorldMatrix(true, false);
    const M = this.root.matrixWorld, q = this.root.getWorldQuaternion(_q);
    const wpts = pts.map(p => p.clone().applyMatrix4(M));
    const outN = w.center.clone().sub(new THREE.Vector3(0, A_belt(this) * 0.7, (this.A.zA + this.A.zC) / 2)).normalize().applyQuaternion(q);
    const vel = this.velocityAt(wpts[0]);
    const gy = this.groundY(wpts[0]);
    const lens = w.kind === 'lens';
    const area = w.area;
    if (lens) fx.shardBurst(wpts[0], vel, outN, gy, Math.round(10 + area * 200), [0xd8e2e6, 0xc9d4d8, 0xeef4f6], 0.025);
    else {
      const n = Math.round(clamp(area * 2600, 120, mgr.npcCap(this) ? 260 : 900));
      const inward = w.kind === 'side' && ((imp.side === 'left' && w.side === 'L') || (imp.side === 'right' && w.side === 'R'));
      fx.glassBurst(wpts, vel, outN.clone().multiplyScalar(imp.side === 'roof' ? 0.6 : inward ? 0.25 : 0.9), gy, inward ? Math.round(n * 0.3) : n);
      // and some onto the seats, inside
      if (!this.npc) {
        if (!this.cabin) this.cabin = fx.cabinBits(this.rig.model && this.rig.model.isObject3D ? this.rig.model : this.root);
        const seatY = Math.max(0.35, A_belt(this) - 0.45);
        for (let i = 0; i < Math.round(n * 0.3); i++) {
          const p = pts[(Math.random() * pts.length) | 0];
          const inx = -Math.sign(p.x) * rnd(0.3, 1.6);
          this.cabin.add(p.x, p.y, p.z, inx * (w.kind === 'side' ? 1 : 0.2), rnd(-0.5, 0.5), (w.kind === 'front' ? 1 : w.kind === 'rear' ? -1 : 0) * rnd(0.3, 1.2) + rnd(-0.3, 0.3), seatY + rnd(-0.08, 0.1), rnd(0.006, 0.012));
        }
      }
      fx.sound.glass(1);
    }
    this.damaged = true;
    mgr.emit({ type: 'glass', car: this.rig, window: w.id, point: wpts[0].clone(), broken: true, kind: w.kind, side: w.side });
  }

  // ---- lamps
  breakLamp(L, key, imp) {
    this.lampsBroken.add(key);
    const rig = this.rig, e = this.entries[L.entry];
    const colours = L.role === 'head' || L.role === 'reverse' ? [0xe8eef0, 0xd2dade, 0xf4f6f7] : L.role === 'signal' ? [0xff9a20, 0xe07a10, 0xffb040] : [0xc01810, 0x9a1008, 0xe02a1a];
    if (L.code) {
      // a traffic car: its lamp code off on the body's own copy
      const g = e.own();
      const la = g.attributes._lamp;
      if (la) {
        let arr = la.array;
        if (!e.owned.has(la)) { const nb = new THREE.BufferAttribute(new Float32Array(la.count), 1); for (let i = 0; i < la.count; i++) nb.array[i] = la.getX(i); g.setAttribute('_lamp', nb); e.owned.add(nb); arr = nb.array; }
        for (let i = 0; i < arr.length; i++) if (Math.round(arr[i]) === L.code && (e.cur[i * 3 + 2] < 0) === !!L.front) arr[i] = 0;
        g.attributes._lamp.needsUpdate = true;
      }
    } else if (rig._lamps) {
      // the player's car: the lens goes dark and its glow and beam with it
      const mesh = e.mesh;
      const RL = rig._lamps.find(l => l.meshes.includes(mesh));
      if (RL) {
        RL.meshes = RL.meshes.filter(m => m !== mesh);
        let best = null, bd = Infinity;
        for (const gl of RL.glows) { const d = gl.position.distanceTo(L.center); if (d < bd) { bd = d; best = gl; } }
        if (best && bd < 0.6) { best.visible = false; RL.glows = RL.glows.filter(g => g !== best); }
        if (RL.role === 'head' && rig._beams) {
          const b = rig._beams.find(b => Math.sign(b.position.x) === Math.sign(L.center.x));
          if (b) { b.intensity = 0; rig._beams = rig._beams.filter(x => x !== b); }
        }
      }
      // signals and reverse lamps drawn only as glows (no lens) near it go too
      for (const l of rig._lamps) if (!l.meshes.length && l.glows.length) for (const gl of l.glows) if (gl.position.distanceTo(L.center) < 0.25) { gl.visible = false; l.glows = l.glows.filter(g => g !== gl); }
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(() => BROKEN_LENS) : BROKEN_LENS;
    }
    // shards
    const wp = this.toWorld(L.center);
    const q = this.root.getWorldQuaternion(_q);
    const out = new THREE.Vector3(Math.sign(L.center.x) * 0.3, 0.2, Math.sign(L.center.z || 1)).normalize().applyQuaternion(q);
    this.mgr.fx.shardBurst(wp, this.velocityAt(wp), out, this.groundY(wp), Math.round(clamp(L.r * 110, 10, 34)), colours, 0.017);
    // a headlight's glass cover, if the model has one as glass
    for (const w of this.A.windows) if (w.kind === 'lens' && !w.merged && this.ws(w).state !== 'broken' && w.box.distanceToPoint(L.center) < 0.08) this.breakWindow(w, imp, null);
    this.damaged = true;
  }

  // ---- parts that come off
  doorList() { return this.analysis().doors; }
  doorState(i) { return this.doors[i] || (this.doors[i] = {}); }
  // cut the triangles inside test (car frame, by their middle) out of every mesh into a group pivoting at `pivot`
  cut(name, test, pivot, opts = {}) { return runSync(this.cutGen(SYNC, name, test, pivot, opts)); }
  *cutGen(job, name, test, pivot, opts = {}) {
    const E = this.list();
    const group = new THREE.Group(); group.name = 'dmgpart_' + name;
    group.userData.dmgPart = true;
    const parent = this.rig.model && this.rig.model.isObject3D ? this.rig.model : this.root;
    // the group in the model's parent frame: the pivot, in the car frame, carried into the model's frame
    const carToModel = new THREE.Matrix4();
    if (parent !== this.root) { let M = new THREE.Matrix4(), o = parent; while (o && o !== this.root) { o.updateMatrix(); M.premultiply(o.matrix); o = o.parent; } carToModel.copy(M).invert(); }
    const pivModel = pivot.clone().applyMatrix4(carToModel);
    group.position.copy(pivModel);
    if (opts.quaternion) group.quaternion.copy(opts.quaternion);
    group.updateMatrix();
    parent.add(group);
    const groupInv = group.matrix.clone().invert();
    const modelToCar = carToModel.clone().invert();
    const meshes = [], entries = [];
    const edgeOf = (x, y, z) => { const a = test(x, y, z), m = 0.05; return test(x - m, y, z) !== a || test(x + m, y, z) !== a || test(x, y - m, z) !== a || test(x, y + m, z) !== a || test(x, y, z - m) !== a || test(x, y, z + m) !== a; };
    const rbox = opts.box ? opts.box.clone().expandByScalar(0.08) : null;
    for (const e of [...E]) {
      if (e.role === 'proxy' || e.role === 'far' || e.partOf) continue;
      if ((opts.skip && opts.skip(e)) || e.mesh.userData.dmgBay) continue; // (the engine bay stays with the car)
      // a quick box test against the part's region
      if (rbox) {
        let bb = e.box;
        if (e.cur) { bb = _box.makeEmpty(); const c = e.cur; for (let i = 0; i < c.length; i += 30) bb.expandByPoint(_v.set(c[i], c[i + 1], c[i + 2])); bb.expandByScalar(0.1); }
        if (!rbox.intersectsBox(bb)) continue;
      }
      // a coarse mesh is split along the boundary first, for a clean edge (a fine one is cut as it is)
      // (every mesh: even a fine one has long strips, trim and shut lines, that would stick out of an open door)
      if (!opts.noRefine) {
        if (e.role === 'glass') this.ownGlass(e); else e.own(); if (performance.now() >= job.deadline) yield;
        yield* refineGen(job, e, edgeOf, Math.max(0.06, Math.min(e.L * 2, 0.1)), 3);
        // and the cut made straight along the boundary
        yield* snapGen(job, e, test);
      }
      const g0 = e.ownGeo();
      const P = e.cur || (e._sp || (e._sp = e.srcPositions()));
      const idx = g0.index.array, ni = idx.length;
      const inside = new Uint32Array(ni), keep = new Uint32Array(ni);
      let nIn = 0, nKeep = 0;
      for (let t = 0; t < ni; t += 3) {
        if ((t % 49152) === 49149 && performance.now() >= job.deadline) yield;
        const ia = idx[t], ib = idx[t + 1], ic = idx[t + 2], a = ia * 3, b = ib * 3, cc = ic * 3;
        // (its middle in the part, and none of its corners far outside the part's box: a long sliver of a triangle
        // reaching to the road went with a door and swung out)
        let out = rbox && (!rbox.containsPoint(_v.set(P[a], P[a + 1], P[a + 2])) || !rbox.containsPoint(_v.set(P[b], P[b + 1], P[b + 2])) || !rbox.containsPoint(_v.set(P[cc], P[cc + 1], P[cc + 2])));
        // a door leaves the sill's top with the body: faces looking up along the box's bottom (the door's own hem
        // looks down and goes with it)
        if (!out && opts.door && opts.box) {
          const yb = opts.box.min.y, cy = (P[a + 1] + P[b + 1] + P[cc + 1]) / 3;
          if (cy < yb + 0.15) {
            const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[cc] - P[a], vy = P[cc + 1] - P[a + 1], vz = P[cc + 2] - P[a + 2];
            const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, nl = Math.hypot(nx, ny, nz) || 1;
            if (ny / nl > 0.6) out = true;
          }
        }
        if (!out && test((P[a] + P[b] + P[cc]) / 3, (P[a + 1] + P[b + 1] + P[cc + 1]) / 3, (P[a + 2] + P[b + 2] + P[cc + 2]) / 3)) { inside[nIn++] = ia; inside[nIn++] = ib; inside[nIn++] = ic; }
        else { keep[nKeep++] = ia; keep[nKeep++] = ib; keep[nKeep++] = ic; }
      }
      if (!nIn) continue;
      if (performance.now() >= job.deadline) yield; // (a big mesh's part copied out over several frames; perf)
      if (e.role === 'glass' && !e.win) this.ownGlass(e);
      // the part's own compact geometry (from the mesh's current buffers)
      const nV = P.length / 3, used = new Int32Array(nV).fill(-1), order = [];
      const pidx = new Uint32Array(nIn);
      for (let k = 0; k < nIn; k++) { const v = inside[k]; let u = used[v]; if (u < 0) { u = used[v] = order.length; order.push(v); } pidx[k] = u; }
      const nO = order.length;
      const g = new THREE.BufferGeometry(), src = e.geo;
      for (const nm of Object.keys(src.attributes)) {
        const at = src.attributes[nm], sz = at.itemSize, arr = new Float32Array(nO * sz);
        if (!at.isInterleavedBufferAttribute && !at.normalized && at.array instanceof Float32Array) { const A0 = at.array; for (let i = 0; i < nO; i++) { const o = order[i] * sz; for (let j = 0; j < sz; j++) arr[i * sz + j] = A0[o + j]; } }
        else for (let i = 0; i < nO; i++) for (let j = 0; j < sz; j++) arr[i * sz + j] = at.getComponent(order[i], j);
        g.setAttribute(nm, new THREE.BufferAttribute(arr, sz));
        if (performance.now() >= job.deadline) yield;
      }
      g.setIndex(new THREE.BufferAttribute(nO > 65535 ? pidx : new Uint16Array(pidx), 1));
      g.computeBoundingSphere(); g.boundingSphere.radius += 0.2;
      const m = new THREE.Mesh(g, e.mesh.material);
      m.name = e.mesh.name + ':' + name; m.userData.dmgPart = true; m.userData.dmgOwnGeo = true;
      m.castShadow = false; m.receiveShadow = e.mesh.receiveShadow;
      // its matrix under the group: group^-1 * (the mesh's matrix in the model's frame)
      const meshInModel = new THREE.Matrix4().multiplyMatrices(carToModel, e.m2c);
      m.matrix.multiplyMatrices(groupInv, meshInModel); m.matrix.decompose(m.position, m.quaternion, m.scale);
      m.renderOrder = e.mesh.renderOrder;
      group.add(m);
      e.setIndex(keep.slice(0, nKeep));
      // an entry for the part, so later dents reach it (in its closed pose)
      const pe = new Entry(this, m, e.role);
      pe.rest = new Float32Array(nO * 3); pe.restN = new Float32Array(nO * 3); pe.cur = new Float32Array(nO * 3); pe.strain = new Float32Array(nO);
      const R0 = e.rest || P, nrm = src.attributes.normal, ne = e.n2c.elements;
      for (let i = 0; i < nO; i++) {
        const v = order[i];
        for (let j = 0; j < 3; j++) { pe.rest[i * 3 + j] = R0[v * 3 + j]; pe.cur[i * 3 + j] = P[v * 3 + j]; }
        if (e.restN) for (let j = 0; j < 3; j++) pe.restN[i * 3 + j] = e.restN[v * 3 + j];
        else if (nrm) { const a = nrm.getX(v), b = nrm.getY(v), c = nrm.getZ(v); let X = ne[0] * a + ne[3] * b + ne[6] * c, Y = ne[1] * a + ne[4] * b + ne[7] * c, Z = ne[2] * a + ne[5] * b + ne[8] * c; const l = Math.hypot(X, Y, Z) || 1; pe.restN[i * 3] = X / l; pe.restN[i * 3 + 1] = Y / l; pe.restN[i * 3 + 2] = Z / l; }
        if (e.strain) pe.strain[i] = e.strain[v];
      }
      if (e.win) { pe.win = new Int16Array(nO); for (let i = 0; i < nO; i++) pe.win[i] = e.win[order[i]]; }
      pe.geo = g; pe.src = g; pe.owned = new Set(Object.values(g.attributes)); pe.owned.add(g.index);
      pe.partOf = name; pe.fine = true;
      // its frame for writing back: the closed pose
      pe.m2c.multiplyMatrices(modelToCar, new THREE.Matrix4().multiplyMatrices(group.matrix, m.matrix));
      pe.c2m.copy(pe.m2c).invert(); pe.n2c.getNormalMatrix(pe.m2c); pe.n2m.getNormalMatrix(pe.c2m); pe.ident = false;
      if (e.role === 'paint' || e.isPaint()) { g.setAttribute('_dp', new THREE.BufferAttribute(pe.rest, 3)); g.setAttribute('_dn', new THREE.BufferAttribute(pe.restN, 3)); g.setAttribute('_ds', new THREE.BufferAttribute(pe.strain, 1)); }
      pe.L = e.L; pe.box.setFromBufferAttribute(g.attributes.position).applyMatrix4(pe.m2c);
      meshes.push(m); entries.push(pe);
      if (performance.now() >= job.deadline) yield;
    }
    for (const pe of entries) this.entries.push(pe);
    const part = { name, group, meshes, entries, state: 'on', pivot: pivot.clone(), carToModel };
    this.parts.set(name, part);
    this.damaged = true;
    return part;
  }

  hangBumper(which, freeSide, u) { runSync(this.hangBumperGen(SYNC, which, freeSide, u)); }
  *hangBumperGen(job, which, freeSide, u) {
    const A = this.A, bz = A.bumpers[which];
    const hx = -freeSide * (A.hw - 0.15), py = (bz.y0 + bz.y1) / 2, pz = (bz.z0 + bz.z1) / 2;
    let p = this.parts.get('bumper' + which);
    if (!p) p = yield* this.cutGen(job, 'bumper' + which, (x, y, z) => z > bz.z0 && z < bz.z1 && y > bz.y0 && y < bz.y1, new THREE.Vector3(hx, py, pz), { box: bumperBox(A, bz) });
    if (!p.meshes.length) return;
    p.state = 'hang';
    p.free = freeSide;
    // it drops at its free end until that end is on the road
    const reach = 2 * (A.hw - 0.15), drop = py - 0.03;
    p.angMax = Math.min(0.7, Math.asin(clamp(drop / reach, 0, 1)) + 0.05);
    // (a cover pushed in by a full width crash sags at one end; it drops to the road only when torn far back)
    p.ang = 0; p.angV = 0; p.target = Math.min(p.angMax, 0.12 + u * 0.55);
    p.swing = (which === 'front' ? -1 : 1) * rnd(0.04, 0.16);
    p.drag = 0;
    this.mgr.fx.sound.crunch(0.4);
  }

  detach(name, imp, opts = {}) { runSync(this.detachGen(SYNC, name, imp, opts)); }
  *detachGen(job, name, imp, opts = {}) {
    let p = this.parts.get(name);
    if (p && p.state === 'off') return;
    if (!p) {
      const test = opts.test || (opts.which ? ((bz => (x, y, z) => z > bz.z0 && z < bz.z1 && y > bz.y0 && y < bz.y1)(this.A.bumpers[opts.which])) : null);
      if (!test) return;
      // the pivot at the part's middle
      const b = new THREE.Box3();
      const piv = opts.pivot || null;
      p = yield* this.cutGen(job, name, test, piv || new THREE.Vector3(), { box: opts.box || (opts.which ? bumperBox(this.A, this.A.bumpers[opts.which]) : null), skip: opts.skip });
      if (!p.meshes.length) { p.state = 'off'; return; }
      if (!piv) {
        // re-centre the group on its meshes
        b.makeEmpty(); for (const m of p.meshes) { m.geometry.computeBoundingBox(); b.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrix)); }
        const c = b.getCenter(new THREE.Vector3());
        for (const m of p.meshes) { m.position.sub(c); m.updateMatrix(); }
        p.group.position.add(c); p.group.updateMatrix();
      }
    }
    // a grille torn out lies down flat: its slats, crushed to different depths, stood up from it like a comb
    if (name === 'grille' && p.entries) {
      for (const pe of p.entries) {
        const c = pe.cur; if (!c || !c.length) continue;
        let mz = 0; for (let i = 2; i < c.length; i += 3) mz += c[i]; mz /= c.length / 3;
        for (let i = 2; i < c.length; i += 3) c[i] = mz + (c[i] - mz) * 0.15;
        pe.writePositions(); if (pe.geo) pe.geo.computeVertexNormals();
      }
    }
    if (opts.hang && opts.kind === 'mirror') {
      // a mirror on its wires: it swings down against the door
      p.state = 'dangle'; p.ang = 0; p.angV = rnd(3, 6); p.dangleT = rnd(3, 12);
      return;
    }
    this.toDebris(p, imp, opts.kind || 'part');
  }

  toDebris(p, imp, kind) {
    if (p.state === 'off') return;
    p.state = 'off';
    const g = p.group, mgr = this.mgr;
    g.updateWorldMatrix(true, true);
    const wpos = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
    g.matrixWorld.decompose(wpos, wq, ws);
    if (g.parent) g.parent.remove(g);
    mgr.scene.add(g);
    g.position.copy(wpos); g.quaternion.copy(wq); g.scale.copy(ws);
    g.updateMatrixWorld(true);
    for (const pe of p.entries) { const i = this.entries.indexOf(pe); if (i >= 0) this.entries.splice(i, 1); }
    const box = new THREE.Box3();
    for (const m of p.meshes) { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrix)); }
    const v = this.velocityAt(wpos);
    if (imp && imp.N) { const nw = imp.N.clone().applyQuaternion(this.root.getWorldQuaternion(_q)); v.addScaledVector(nw, -rnd(0.5, 2.5)); }
    v.y += rnd(0.5, 2);
    const w = new THREE.Vector3(rnd(-4, 4), rnd(-3, 3), rnd(-4, 4));
    const mass = kind === 'bumper' ? 6 : kind === 'mirror' ? 1.5 : kind === 'door' ? 22 : kind === 'wheel' ? 18 : 4;
    const opts = { v, w, box, mass, kind, ground: mgr.groundFn, walls: mgr.wallsFn, mu: kind === 'wheel' ? 0.9 : 0.5, bounce: kind === 'wheel' ? 0.35 : 0.2 };
    if (p.points) opts.points = p.points;
    const d = mgr.fx.addDebris(g, opts);
    d.onRemove = () => { for (const m of p.meshes) { if (m.geometry) m.geometry.dispose(); } };
    p.debris = d;
    this.damaged = true;
    if (kind !== 'mirror') mgr.fx.sound.crunch(0.5);
    mgr.emit({ type: 'part', car: this.rig, part: p.name, kind });
  }

  // a door's pivot: cut out of the body (once), hinged at its front edge; rotation.y > 0 opens it outward
  doorNode(i) {
    const st = this.doorState(i);
    // (the driver's door may be being cut in the background already: finished now rather than cut twice)
    if (!st.pivot && this.doorJob && !this.doorJob.done && this.doorJob.door === i) { try { this.doorJob.run(1e9); } catch (e) {} }
    if (!st.pivot && this.mgr.jobs.some(j => j.rd === this)) this.mgr.flushRig(this);
    return runSync(this.doorNodeGen(SYNC, i));
  }
  *doorNodeGen(job, i) {
    const doors = this.doorList(), dd = doors[i];
    if (!dd) return null;
    const st = this.doorState(i);
    if (st.pivot) return st.pivot;
    const name = 'door' + i;
    // the pivot sits on the hinge; rig.setDoor(i, k) turns it about the hinge axis, outwards on either side
    const p = yield* this.cutGen(job, name, dd.test, dd.hinge, { box: dd.box, door: true });
    if (st.pivot) return st.pivot;
    // an inner group for the sag of a door that hangs off a bent hinge
    const sag = new THREE.Group(); sag.name = 'door_sag';
    while (p.group.children.length) sag.add(p.group.children[0]);
    p.group.add(sag);
    st.pivot = p.group; st.sag = sag; st.part = p; st.open = 0;
    p.group.userData.door = i; p.group.userData.openDeg = dd.open; p.group.userData.openSign = dd.side === 'L' ? -1 : 1;
    p.group.userData.axis = dd.axis.clone();
    return p.group;
  }
  // k: 0 shut, 1 open as far as it goes (the axis turned by the side, so it swings out on either side)
  turnDoor(i, k) {
    const st = this.doorState(i), dd = this.doorList()[i];
    if (!st.pivot || !dd) return;
    st.open = clamp(k, 0, 1);
    _v.copy(dd.axis).normalize(); // (the spec's convention: a positive angle about the axis swings the door out)
    st.pivot.quaternion.setFromAxisAngle(_v, THREE.MathUtils.degToRad(dd.open) * st.open);
    if (st.sag) st.sag.rotation.set((st.sagT || 0) * st.open, 0, 0);
  }
  setDoor(i, k) {
    const piv = this.doorNode(i); if (!piv) return;
    const st = this.doorState(i);
    if (st.forced) { st.target = Math.max(st.target || 0, k); if (k < st.open) return; } // a door forced open on a bent hinge does not shut
    this.turnDoor(i, k);
  }
  forceDoor(i, imp) { runSync(this.forceDoorGen(SYNC, i, imp)); }
  *forceDoorGen(job, i, imp) {
    const st = this.doorState(i);
    if (st.forced) return;
    yield* this.doorNodeGen(job, i);
    if (st.forced || !st.pivot) return;
    st.forced = true;
    st.target = rnd(0.25, 0.75);
    st.sagT = rnd(0.02, 0.12);
    this.mgr.emit({ type: 'door', car: this.rig, door: i, open: true, forced: true });
  }

  bendWheel(i, u, N) {
    const st = this.wheels[i];
    const rw = this.rig._w && this.rig._w[i];
    if (!rw || st.off) return;
    if (!st.bend) {
      const bend = new THREE.Group(); bend.name = 'dmgbend_' + i;
      rw.pivot.add(bend); bend.add(rw.spin);
      st.bend = bend; st.camber = 0; st.toe = 0;
    }
    const sx = Math.sign((this.rig.wheels[i] || { pos: { x: 1 } }).pos.x) || 1;
    // the top of the wheel pushed in, its front turned (toe), more for a harder hit
    st.camber = clamp(st.camber + sx * Math.min(0.22, u * 0.6) * (N.x * sx > 0.3 ? 1 : 0.5), -0.3, 0.3);
    st.toe = clamp(st.toe + (N.z > 0 ? 1 : -1) * sx * Math.min(0.15, u * 0.35) + rnd(-0.03, 0.03), -0.22, 0.22);
    st.bend.rotation.set(0, st.toe, -st.camber);
    // the physics: toe makes the car pull
    const veh = this.vehicle;
    if (veh && veh.wheels[i]) veh.wheels[i].toe = st.toe * 0.5;
    this.damaged = true;
  }
  // a wheel shoved back into its arch by the crush in front of it (the suspension and its mounts give)
  pushWheel(i, u, N) {
    const rw = this.rig._w && this.rig._w[i], st = this.wheels[i];
    if (!rw || st.off) return;
    if (!st.base) st.base = rw.pivot.position.clone();
    const want = Math.min(0.45, Math.max(0, u - 0.04) * 0.9);
    st.push = Math.max(st.push || 0, want);
    rw.pivot.position.set(st.base.x + N.x * st.push * 0.4, rw.pivot.position.y, st.base.z + N.z * st.push);
    const veh = this.vehicle;
    if (veh && veh.wheels[i] && !veh.wheels[i].rest0) { veh.wheels[i].rest0 = veh.wheels[i].rest.clone(); }
    if (veh && veh.wheels[i]) veh.wheels[i].rest.set(veh.wheels[i].rest0.x + N.x * st.push * 0.4, veh.wheels[i].rest0.y, veh.wheels[i].rest0.z + N.z * st.push * 0.5);
  }
  wheelOff(i, imp) {
    const st = this.wheels[i]; if (st.off) return;
    const rw = this.rig._w && this.rig._w[i];
    if (!rw) return;
    st.off = true;
    // the wheel (its spin group) becomes debris: a polygon of points round the tyre so it rolls
    const spin = rw.spin;
    const g = new THREE.Group(); g.name = 'dmgwheel_' + i;
    spin.updateWorldMatrix(true, true);
    const wpos = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
    spin.matrixWorld.decompose(wpos, wq, ws);
    spin.parent.remove(spin);
    const keep = { spin, parent: rw.pivot };
    g.add(spin); spin.position.set(0, 0, 0); spin.quaternion.identity();
    this.mgr.scene.add(g); g.position.copy(wpos); g.quaternion.copy(wq);
    g.updateMatrixWorld(true);
    const r = (this.rig.wheels[i] || {}).radius || 0.33, hwid = 0.11, pts = [];
    for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2; for (const x of [-hwid, hwid]) pts.push(new THREE.Vector3(x, Math.cos(a) * r, Math.sin(a) * r)); }
    const v = this.velocityAt(wpos); v.y += rnd(0.5, 2.5);
    v.x += rnd(-2, 2); v.z += rnd(-2, 2);
    const fwdSpin = (this.vehicle ? this.vehicle.fwdSpeed : 0) / r;
    const wv = new THREE.Vector3(-fwdSpin, rnd(-1, 1), rnd(-1, 1)).applyQuaternion(wq);
    const d = this.mgr.fx.addDebris(g, { v, w: wv, mass: 20, kind: 'wheel', points: pts, box: new THREE.Box3(new THREE.Vector3(-hwid, -r, -r), new THREE.Vector3(hwid, r, r)), ground: this.mgr.groundFn, walls: this.mgr.wallsFn, mu: 0.9, bounce: 0.35, life: 90 });
    d.onRemove = () => { if (keep.spin.parent === g) g.remove(keep.spin); };
    st.debris = d; st.keep = keep;
    if (this.vehicle && this.vehicle.wheels[i]) this.vehicle.wheels[i].gone = true;
    this.damaged = true;
    this.mgr.fx.sound.crunch(0.8);
    this.mgr.emit({ type: 'part', car: this.rig, part: 'wheel' + i, kind: 'wheel' });
  }

  // ---- the parts' motion each frame (hanging bumpers, swinging doors, dangling mirrors)
  animate(dt) {
    let any = false;
    if (this.bags && this.bags.length) { this.animateBags(dt); any = true; }
    const vel = this.vehicle ? this.vehicle.v : null, sp = vel ? vel.length() : (this.trafficCar ? this.trafficCar.v : 0);
    for (const p of this.parts.values()) {
      if (p.state === 'hang') {
        any = true;
        // a damped swing towards hanging, shaken by the car's motion; dragging on the road wears it off
        const k = 30, c = 5;
        p.angV += (k * (p.target - p.ang) - c * p.angV) * dt + (Math.random() - 0.5) * Math.min(8, sp) * 0.6 * dt;
        p.ang += p.angV * dt;
        if (p.ang > p.angMax) { p.ang = p.angMax; p.angV = -Math.abs(p.angV) * 0.3; }
        if (p.ang < 0) { p.ang = 0; p.angV = Math.abs(p.angV) * 0.2; }
        p.group.rotation.set(0, p.swing * p.ang / Math.max(0.1, p.angMax), -p.free * p.ang);
        if (p.ang >= p.angMax - 0.02 && sp > 4) {
          p.drag += dt * sp / 12;
          if (Math.random() < dt * 8) this.dragSparks(p);
          if (p.drag > 1.4 + Math.random() * 3) this.toDebris(p, null, 'bumper');
        }
      } else if (p.state === 'dangle') {
        any = true;
        p.angV += (-20 * (p.ang - 1.1) - 3 * p.angV) * dt + (Math.random() - 0.5) * sp * 0.3 * dt;
        p.ang += p.angV * dt;
        p.group.rotation.set(p.ang * 0.8, 0, 0);
        p.dangleT -= dt * (0.3 + sp * 0.08);
        if (p.dangleT < 0) this.toDebris(p, null, 'mirror');
      }
    }
    for (let i = 0; i < this.doors.length; i++) {
      const st = this.doors[i];
      if (!st || !st.forced || !st.pivot) continue;
      any = true;
      // a door forced open swings with the car's motion and settles part open, sagging on its bent hinge
      st.v = st.v || 0;
      st.v += (12 * (st.target - st.open) - 2.5 * st.v) * dt + (Math.random() - 0.5) * sp * 0.25 * dt;
      st.open = clamp(st.open + st.v * dt, 0, 1);
      this.turnDoor(i, st.open);
    }
    return any;
  }
  dragSparks(p) {
    const fx = this.mgr.fx;
    p.group.updateWorldMatrix(true, true);
    _v.set(p.free * 2 * (this.A.hw - 0.15), -0.1, 0).applyMatrix4(p.group.matrixWorld);
    const vel = this.velocityAt(_v);
    fx.sparkBurst(_v, vel, 3, this.groundY(_v), 0.6);
  }

  toWorld(p) { this.root.updateWorldMatrix(true, false); return p.clone().applyMatrix4(this.root.matrixWorld); }
  velocityAt(wp) {
    const v = this.vehicle;
    if (v) { _w.copy(wp).sub(v.pos); return v.v.clone().add(new THREE.Vector3().crossVectors(v.w, _w)); }
    const c = this.trafficCar;
    if (c) { const fx = Math.sin(c.yaw), fz = -Math.cos(c.yaw); return new THREE.Vector3(fx * c.v + (c.push ? c.push.x : 0), 0, fz * c.v + (c.push ? c.push.y : 0)); }
    return new THREE.Vector3();
  }
  groundY(wp) {
    const g = this.mgr.groundFn ? this.mgr.groundFn(wp.x, wp.z, wp.y) : null;
    if (g !== null && g !== undefined && Number.isFinite(g)) return g;
    this.root.updateWorldMatrix(true, false);
    return this.root.matrixWorld.elements[13];
  }

  // the engine bay: a dark box with a radiator and an engine in it, inside the front (put in before a front crush,
  // so it crushes with the rest; it shows where the bumper and grille are torn off)
  addBay() { runSync(this.addBayGen(SYNC)); }
  *addBayGen(job) {
    if (this.bay) return;
    const A = this.analysis(), E = this.list();
    const parent = this.rig.model && this.rig.model.isObject3D ? this.rig.model : this.root;
    const g = new THREE.Group(); g.name = 'dmg_bay';
    const front = A.box.min.z, back = Math.min(A.zA - 0.08, A.zFA + A.wheelR + 0.25);
    if (back - front < 0.45) return;
    const top = Math.max(0.45, this.topAt(0, (front + back) / 2) - 0.07), bot = Math.max(0.18, A.wheelR * 0.6), hw = Math.max(0.35, A.hw - 0.16);
    const box = (w, h, d, sx, sy, sz, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d, sx, sy, sz), mat); m.position.set(x, y, z); m.userData.dmgBay = true; m.castShadow = false; m.receiveShadow = true; g.add(m); return m; };
    // the bay's walls seen from inside (fine enough to be bent to the body's shape below)
    const wall = box(hw * 2, top - bot, back - front - 0.08, 14, 5, 8, BAY_DARK, 0, (top + bot) / 2, (front + back) / 2 + 0.04);
    { const wg = wall.geometry, ix = wg.index.array, keep = [];
      for (const gr of wg.groups) if (gr.materialIndex !== 2 && gr.materialIndex !== 5) for (let i = gr.start; i < gr.start + gr.count; i++) keep.push(ix[i]);
      wg.setIndex(keep); wg.clearGroups(); }
    // what is in it, by its size: the condenser and radiator behind the grille (one mesh), then the engine with its
    // cover, intake and air box, the strut towers, battery, coolant tank, hoses, and the bumper's white absorber (all
    // one vertex-coloured mesh). A car with its engine elsewhere (the 930's is at the back, the Roadster and the Semi
    // are electric) has a flat motor or a luggage tray instead.
    const H = top - bot, Lb = back - front, id = this.rig.id || '', noEngine = /porsche930|roadster|semi/.test(id);
    const fins = new THREE.Mesh(mergeParts([
      [new THREE.BoxGeometry(hw * 1.75, H * 0.72, 0.035, 12, 4, 1), 0, bot + H * 0.42, front + 0.14],
      [new THREE.BoxGeometry(hw * 1.65, H * 0.7, 0.05, 12, 4, 1), 0, bot + H * 0.42, front + 0.21],
    ], false), BAY_FINS);
    fins.userData.dmgBay = true; fins.castShadow = false; fins.receiveShadow = false; g.add(fins);
    const P = [], C = (geo, x, y, z, col, rx = 0, rz = 0) => P.push([geo, x, y, z, col, rx, rz]);
    const bz0 = A.bumpers.front, absY = (bz0.y0 + bz0.y1) / 2;
    C(new THREE.BoxGeometry(hw * 1.7, Math.max(0.08, (bz0.y1 - bz0.y0) * 0.45), 0.08, 8, 1, 1), 0, absY, front + 0.07, 0xdcdcd6);
    if (!noEngine) {
      const ew = Math.min(0.72, hw * 1.05), eh = H * 0.5, ed = Math.min(0.55, Lb * 0.4), ez = front + 0.3 + ed / 2;
      C(new THREE.BoxGeometry(ew, eh, ed, 3, 2, 3), 0, bot + 0.06 + eh / 2, ez, 0xc2c4c6);
      C(new THREE.BoxGeometry(ew * 0.86, 0.07, ed * 0.8, 3, 1, 3), 0, bot + 0.06 + eh + 0.035, ez, 0x474849);
      C(new THREE.CylinderGeometry(0.05, 0.05, ew * 0.9, 10, 1), 0, bot + 0.06 + eh * 0.85, ez - ed / 2 - 0.05, 0xb4b7ba, 0, Math.PI / 2);
      C(new THREE.BoxGeometry(0.28, 0.16, 0.3, 2, 1, 2), hw * 0.62, bot + H * 0.72, ez, 0x444546);
      C(new THREE.BoxGeometry(0.24, 0.19, 0.17, 1, 1, 1), -hw * 0.62, bot + H * 0.6, back - 0.2, 0x3e3f40);
      C(new THREE.BoxGeometry(0.14, 0.12, 0.13, 1, 1, 1), hw * 0.62, bot + H * 0.66, back - 0.22, 0xd8d3c4);
      for (const sx of [-1, 1]) C(new THREE.CylinderGeometry(0.085, 0.1, H * 0.75, 10, 2), sx * (hw - 0.09), bot + H * 0.42, back - 0.1, 0x8c8f92);
      C(new THREE.CylinderGeometry(0.024, 0.024, 0.34, 8, 3), hw * 0.35, bot + H * 0.55, front + 0.33, 0x37383a, Math.PI / 2 - 0.35, 0.2);
      C(new THREE.CylinderGeometry(0.024, 0.024, 0.3, 8, 3), -hw * 0.3, bot + H * 0.3, front + 0.32, 0x37383a, Math.PI / 2 + 0.3, -0.15);
    } else {
      // a flat motor and its inverter low down, or the 930's luggage tray
      C(new THREE.BoxGeometry(hw * 1.5, 0.08, Lb * 0.6, 4, 1, 4), 0, bot + 0.05, front + Lb * 0.5, 0x1c1d1f);
      if (!/porsche930/.test(id)) C(new THREE.BoxGeometry(hw * 0.9, H * 0.3, Lb * 0.3, 2, 1, 2), 0, bot + 0.09 + H * 0.15, front + Lb * 0.55, 0x6f7276);
    }
    const parts = new THREE.Mesh(mergeParts(P, true), BAY_PARTS);
    parts.userData.dmgBay = true; parts.castShadow = false; parts.receiveShadow = false; g.add(parts);
    parent.add(g);
    g.updateMatrixWorld(true);
    const mine = [];
    for (const m of g.children) { m.updateMatrix(); const e = new Entry(this, m, 'body'); e.L = 0.08; e.prefined = true; e.own(); mine.push(e); }
    this.bay = g;
    // the boxes kept inside the body as it is now: a car's front is rounded, and a square box out to the bumper's
    // front showed its corners through the wings (a dark slab standing at the front corner after a crash)
    const map = yield* this.skinMapGen(job, front, back);
    for (const e of mine) { this.fitBay(e, map, 0.07, true); E.push(e); }
  }
  // the body's skin over the front: how far forward it reaches at each height and width (4 cm cells), how far out at
  // each height and length
  *skinMapGen(job, z0, z1) {
    const A = this.A, C = 0.04, NX = Math.ceil((2 * A.hw + 0.2) / C), NY = Math.ceil((A.roofY + 0.1) / C), NZ = Math.ceil((z1 - z0 + 0.2) / C);
    const fz = new Float32Array(NX * NY).fill(Infinity), sx = new Float32Array(NY * NZ).fill(-1), x0 = -A.hw - 0.1, zs = z0 - 0.1;
    for (const e of this.list()) {
      if (e.role === 'proxy' || e.role === 'far' || e.role === 'glass' || e.partOf || e.mesh.userData.dmgBay || A.interior[this.entries.indexOf(e)]) continue;
      if (e.box && (e.box.min.z > z1 || e.box.max.z < z0) && !e.cur) continue;
      const P = e.cur || (e._sp || (e._sp = e.srcPositions()));
      for (let i = 0; i < P.length; i += 3) {
        if ((i & 32767) === 32766 && performance.now() >= job.deadline) yield;
        const x = P[i], y = P[i + 1], z = P[i + 2];
        if (z > z1 || z < zs) continue;
        const iy = Math.floor(y / C); if (iy < 0 || iy >= NY) continue;
        const ix = Math.floor((x - x0) / C); if (ix >= 0 && ix < NX) { const k = iy * NX + ix; if (z < fz[k]) fz[k] = z; }
        const iz = Math.floor((z - zs) / C); if (iz >= 0 && iz < NZ) { const k = iy * NZ + iz, ax = x < 0 ? -x : x; if (ax > sx[k]) sx[k] = ax; }
      }
    }
    return { C, NX, NY, NZ, x0, zs, fz, sx };
  }
  // a bay box's points moved inside the skin: behind its front (by gap), within its sides, under the bonnet
  fitBay(e, M, gap, rest) {
    const c = e.cur; if (!c) return;
    const { C, NX, NY, NZ, x0, zs, fz, sx } = M;
    for (let i = 0; i < c.length; i += 3) {
      let x = c[i], y = c[i + 1], z = c[i + 2];
      const iy = Math.floor(y / C), ix = Math.floor((x - x0) / C);
      // the skin's front here: the nearest cells that have any (a grille's holes have none)
      let f = Infinity;
      for (let r = 1; r <= 3 && f === Infinity; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const yy = iy + dy, xx = ix + dx; if (yy < 0 || yy >= NY || xx < 0 || xx >= NX) continue; const v = fz[yy * NX + xx]; if (v < f) f = v; }
      if (f < Infinity && z < f + gap) z = f + gap;
      const iz = Math.floor((z - zs) / C);
      let w = Infinity;
      for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) { const yy = iy + dy, zz = iz + dz; if (yy < 0 || yy >= NY || zz < 0 || zz >= NZ) continue; const v = sx[yy * NZ + zz]; if (v >= 0 && v < w) w = v; }
      if (w < Infinity && Math.abs(x) > w - 0.06) x = Math.sign(x) * Math.max(0, w - 0.06);
      const t = this.topAt(x, z);
      if (t > 0 && y > t - 0.05) y = Math.max(0.1, t - 0.05);
      c[i] = x; c[i + 1] = y; c[i + 2] = z;
      if (rest && e.rest) { e.rest[i] = x; e.rest[i + 1] = y; e.rest[i + 2] = z; }
    }
    e.writePositions();
    if (e.geo) e.geo.computeVertexNormals();
  }
  // airbags: the two in front (wheel and dashboard) or a side's curtain, fired and then sagging
  deployBags(which) {
    if (!this.bags) this.bags = [];
    if (this.bags.some(b => b.which === which)) return;
    const A = this.analysis(), rig = this.rig;
    const parent = rig.model && rig.model.isObject3D ? rig.model : this.root;
    const add = (geo, pos, scale, quat, kind) => {
      const m = new THREE.Mesh(geo, BAG); m.name = 'airbag'; m.castShadow = false; m.receiveShadow = true;
      m.position.copy(pos); if (quat) m.quaternion.copy(quat); m.scale.setScalar(0.01); m.userData.full = scale.clone();
      parent.add(m); this.bags.push({ which, mesh: m, t: 0, kind });
    };
    if (which === 'front') {
      // the driver's: on the wheel's hub, towards the driver; the passenger's: out of the dashboard opposite
      let hub = null, axis = new THREE.Vector3(0, 0.35, 1).normalize();
      if (rig._steer && rig._steer.node) {
        const n = rig._steer.node; let M = new THREE.Matrix4().copy(n.matrix), o = n.parent; n.updateMatrix(); M.copy(n.matrix);
        while (o && o !== this.root) { o.updateMatrix(); M.premultiply(o.matrix); o = o.parent; }
        hub = new THREE.Vector3().setFromMatrixPosition(M);
        axis = rig._steer.axis.clone().transformDirection(new THREE.Matrix4().extractRotation(M.clone().multiply(new THREE.Matrix4().copy(n.matrix).invert())));
      }
      if (!hub && rig.mounts && rig.mounts.driver) hub = rig.mounts.driver.clone().add(new THREE.Vector3(0, -0.32, -0.45));
      if (!hub) return;
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
      add(bagGeometry(), hub.clone().addScaledVector(axis, 0.17), new THREE.Vector3(0.3, 0.3, 0.3), q, 'front');
      const pas = new THREE.Vector3(-hub.x, hub.y + 0.1, hub.z - 0.12);
      add(bagGeometry(), pas.addScaledVector(axis, 0.12), new THREE.Vector3(0.36, 0.32, 0.36), q, 'front');
    } else {
      const sg = which === 'L' ? -1 : 1;
      const sides = A.windows.filter(w => w.kind === 'side' && w.side === which && !w.merged);
      const z0 = sides.length ? Math.min(...sides.map(w => w.box.min.z)) + 0.05 : A.zA + 0.2, z1 = sides.length ? Math.max(...sides.map(w => w.box.max.z)) - 0.05 : A.zC - 0.2;
      // inside the side glass: from the top of the windows down, as far in as the glass is at its top (it leans in)
      const top = sides.length ? Math.max(...sides.map(w => w.box.max.y)) : A.roofY - 0.12;
      const inner = sides.length ? Math.min(...sides.map(w => Math.min(Math.abs(w.box.min.x), Math.abs(w.box.max.x)))) : A.hwBelt - 0.25;
      const y1 = Math.min(A.roofY - 0.1, top - 0.03), y0 = Math.max(A.belt + 0.02, y1 - 0.42);
      if (z1 - z0 < 0.3 || y1 - y0 < 0.1) return;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), sg * Math.PI / 2);
      add(curtainGeometry(), new THREE.Vector3(sg * (inner - 0.07), (y0 + y1) / 2, (z0 + z1) / 2), new THREE.Vector3(z1 - z0, y1 - y0, 1), q, 'curtain');
      this.bags[this.bags.length - 1].mesh.material = CURTAIN; this.bags[this.bags.length - 1].mesh.renderOrder = 2;
      const b = this.bags[this.bags.length - 1]; b.baseY = b.mesh.position.y;
    }
    this.damaged = true;
    this.mgr.emit({ type: 'airbag', car: this.rig, which });
  }
  animateBags(dt) {
    for (const b of this.bags) {
      b.t += dt;
      const f = b.mesh.userData.full, t = b.t;
      // out in about 30 ms, then (the front ones) vented down to a soft sag over half a second
      const k = t < 0.03 ? t / 0.03 : b.kind === 'front' ? 1 - 0.45 * Math.min(1, (t - 0.08) / 0.5) * (t > 0.08 ? 1 : 0) : 1;
      if (b.kind === 'front') b.mesh.scale.set(f.x * k, f.y * (0.75 + 0.25 * k), f.z * k);
      else {
        // (a roof pushed down takes the curtain with it, squashed: it hung from the roof rail)
        const drop = Math.min(f.y * 0.8, (this.roofDrop || 0) * 0.85);
        b.mesh.scale.set(f.x * Math.min(1, t / 0.03), Math.max(0.05, f.y - drop) * Math.min(1, t / 0.03), 1);
        if (b.baseY !== undefined) b.mesh.position.y = b.baseY - drop / 2;
      }
    }
  }

  // back to new: every mesh, material, part and glow as the model made them
  reset() {
    const rig = this.rig;
    this.mgr.jobs = this.mgr.jobs.filter(j => j.rd !== this); this.job = null;
    for (const p of this.parts.values()) {
      if (p.debris) { const i = this.mgr.fx.debris.indexOf(p.debris); if (i >= 0) this.mgr.fx.debris.splice(i, 1); }
      if (p.group.parent) p.group.parent.remove(p.group);
      for (const m of p.meshes) if (m.geometry) m.geometry.dispose();
    }
    this.parts.clear();
    if (this.bay) { if (this.bay.parent) this.bay.parent.remove(this.bay); for (const m of this.bay.children) m.geometry.dispose(); this.bay = null; }
    if (this.bags) { for (const b of this.bags) if (b.mesh.parent) b.mesh.parent.remove(b.mesh); this.bags = null; }
    if (this.entries) for (const e of this.entries) { if (e.partOf || e.mesh.userData.dmgBay) continue; e.restore(); e.mesh.material = e.srcMat; }
    // materials back (the player's lamps re-made by the rig itself below)
    if (this.mats) { for (const c of this.mats.copies.values()) c.dispose(); for (const m of [...this.mats.paint, ...this.mats.glass]) { const U = UNIFORMS.get(m); if (U) { U.uDmgOn.value = 0; if (U.uDmgMap) U.uDmgMap.value = blank(); if (U.uCrack) U.uCrack.value = blank(); } } }
    if (this._setPaint) { rig.setPaint = this._setPaint; this._setPaint = null; }
    this.mats = null;
    if (this.atlas) { this.atlas.rt.dispose(); this.atlas = null; }
    // (the player's crack map is kept, cleared, so the next crash does not upload a new one)
    if (this.crack) { if (this.npc) { this.crack.tex.dispose(); this.crack = null; } else { this.crack.g.clearRect(0, 0, this.crack.S, this.crack.S); this.crack.tex.needsUpdate = true; this.crack.fresh = true; } }
    // wheels
    this.wheels.forEach((st, i) => {
      const rw = rig._w && rig._w[i]; if (!rw) return;
      if (st.debris) { const k = this.mgr.fx.debris.indexOf(st.debris); if (k >= 0) this.mgr.fx.debris.splice(k, 1); if (st.debris.obj.parent) st.debris.obj.parent.remove(st.debris.obj); }
      if (st.keep) { if (st.keep.spin.parent) st.keep.spin.parent.remove(st.keep.spin); rw.pivot.add(st.keep.spin); st.keep.spin.position.set(0, 0, 0); st.keep.spin.quaternion.identity(); }
      if (st.bend) { st.bend.remove(rw.spin); rw.pivot.add(rw.spin); rw.pivot.remove(st.bend); }
      if (st.base) rw.pivot.position.set(st.base.x, rw.pivot.position.y, st.base.z);
      if (this.vehicle && this.vehicle.wheels[i]) { const vw = this.vehicle.wheels[i]; vw.toe = 0; vw.gone = false; if (vw.rest0) { vw.rest.copy(vw.rest0); vw.rest0 = null; } }
    });
    this.wheels = [{}, {}, {}, {}];
    // lamps: the rig rebuilds its lamp list from the model's names
    if (rig._lamps && this.lampsBroken.size) {
      for (const L of rig._lamps) {
        L.meshes = []; L.level = -1;
      }
      (rig.model && rig.model.isObject3D ? rig.model : rig.object).traverse(o => {
        const mm = /^lamp_(head|tail|brake|signal|reverse)_([LRC])/.exec(o.name); if (!mm) return;
        const L = rig._lamps.find(l => l.role === mm[1] && l.side === mm[2]); if (!L) return;
        o.traverse(c => { if (c.isMesh && c.userData.lampSrc && !L.meshes.includes(c)) L.meshes.push(c); });
      });
      if (rig._glowAll) for (const [L, gl] of rig._glowAll) L.glows = gl.slice();
      if (rig._beamsAll) rig._beams = rig._beamsAll.slice();
      rig._setLamps && rig._setLamps(true);
    }
    if (this.cabin) { this.cabin.clear(); if (this.cabin.mesh.parent) this.cabin.mesh.parent.remove(this.cabin.mesh); this.cabin = null; }
    this.mgr.fx.stopEmitters(this.root);
    this.lampsBroken.clear();
    this.doors = []; this.hard = null; this.windows = null; this.winState = null; this.pending = null;
    this.entries = null; this.A = null;
    this.damaged = false; this.crushTotal = this.front = this.rear = this.left = this.right = this.roof = this.engine = this.bonnetH = this.bootH = this.roofDrop = this.wingDone = this.lidEdge = 0; this.lidFolded = false; this.cracks = {};
    this.stamps.length = 0;
    if (this.vehicle) { this.vehicle.powerK = 1; }
    this.readied = false;
    if (this.vehicle && this.mgr.drive.car && this.mgr.drive.car.rig === this.rig) this.mgr.ready(this);
  }
}
function A_belt(rd) { return rd.A ? rd.A.belt : 1; }
// a car record's footprint on the ground ({ x, z, yaw, offYaw } as traffic.js keeps them, and its dims)
function footprint(c, d) {
  const h = c.yaw + (c.offYaw || 0), fx = Math.sin(h), fz = -Math.cos(h), oc = (d.front - d.rear) / 2;
  return { cx: c.x + fx * oc, cz: c.z + fz * oc, fx, fz, rx: Math.cos(h), rz: Math.sin(h), hl: d.length / 2 - 0.05, hw: d.width / 2 - 0.04 };
}
// two footprints overlapping: the way out (n, from a to b), how deep, and the middle of the touching part
function overlap(a, b) {
  let best = Infinity, nx = 0, nz = 0;
  const dx = b.cx - a.cx, dz = b.cz - a.cz;
  for (const [ax, az] of [[a.fx, a.fz], [a.rx, a.rz], [b.fx, b.fz], [b.rx, b.rz]]) {
    const ra = a.hl * Math.abs(a.fx * ax + a.fz * az) + a.hw * Math.abs(a.rx * ax + a.rz * az);
    const rb = b.hl * Math.abs(b.fx * ax + b.fz * az) + b.hw * Math.abs(b.rx * ax + b.rz * az);
    const dist = dx * ax + dz * az, pen = ra + rb - Math.abs(dist);
    if (pen <= 0) return null;
    if (pen < best) { best = pen; const sg = dist < 0 ? -1 : 1; nx = ax * sg; nz = az * sg; }
  }
  // the contact: across n, the middle of where both reach; along n, the middle of the overlap
  const tx = -nz, tz = nx;
  const span = (f, ux, uz) => { const c = f.cx * ux + f.cz * uz, r = f.hl * Math.abs(f.fx * ux + f.fz * uz) + f.hw * Math.abs(f.rx * ux + f.rz * uz); return [c - r, c + r]; };
  const [a0, a1] = span(a, tx, tz), [b0, b1] = span(b, tx, tz), mt = (Math.max(a0, b0) + Math.min(a1, b1)) / 2;
  const an1 = span(a, nx, nz)[1], bn0 = span(b, nx, nz)[0], mn = (an1 + bn0) / 2;
  return { nx, nz, pen: best, px: nx * mn + tx * mt, pz: nz * mn + tz * mt };
}

// several part geometries as one (each moved, turned and, with colours, painted); a bay's parts are one draw
function mergeParts(list, colours) {
  const pos = [], nor = [], uv = [], col = [], idx = [];
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), Nm = new THREE.Matrix3(), c = new THREE.Color();
  for (const it of list) {
    const [geo, x, y, z, hex, rx, rz] = colours ? it : [it[0], it[1], it[2], it[3], 0, 0, 0];
    E.set(rx || 0, 0, rz || 0); Q.setFromEuler(E); M.compose(V.set(x, y, z), Q, new THREE.Vector3(1, 1, 1)); Nm.getNormalMatrix(M);
    geo.applyMatrix4(M);
    const base = pos.length / 3, p = geo.attributes.position, n = geo.attributes.normal, u = geo.attributes.uv;
    if (colours) c.setHex(hex).convertSRGBToLinear();
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
      if (colours) col.push(c.r, c.g, c.b);
    }
    const ix = geo.index ? geo.index.array : null;
    if (ix) for (let i = 0; i < ix.length; i++) idx.push(ix[i] + base); else for (let i = 0; i < p.count; i++) idx.push(i + base);
    geo.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (colours) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

function bumperBox(A, bz) { return new THREE.Box3(new THREE.Vector3(A.box.min.x - 0.1, bz.y0, bz.z0), new THREE.Vector3(A.box.max.x + 0.1, bz.y1, bz.z1)); }

// a laminated windscreen's crack: radial cracks from the hit, rings joining them, a crushed star in the middle
function spiderWeb(g, cx, cy, size, sl, s) {
  g.save();
  g.beginPath(); g.rect(sl[0], sl[1], sl[2], sl[3]); g.clip();
  g.lineCap = 'round'; g.lineJoin = 'round';
  // the white crush at the point of impact
  const gr = g.createRadialGradient(cx, cy, 0, cx, cy, size * 0.12);
  gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = gr; g.fillRect(cx - size * 0.15, cy - size * 0.15, size * 0.3, size * 0.3);
  const nRad = Math.round(12 + s * 8), rays = [];
  for (let i = 0; i < nRad; i++) {
    let a = (i + Math.random() * 0.6) / nRad * Math.PI * 2, x = cx, y = cy;
    const pts = [[x, y]], len = size * rnd(0.45, 1.0);
    let l = 0;
    while (l < len) { const st = size * rnd(0.04, 0.09); a += rnd(-0.25, 0.25); x += Math.cos(a) * st; y += Math.sin(a) * st; l += st; pts.push([x, y]); }
    rays.push(pts);
    g.strokeStyle = 'rgba(255,0,0,0.9)'; g.lineWidth = rnd(0.8, 1.6);
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts) g.lineTo(p[0], p[1]); g.stroke();
    // a few branches
    for (let b = 0; b < 2; b++) {
      const k = 2 + (Math.random() * (pts.length - 2) | 0); if (!pts[k]) continue;
      let ba = a + rnd(-1, 1), bx = pts[k][0], by = pts[k][1];
      g.beginPath(); g.moveTo(bx, by);
      for (let j = 0; j < 4; j++) { ba += rnd(-0.4, 0.4); bx += Math.cos(ba) * size * 0.05; by += Math.sin(ba) * size * 0.05; g.lineTo(bx, by); }
      g.lineWidth = 0.7; g.stroke();
    }
  }
  // rings: joining the rays at a few radii
  const nRing = Math.round(3 + s * 3);
  for (let k = 1; k <= nRing; k++) {
    const f = k / (nRing + 1) * rnd(0.85, 1.1);
    g.strokeStyle = 'rgba(255,0,0,' + (0.85 - k * 0.08).toFixed(2) + ')'; g.lineWidth = rnd(0.6, 1.2);
    g.beginPath();
    let first = true;
    for (const r of rays) { const p = r[Math.min(r.length - 1, Math.max(1, Math.round(f * r.length)))]; if (!p) continue; if (first) { g.moveTo(p[0] + rnd(-1, 1), p[1] + rnd(-1, 1)); first = false; } else if (Math.random() < 0.8) g.lineTo(p[0] + rnd(-2, 2), p[1] + rnd(-2, 2)); else g.moveTo(p[0], p[1]); }
    g.stroke();
  }
  // a haze of tiny cracks near the middle (green channel)
  g.fillStyle = 'rgba(0,255,0,0.5)';
  for (let i = 0; i < 60 * (0.5 + s); i++) { const a = Math.random() * 6.28, d = Math.pow(Math.random(), 2) * size * 0.25; g.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1.2, 1.2); }
  g.restore();
}

// ---------------------------------------------------------------------------------------------------------
// the manager: one per drive

export class Damage {
  constructor(drive) {
    this.drive = drive;
    this.scene = drive.scene;
    this.fx = new FX(drive.scene, { sound: drive.sound });
    this.stamper = new Stamper(drive.G.renderer);
    this.rigs = new Set();
    this.shared = new WeakSet(); // materials shared between cars (traffic paint and glass)
    this.groundFn = (x, z, y) => { try { return drive.ground(x, z, y); } catch (e) { return null; } };
    this.wallsFn = (x, z, r, y) => { const C = drive.collide; if (!C || !C.contacts) return null; try { return C.contacts([{ x, z, r, y0: y - 0.3, y1: y + 0.3 }]); } catch (e) { return null; } };
    this.lastCrush = null; this.n = { impacts: 0, scrapes: 0 };
    // the extra materials (broken lens, engine bay, airbags) built with the scene: a speck of each, drawn far under
    // the ground (an object that is not visible is not compiled, and its shader was then built in the crash's frame)
    // (hidden again once they have been drawn for a while, updateBody: drawn every frame they were seven draws and
    // seven material changes a frame; their programs stay built; perf)
    this.holders = [];
    for (const m of [BROKEN_LENS, BAY_FINS, BAY_ENGINE, BAY_DARK, BAG, BAY_PARTS, CURTAIN]) {
      const hold = new THREE.Mesh(new THREE.BoxGeometry(0.001, 0.001, 0.001), m); hold.name = 'damage_holder';
      hold.position.set(0, -5000, 0); hold.frustumCulled = false; hold.castShadow = false; hold.receiveShadow = true;
      this.fx.group.add(hold); this.holders.push(hold);
    }
    this.lastStamp = 0;
    this.scrapeLevel = 0;
    this.jobs = []; this.bg = [];
    this.trafficDamaged = [];
    // parked cars that were hit: each one's instance swapped for a real car (it can then be damaged)
    this.parkedRecs = []; this.parkedGroup = new THREE.Group(); this.parkedGroup.name = 'damage_parked';
    if (drive.scene) drive.scene.add(this.parkedGroup);
    this.pairs = new Map(); this.kid = 0;
    // every car made from now on gets the damage patch and its door pivots
    const C = drive.mods && drive.mods.cars;
    if (C && C.rigHooks && !C.rigHooks.includes(this._hook)) { this._hook = rig => this.prepare(rig); C.rigHooks.push(this._hook); }
    if (typeof window !== 'undefined' && window.__car) window.__car.damage = this;
  }

  emit(e) {
    const t = performance.now();
    try { if (this.drive.events) this.drive.events.dispatchEvent(e); } catch (err) { console.warn('damage event', err); }
    // (time spent in other modules' listeners, for tests)
    const ms = performance.now() - t; (this.listenMs || (this.listenMs = [])).push([e.type, +ms.toFixed(1)]); if (this.listenMs.length > 60) this.listenMs.shift();
  }
  npcCap() { return this.trafficDamaged.length > 6; }

  // a new rig: patch its paint and glass (uniform off) so the shaders are built with everything else
  prepare(rig) {
    if (!rig || !rig.object || rig._dmgPrep) return;
    rig._dmgPrep = true;
    const shared = !!rig.npc;
    rig.object.traverse(o => {
      if (!o.isMesh) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (!m || UNIFORMS.has(m)) continue;
        if (m.name === 'paint' || (rig._paint && m === rig._paint)) { patchPaint(m, paintUniforms()); if (shared) this.shared.add(m); }
        else if (m.name === 'glass' && m.isMeshPhysicalMaterial) { patchGlass(m, glassUniforms()); if (shared) this.shared.add(m); }
      }
    });
    // what the lamps had, for a reset
    if (rig._lamps) { rig._glowAll = rig._lamps.map(L => [L, L.glows.slice()]); rig._beamsAll = rig._beams ? rig._beams.slice() : []; }
    rig.doorNode = i => { try { return this.of(rig).doorNode(i); } catch (e) { console.warn('door', e); return null; } };
    rig.setDoor = (i, k) => { try { this.of(rig).setDoor(i, k); } catch (e) { console.warn('door', e); } };
    Object.defineProperty(rig, 'doors', { configurable: true, get: () => { try { return this.of(rig).doorList().map(d => ({ side: d.side, front: d.front, hinge: d.hinge.clone(), axis: d.axis.clone(), open: d.open, box: d.box.clone() })); } catch (e) { return []; } } });
    rig.onFree = () => this.reset(rig);
    // a traffic car's paint swaps by colour: patch the new one too
    if (rig.npc && rig.setPaint && !rig._dmgPaintHook) {
      const orig = rig.setPaint.bind(rig);
      rig._dmgPaintHook = true;
      rig.setPaint = c => { orig(c); rig.object.traverse(o => { if (!o.isMesh) return; for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m && m.name === 'paint' && !UNIFORMS.has(m)) { patchPaint(m, paintUniforms()); this.shared.add(m); } }); };
    }
  }
  of(rig) {
    if (!rig._dmg) { rig._dmg = new CarDamage(this, rig); this.rigs.add(rig._dmg); }
    return rig._dmg;
  }
  isDamaged(rig) { return !!(rig && rig._dmg && rig._dmg.damaged); }

  // the player's car (and the vehicle on it)
  attachPlayer(car) {
    if (!car || !car.rig || !car.rig.object || !car.vehicle) return;
    const rd = this.of(car.rig);
    rd.vehicle = car.vehicle;
    const v = car.vehicle;
    if (v._dmgAttached) return;
    v._dmgAttached = true;
    v.bodyForces = (dt, env, F, Tq, up) => { try { this.bodyContacts(v, rd, dt, env, F, Tq, up); } catch (e) { if (!this._bcErr) { console.warn('body contacts', e); this._bcErr = true; } } };
    // physics left as damaged
    rd.wheels.forEach((st, i) => { if (st.toe && v.wheels[i]) v.wheels[i].toe = st.toe * 0.5; if (st.off && v.wheels[i]) v.wheels[i].gone = true; });
    v.powerK = this.powerOf(rd);
    this.ready(rd);
  }
  // made ready in the background, a step at a time: what the model is (so the first crash need not work it out),
  // and the crush's code run once
  ready(rd) {
    const car = { rig: rd.rig };
    if (!rd.readied) {
      rd.readied = true;
      const idle = window.requestIdleCallback || (f => setTimeout(f, 300));
      // (the doors are cut out when first wanted: getting in or out, or a crash; cutting all four here held the
      // frame for up to a fifth of a second each, just after a drop)
      // (the windscreen's crack map is made and sent to the graphics card now: its first upload, 12 to 22 ms, was in
      // the crash's frames)
      // (the model's analysis goes in the background list, a slice a frame; the steps after it wait for it. Done in
      // one go in an idle callback it was a long task of 0.6 to 1.5 s right after a drop; perf)
      const steps = [() => this.analyseLater(rd), () => this.warmUp(), () => { const C = rd.crackReady(); if (this.drive.G && this.drive.G.renderer && this.drive.G.renderer.initTexture) this.drive.G.renderer.initTexture(C.tex); }, () => this.presplit(rd), () => this.predoor(rd)];
      const first = steps[0];
      const next = () => {
        if (steps[0] !== first && steps.length && !rd.A && this.drive.car && this.drive.car.rig === car.rig) { idle(next, { timeout: 700 }); return; }
        const f = steps.shift(); if (!f) return;
        if (!this.drive.car || this.drive.car.rig !== car.rig) return;
        const t = performance.now();
        try { f(); } catch (e) { console.warn('damage ready', e); }
        (rd.readyMs || (rd.readyMs = [])).push(Math.round(performance.now() - t));
        idle(next, { timeout: 700 });
      };
      idle(next, { timeout: 1500 });
    }
  }
  // what the model is, worked out in the background (2 ms a frame, first in the list); a crash before it is done
  // works it out at once, as before
  analyseLater(rd) {
    if (rd.A) return;
    rd.list();
    const key = rd.rig.id + (rd.npc ? ':npc' : ':car') + ':' + rd.entries.length;
    if (ANALYSIS.has(key)) { rd.A = ANALYSIS.get(key); return; }
    if (this.bg.some(j => j.rd === rd && j.analysis)) return;
    const job = makeJob(rd, jb => analyseGen(jb, rd), A => { if (!rd.A && A) rd.A = A; });
    job.analysis = true;
    this.bg.unshift(job);
  }
  // the driver's door cut out ahead, a little each frame (the first E froze the game for up to half a second to do it)
  predoor(rd) {
    // (the model's analysis waited for in the background: doorList() would work it out at once, 0.2 to 0.4 s)
    if (rd.A && (!rd.A.doors.length || rd.doorState(0).pivot)) return;
    if (!rd.A) this.analyseLater(rd);
    const job = makeJob(rd, function* (jb) { while (!rd.A) yield WAIT; if (!rd.A.doors.length || rd.doorState(0).pivot) return; job.started = true; yield* rd.doorNodeGen(jb, 0); });
    job.door = 0; rd.doorJob = job;
    this.bg.push(job);
  }
  // A door cut out of the car's body ahead of its being opened (for onfoot.js): in bounded steps in the background
  // list, after the model's analysis (also in the background), one door of a car at a time, first in the list for
  // another car, after the car's own preparation for the player's. Resolves true once the door is cut (its pivot is
  // rig._dmg.doors[i].pivot), false when the car has no such door. The job is the car's door job (rig._dmg.doorJob)
  // while it runs, so the code that runs a car's queued work while someone waits at it (onfoot pumpDoor) finishes it.
  prepareDoor(rig, i) {
    if (!rig || rig.fake || typeof rig.doorNode !== 'function' || !(i >= 0)) return Promise.resolve(false);
    const rd = this.of(rig), cut = () => { const st = rd.doors && rd.doors[i]; return !!(st && st.pivot); };
    if (cut()) return Promise.resolve(true);
    if (rd.A && i >= rd.A.doors.length) return Promise.resolve(false);
    const P = rd.doorPromises || (rd.doorPromises = {});
    if (P[i]) return P[i];
    const mine = this.drive.car && this.drive.car.rig === rig;
    if (!rd.A) this.analyseLater(rd);
    P[i] = new Promise(resolve => {
      const job = makeJob(rd, function* (jb) {
        while (!rd.A) yield WAIT;
        if (i >= rd.A.doors.length) return false;
        // another door of this car being cut: after it
        while (rd.doorJob && rd.doorJob !== job && !rd.doorJob.done) yield WAIT;
        if (cut()) return true;
        rd.doorJob = job; job.started = true;
        yield* rd.doorNodeGen(jb, i);
        return true;
      }, () => { delete P[i]; resolve(cut()); });
      job.door = i; job.prepare = true;
      // (another car's: first in the list, but after its model's analysis, which it waits for)
      if (mine) this.bg.push(job); else { const at = this.bg.findIndex(j => j.rd === rd && j.analysis); this.bg.splice(at >= 0 ? at + 1 : 0, 0, job); }
    });
    return P[i];
  }
  // the player's coarse outside meshes subdivided ahead (a little each frame, while nothing else is going on), so a
  // crash only has to move points
  presplit(rd) {
    // (the model worked out in the background first, not here and now: from a change of car, drive.setCar's reset,
    // that held the frame for 0.2 to 0.4 s)
    if (!rd.A) this.analyseLater(rd);
    this.bg.push(makeJob(rd, function* (job) {
      while (!rd.A) yield WAIT;
      const A = rd.A;
      for (const e of rd.list()) {
        if (rd.mgr.drive.car && rd.mgr.drive.car.rig !== rd.rig) return;
        // the cabin's trim made the car's own too (no subdividing): owned in a crash, its new buffers were uploaded
        // in the frames after it
        if (!e.prefined && !e.partOf && e.role !== 'proxy' && e.role !== 'far' && e.role !== 'glass' && A.interior[rd.entries.indexOf(e)]) { if (!e.cur) { e.own(); yield; } continue; }
        if (e.prefined || e.role === 'proxy' || e.role === 'far' || e.partOf || A.interior[rd.entries.indexOf(e)]) continue;
        if (e.role === 'glass') rd.ownGlass(e); else e.own();
        if (e.fine === undefined) e.fine = meanEdge(e) < e.L * 0.8;
        yield;
        if (!e.fine) yield* refineGen(job, e, () => true, e.L, 3);
        e.prefined = true;
        yield;
      }
      // the paint's damage map made now too (its render target and every painted mesh's attributes were set up in a
      // crash's frames)
      if (!rd.mgr.drive.car || rd.mgr.drive.car.rig === rd.rig) { try { rd.atlasReady(); } catch (e) {} }
    }));
  }
  // the crush's code run once on a small stand-in car, so the first real crash does not wait for the browser to
  // optimise it
  warmUp() {
    if (this.warmed) return; this.warmed = true;
    const T0 = performance.now();
    const object = new THREE.Group(), model = new THREE.Group(); object.add(model);
    const paint = new THREE.MeshStandardMaterial({ name: 'paint' }), glass = new THREE.MeshPhysicalMaterial({ name: 'glass' });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 4.4, 6, 3, 12), paint); body.position.y = 0.55; body.name = 'body'; model.add(body);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 2.2, 2, 2, 4), glass); cab.position.set(0, 1.15, 0.2); cab.name = 'glass'; model.add(cab);
    const wheels = [[-0.8, 0.33, -1.4], [0.8, 0.33, -1.4], [-0.8, 0.33, 1.4], [0.8, 0.33, 1.4]].map(p => ({ pos: new THREE.Vector3(...p), radius: 0.33 }));
    const rig = { id: '_warm', npc: true, spec: { mass: 1400 }, object, model, wheels, dims: { length: 4.4, width: 1.8, height: 1.45, wheelbase: 2.8, track: 1.6, front: 2.2, rear: 2.2 } };
    const rd = new CarDamage(this, rig);
    UNIFORMS.set(paint, paintUniforms());
    try {
      for (const [P, N, D, kind] of [[[0, 0, -3], [0, 0, 1], 0.4, 'flat'], [[-1.5, 0, 0], [1, 0, 0], 0.3, 'pole'], [[0, 0, 3], [0, 0, -1], 0.3, 'car']]) {
        const res = rd.crush({ P: new THREE.Vector3(...P), N: new THREE.Vector3(...N), D, kind, r: 0.15, b0: kind === 'car' ? 0.2 : -Infinity, b1: kind === 'car' ? 0.9 : Infinity, speed: 10 });
        if (res && res.job) res.job.run(1e9);
      }
      rd.cut('warm', (x, y, z) => z < -1.6, new THREE.Vector3(0, 0.5, -1.8), { box: new THREE.Box3(new THREE.Vector3(-2, 0, -3), new THREE.Vector3(2, 2, -1.6)) });
    } catch (e) { console.warn('damage warm-up', e); }
    for (const e of rd.entries || []) if (e.geo) e.geo.dispose();
    ANALYSIS.delete('_warm:npc:' + (rd.entries ? rd.entries.length : 0));
    this.warmMs = Math.round(performance.now() - T0);
  }
  // the crash sounds' noise buffer made once the car's sound has started (the first crunch made it, 2 ms, in a crash)
  soundReady() { try { const S = this.fx.sound; if (S && S.ctx && !S.buf) S.noise(1); } catch (e) {} }
  powerOf(rd) { return clamp(1 - Math.max(0, rd.engine - 0.15) * 1.1, 0.12, 1); }

  // ---- after each physics step of the player's car
  step(v, dt, env) {
    const car = this.drive.car;
    if (!car || car.vehicle !== v || !car.rig || !car.rig.spec) return;
    if (!v._dmgAttached || this.of(car.rig).vehicle !== v) this.attachPlayer(car);
    const rd = this.of(car.rig);
    const now = performance.now();
    // impacts: one per thing hit this step (several of the body's circles touch the same wall)
    if (v.hits && v.hits.length) {
      const groups = new Map();
      for (const h of v.hits) {
        if (!(h.speed > V_ELASTIC)) continue;
        const key = h.other ? h.other.obj : h.shape || 'wall' + Math.round(h.nx * 4) + Math.round(h.nz * 4);
        const g = groups.get(key);
        if (!g || h.speed > g.speed) groups.set(key, h);
      }
      for (const h of groups.values()) this.playerHit(rd, v, h, env);
    }
    // a hard landing the flight module's body contact saw (a drop, a jump, a roll onto the roof)
    const gh = v.groundHit;
    if (gh && gh.t !== rd.lastGH && gh.speed > 3) {
      rd.lastGH = gh.t;
      const o = v.origin(), qi = _q.copy(v.q).invert();
      const N = new THREE.Vector3(0, 1, 0).applyQuaternion(qi);
      const P = new THREE.Vector3(gh.x, gh.y, gh.z).sub(o).applyQuaternion(qi);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(v.q);
      if (up.y < 0.5 || v.airTime > 0.2) {
        const imp = { P, N, speed: gh.speed, kind: 'ground', world: new THREE.Vector3(gh.x, gh.y, gh.z), normal: new THREE.Vector3(0, 1, 0), rollover: up.y < 0.3 };
        if (N.y < -0.6) rd.roof = Math.min(0.5, rd.roof + Math.max(0, gh.speed - 2) * 0.03);
        this.impact(rd, imp, { mSelf: rd.mass, vehicle: v });
      }
    }
    // scraping: anything in contact while sliding along it
    this.scrape(rd, v, dt, env);
  }

  // a hit from the physics (one of vehicle.hits) on the player's car
  playerHit(rd, v, h, env) {
    const A = rd.analysis();
    const o = v.origin();
    const q = v.q, qi = _q.copy(q).invert();
    const gy = o.y;
    // the push on the car (world, horizontal), into the car's frame
    const Nw = new THREE.Vector3(h.nx, 0, h.nz);
    const N = Nw.clone().applyQuaternion(qi); if (Math.abs(N.y) < 0.6) { N.y = 0; N.normalize(); }
    const P = new THREE.Vector3(h.px, gy, h.pz).sub(o).applyQuaternion(qi); P.y = 0;
    const imp = { P, N, speed: h.speed, kind: 'flat', t0: -Infinity, t1: Infinity, b0: -Infinity, b1: Infinity, world: new THREE.Vector3(h.px, gy + 0.5, h.pz), normal: Nw };
    let mOther = Infinity, mul = 1;
    const s = h.shape;
    if (h.other) {
      const c = h.other.obj;
      const od = c && c.rig && c.rig.dims ? c.rig.dims : { width: 1.8, length: 4.5, height: 1.45 };
      mOther = (c && c.rig && c.rig.spec && c.rig.spec.mass) || 1500;
      imp.kind = 'car'; imp.b0 = 0.22; imp.b1 = Math.max(0.6, od.height * 0.62); imp.edge = 0.28;
      // its extent across the push: the other car's corners, projected
      const T = new THREE.Vector3(0, 1, 0).cross(N).normalize();
      let lo = Infinity, hi = -Infinity;
      if (c) {
        const fx = Math.sin(c.yaw + (c.offYaw || 0)), fz = -Math.cos(c.yaw + (c.offYaw || 0));
        for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const wx = c.x + fx * a * od.length / 2 - fz * b * od.width / 2, wz = c.z + fz * a * od.length / 2 + fx * b * od.width / 2;
          const pl = new THREE.Vector3(wx, gy, wz).sub(o).applyQuaternion(qi);
          const t = pl.sub(P).dot(T); lo = Math.min(lo, t); hi = Math.max(hi, t);
        }
      }
      imp.t0 = Number.isFinite(lo) ? lo : -0.9; imp.t1 = Number.isFinite(hi) ? hi : 0.9;
      imp.other = c;
    } else if (s && s.k === 2) {
      imp.kind = 'pole'; imp.r = Math.max(0.05, s.r);
      if (Number.isFinite(s.y0) && s.y0 > -1e3) { imp.b0 = s.y0 - gy; imp.b1 = s.y1 - gy; }
      if (imp.b1 - imp.b0 < 1.2) { imp.kind = 'flat'; imp.t0 = -imp.r; imp.t1 = imp.r; imp.edge = Math.min(imp.r, 0.15); }
      mul = 1.55;
    } else if (s && s.k === 1) {
      const T = new THREE.Vector3(0, 1, 0).cross(N).normalize();
      const a = new THREE.Vector3(s.a[0], gy, s.a[1]).sub(o).applyQuaternion(qi).sub(P).dot(T), b = new THREE.Vector3(s.b[0], gy, s.b[1]).sub(o).applyQuaternion(qi).sub(P).dot(T);
      imp.t0 = Math.min(a, b); imp.t1 = Math.max(a, b); imp.edge = Math.max(0.03, s.r);
      if (Number.isFinite(s.y0) && s.y0 > -1e3) { imp.b0 = s.y0 - gy; imp.b1 = s.y1 - gy; }
      if (imp.t1 - imp.t0 < 0.6) { imp.kind = 'pole'; imp.r = Math.max(0.08, (imp.t1 - imp.t0) / 2); mul = 1.4; }
    } else if (s && s.k === 0) {
      // the polygon's edge at the contact: its extent along the push's cross
      const T = new THREE.Vector3(0, 1, 0).cross(N).normalize();
      const p = s.p; let best = null, bd = Infinity;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const ax = p[j][0], az = p[j][1], bx = p[i][0], bz = p[i][1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
        const t = L2 > 0 ? clamp(((h.px - ax) * dx + (h.pz - az) * dz) / L2, 0, 1) : 0, d2 = (ax + dx * t - h.px) ** 2 + (az + dz * t - h.pz) ** 2;
        if (d2 < bd) { bd = d2; best = [ax, az, bx, bz, t, Math.sqrt(L2)]; }
      }
      if (best) {
        const near = Math.min(best[4], 1 - best[4]) * best[5];
        if (near < 0.12) { imp.kind = 'pole'; imp.r = 0.06; mul = 1.35; } // a building's corner
        else {
          const a = new THREE.Vector3(best[0], gy, best[1]).sub(o).applyQuaternion(qi).sub(P).dot(T), b = new THREE.Vector3(best[2], gy, best[3]).sub(o).applyQuaternion(qi).sub(P).dot(T);
          imp.t0 = Math.min(a, b); imp.t1 = Math.max(a, b);
        }
      }
      if (s.tag === 'parked') { imp.kind = imp.kind === 'pole' ? 'pole' : 'car'; imp.b0 = 0.22; imp.b1 = 0.95; imp.edge = 0.25; mOther = 1400; }
      if (Number.isFinite(s.y1) && s.y1 < 1e3 && s.y1 - gy < 1.2) { imp.b0 = -1; imp.b1 = s.y1 - gy; }
    }
    imp.yMid = Number.isFinite(imp.b0) && Number.isFinite(imp.b1) ? clamp((imp.b0 + imp.b1) / 2, 0.25, A.belt) : clamp(A.belt * 0.6, 0.35, 0.8);
    this.impact(rd, imp, { mSelf: rd.mass, mOther, mul, vehicle: v });
    // the traffic car takes its share
    if (h.other && h.other.obj && h.other.obj.rig) this.trafficHit(h.other.obj, v, h, rd);
    // so does a parked car (a real car is put in its place first, a frame or two later)
    else if (s && s.tag === 'parked') this.parkedHit(h, v, rd);
  }

  // the traffic's and the parked cars' models worked out ahead (in the background, 2 ms a frame), so a first crash
  // with one need not stop the game to do it (a quarter of a second for some)
  preAnalyse() {
    const now = performance.now();
    if (now < (this._paT || 0)) return;
    this._paT = now + 400;
    const car = this.drive.car; if (!car || !car.vehicle) return;
    const pp = car.vehicle.pos, T = this.drive.traffic;
    const keyOf = rd => rd.rig.id + (rd.npc ? ':npc' : ':car') + ':' + rd.list().length;
    if (T && T.list) for (const c of T.list) {
      const rig = c.rig; if (!rig || !rig.object || rig._dmgPre) continue;
      if ((c.x - pp.x) ** 2 + (c.z - pp.z) ** 2 > 250 * 250) continue;
      rig._dmgPre = true;
      const rd = this.of(rig);
      if (rd.A) continue;
      const key = keyOf(rd);
      if (ANALYSIS.has(key)) { rd.A = ANALYSIS.get(key); continue; }
      this.bg.push(makeJob(rd, job => analyseGen(job, rd), A => { if (!rd.A && A) rd.A = A; }));
      return;
    }
    // parked models no traffic car has had yet: a car of that model made for it, then let go
    const P = this.drive.parked, C = this.drive.mods && this.drive.mods.cars;
    if (!P || !P.list || !C || !C.loadCar) return;
    if (!this._paModels) this._paModels = new Set();
    for (const o of P.list) {
      if (!o.K || this._paModels.has(o.model)) continue;
      this._paModels.add(o.model);
      C.loadCar(o.model, { npc: true }).then(rig => {
        const rd = this.of(rig), done = () => { this.rigs.delete(rd); rig.dispose(); };
        if (ANALYSIS.has(keyOf(rd))) { done(); return; }
        this.bg.push(makeJob(rd, job => analyseGen(job, rd), done));
      }).catch(() => {});
      return;
    }
  }

  // ---- parked cars
  // the parked car nearest a point (within its own length)
  parkedAt(x, z) {
    const P = this.drive.parked; if (!P || !P.list) return null;
    let best = null, bd = Infinity;
    for (const o of P.list) { if (!o.K) continue; const d2 = (o.x - x) ** 2 + (o.z - z) ** 2, r = o.K.dims.length / 2 + 0.6; if (d2 < r * r && d2 < bd) { bd = d2; best = o; } }
    return best;
  }
  // a parked car as a real one, put where its instance was (which is then not drawn); a promise of its record
  wakeParked(o) {
    if (o._dmgWake) return o._dmgWake;
    const P = this.drive.parked, C = this.drive.mods && this.drive.mods.cars;
    if (!P || !C || !C.loadCar) return Promise.resolve(null);
    o._dmgWake = C.loadCar(o.model, { npc: true, color: o.paint }).then(rig => {
      if (!P.list.includes(o)) { rig.dispose(); return null; }
      o.m.decompose(rig.object.position, rig.object.quaternion, rig.object.scale);
      this.parkedGroup.add(rig.object);
      rig.update(0, { speed: 0, wheelSpin: [0, 0, 0, 0], steer: 0, steeringWheel: 0, susp: [0, 0, 0, 0], brake: 0, reverse: false, signal: 0, headlights: false });
      o.skip = true; P.frame = 0; // the instances are filled again without it on the next update
      const rec = { rig, x: o.x, y: o.y, z: o.z, ox: o.x, oz: o.z, yaw: o.heading * Math.PI / 180, offYaw: 0, v: 0, push: new THREE.Vector2(), spinV: 0, hitT: 0, len: rig.dims.length, parked: o, mass: (rig.spec && rig.spec.mass) || 1500 };
      o._dmgRec = rec;
      const OF = this.drive.onfoot, Veh = this.drive.car && this.drive.car.vehicle && this.drive.car.vehicle.constructor;
      if (OF && OF.addLeft && Veh) {
        try {
          const veh = new Veh(rig, OF.physOf ? OF.physOf(o.model) : {});
          const g = this.drive.ground(o.x, o.z, o.y);
          veh.place(o.x, Number.isFinite(g) ? g : o.y, o.z, o.heading);
          rec.veh = veh; rec.mass = (veh.p && veh.p.mass) || rec.mass;
          rec.left = OF.addLeft({ rig, vehicle: veh, id: o.model, npc: true, kind: 'left', fromParked: true });
          this.unblock(o.x, o.z);
        } catch (e) { console.warn('parked car body', e); rec.veh = null; rec.left = null; }
      }
      this.parkedRecs.push(rec);
      // at most eight: the farthest goes back to being an instance
      while (this.parkedRecs.length > 8) {
        const car = this.drive.car ? this.drive.car.vehicle.pos : new THREE.Vector3();
        let far = 0, fd = -1; this.parkedRecs.forEach((r, i) => { const d = (r.x - car.x) ** 2 + (r.z - car.z) ** 2; if (d > fd) { fd = d; far = i; } });
        this.dropParked(this.parkedRecs[far]);
      }
      return rec;
    }).catch(e => { console.warn('parked car', e); return null; });
    return o._dmgWake;
  }
  dropParked(rec, keepSkip = false) {
    this.parkedRecs = this.parkedRecs.filter(r => r !== rec);
    const o = rec.parked;
    // (one with a body of its own that has moved off its spot leaves the spot empty)
    const moved = rec.veh && (rec.x - rec.ox) ** 2 + (rec.z - rec.oz) ** 2 > 0.25;
    if (o) { if (!keepSkip && !moved) o.skip = false; o._dmgRec = null; o._dmgWake = null; }
    if (this.drive.parked) this.drive.parked.frame = 0;
    this.trafficDamaged = this.trafficDamaged.filter(rd => rd.rig !== rec.rig);
    let gone = false;
    if (rec.left) { const OF = this.drive.onfoot, k = OF && OF.parked ? OF.parked.indexOf(rec.left) : -1; if (k >= 0) OF.parked.splice(k, 1); else gone = true; }
    if (gone) { this.rigs.delete(rec.rig._dmg); return; } // (the on-foot module let it go already)
    if (rec.rig._dmg) { try { rec.rig._dmg.reset(); } catch (e) {} this.rigs.delete(rec.rig._dmg); }
    rec.rig.dispose();
  }
  // a parked car's fixed outline in the collision world taken away (it moves on its own body now)
  unblock(x, z) {
    const C = this.drive.collide; if (!C || !C.near) return;
    for (const sh of C.near(x - 0.5, z - 0.5, x + 0.5, z + 0.5)) {
      if (sh.tag !== 'parked' || sh.dead || !sh.p) continue;
      let inside = false; const P = sh.p;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > z) !== (P[j][1] > z) && x < (P[j][0] - P[i][0]) * (z - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) inside = !inside;
      if (inside) C.remove(sh);
    }
  }
  parkedHit(h, v, prd) {
    const o = this.parkedAt(h.px, h.pz); if (!o) return;
    const hit = { px: h.px, pz: h.pz, nx: h.nx, nz: h.nz, speed: h.speed, j: h.j };
    // several steps of one crash are one impact
    const now = performance.now();
    if (o._dmgLastHit && now - o._dmgLastHit < 400) return;
    o._dmgLastHit = now;
    this.wakeParked(o).then(rec => {
      if (!rec || !rec.rig.object.parent) return;
      this.trafficHit(rec, v, hit, prd);
      this.shove(rec, hit, prd.mass || 1800);
    });
  }
  // a push on a parked car's body: what the hit gave the player's car back, given to it (as far as a plastic crash
  // shares speed: both end up near a common speed), with a turn from how far off its middle it was hit
  shove(rec, hit, mOther) {
    const veh = rec.veh; if (!veh) return;
    const m = rec.mass || 1500, vn = Math.max(0, hit.speed || 0);
    // the common speed of a plastic crash, a little more for the bounce
    // (not capped by what the player's car took back: it met the parked car's fixed outline, as a wall)
    const dv = Math.min(14, vn * mOther / (m + mOther));
    const Jx = -hit.nx * dv * m, Jz = -hit.nz * dv * m;
    veh.v.x += Jx / m; veh.v.z += Jz / m;
    const d = rec.rig.dims || { length: 4.6, width: 1.8 }, I = m * (d.length * d.length + d.width * d.width) / 12;
    const rx = hit.px - veh.pos.x, rz = hit.pz - veh.pos.z;
    if (veh.w) veh.w.y += (rz * Jx - rx * Jz) / I * 0.8;
    if (rec.left) { rec.left.asleep = false; rec.left.still = 0; }
  }
  // the parked list rebuilt with the area: the cars already swapped keep their places
  parkedTidy() {
    const OF = this.drive.onfoot;
    for (const rec of this.parkedRecs) {
      if (!rec.left) continue;
      if (!OF || !OF.parked || !OF.parked.includes(rec.left)) { rec.lost = true; continue; }
      const pr = rec.left.proxy; if (pr) { rec.x = pr.x; rec.z = pr.z; rec.y = pr.y; rec.yaw = pr.yaw; }
    }
    if (this.parkedRecs.some(r => r.lost)) {
      for (const rec of this.parkedRecs.filter(r => r.lost)) { this.parkedRecs = this.parkedRecs.filter(r => r !== rec); this.trafficDamaged = this.trafficDamaged.filter(rd => rd.rig !== rec.rig); this.rigs.delete(rec.rig._dmg); if (rec.parked) { rec.parked._dmgRec = null; } }
    }
    const P = this.drive.parked;
    if (!P || !P.list || P.list === this._plist) return;
    this._plist = P.list;
    for (const rec of this.parkedRecs.slice()) {
      const old = rec.parked;
      // (by the spot it was parked in: it may have been shoved off it)
      const o = P.list.find(n => n.K && n.model === old.model && (n.x - rec.ox) ** 2 + (n.z - rec.oz) ** 2 < 0.36);
      if (!o) { this.dropParked(rec, true); continue; }
      rec.parked = o; o._dmgRec = rec; o._dmgWake = Promise.resolve(rec); o.skip = true; P.frame = 0;
      if (rec.veh) this.unblock(o.x, o.z);
    }
  }

  // ---- traffic knocked loose (by the player or by each other) running into other traffic and parked cars
  knocks(dt) {
    const T = this.drive.traffic, car = this.drive.car;
    if (!T || !T.list || !car || !car.vehicle) return;
    const pp = car.vehicle.pos, now = performance.now(), R2 = 90 * 90;
    let moving = null;
    for (const c of T.list) if (c.hitT > 0 && Math.abs(c.v) + c.push.length() > 0.8 && (c.x - pp.x) ** 2 + (c.z - pp.z) ** 2 < R2) (moving || (moving = [])).push(c);
    if (!moving) return;
    const P = this.drive.parked;
    for (const a of moving) {
      const da = a.rig.dims; if (!da) continue;
      const fa = footprint(a, da);
      const test = (b, d, parked) => {
        if (b === a || (b.x - a.x) ** 2 + (b.z - a.z) ** 2 > 81) return;
        const o = overlap(fa, footprint(b, d));
        if (o) this.carMeet(a, b, o, parked, now);
      };
      for (const b of T.list) if (b.rig && b.rig.dims) test(b, b.rig.dims, null);
      if (P && P.list) for (const o of P.list) if (o.K && (o.x - a.x) ** 2 + (o.z - a.z) ** 2 < 81) test(o._dmgRec || { x: o.x, z: o.z, yaw: o.heading * Math.PI / 180, offYaw: 0 }, o.K.dims, o);
    }
  }
  // two cars that touched: pushed apart, the speeds traded, and both damaged when it was a crash
  carMeet(a, b, o, parked, now) {
    const ka = a._kid || (a._kid = ++this.kid), kb = parked ? 'p' + (parked._kid || (parked._kid = ++this.kid)) : (b._kid || (b._kid = ++this.kid));
    const key = ka + ':' + kb, key2 = kb + ':' + ka;
    const fa = Math.sin(a.yaw + a.offYaw), fza = -Math.cos(a.yaw + a.offYaw);
    const vax = fa * a.v + a.push.x, vaz = fza * a.v + a.push.y;
    let vbx = 0, vbz = 0;
    if (!parked) { const fb = Math.sin(b.yaw + b.offYaw), fzb = -Math.cos(b.yaw + b.offYaw); vbx = fb * b.v + b.push.x; vbz = fzb * b.v + b.push.y; }
    const vn = (vax - vbx) * o.nx + (vaz - vbz) * o.nz;
    const ma = (a.rig.spec && a.rig.spec.mass) || 1500, mb = parked ? Infinity : (b.rig.spec && b.rig.spec.mass) || 1500;
    const wa = 1 / ma, wb = 1 / mb, sh = o.pen / (wa + wb);
    // apart (a parked car stays where it is)
    a.off.x -= o.nx * sh * wa; a.off.y -= o.nz * sh * wa;
    if (!parked) { b.off.x += o.nx * sh * wb; b.off.y += o.nz * sh * wb; }
    if (vn <= 0) return;
    // the speeds along n traded (a little bounce), a turn from where it hit
    const j = (1 + 0.15) * vn / (wa + wb);
    const give = (c, sg, w) => {
      let dx = -o.nx * j * w * sg, dz = -o.nz * j * w * sg;
      const fx = Math.sin(c.yaw + c.offYaw), fz = -Math.cos(c.yaw + c.offYaw), along = dx * fx + dz * fz;
      // first out of its own speed along the lane, the rest as a push
      if (along < 0 && c.v > 0) { const dv = Math.max(along, -c.v); c.v += dv; dx -= fx * dv; dz -= fz * dv; }
      c.push.x += dx; c.push.y += dz;
      const rx = o.px - c.x, rz = o.pz - c.z, d = c.rig.dims, I = (d.length * d.length + d.width * d.width) / 12;
      c.spinV = clamp(c.spinV + (rx * dz - rz * dx) / I * 0.8, -2.5, 2.5);
      c.hitT = Math.max(c.hitT, 4 + Math.min(6, vn));
    };
    give(a, 1, wa);
    if (!parked) give(b, -1, wb);
    // the crash: once per pair in a short while
    if (vn < V_ELASTIC + 0.3 || (this.pairs.get(key) || 0) > now - 700 || (this.pairs.get(key2) || 0) > now - 700) return;
    this.pairs.set(key, now);
    if (this.pairs.size > 64) for (const [k, t] of this.pairs) if (t < now - 2000) this.pairs.delete(k);
    const P = new THREE.Vector3(o.px, a.y || 0, o.pz);
    this.carCrash(a, parked ? null : b, parked, P, new THREE.Vector3(-o.nx, 0, -o.nz), vn, ma, parked ? 1500 : mb);
    if (parked) this.wakeParked(parked).then(rec => { if (rec && rec.rig.object.parent) this.carCrash(rec, a, null, P, new THREE.Vector3(o.nx, 0, o.nz), vn, 1500, ma); });
    else this.carCrash(b, a, null, P, new THREE.Vector3(o.nx, 0, o.nz), vn, mb, ma);
    if (this.fx.sound && this.fx.sound.crunch) this.fx.sound.crunch(clamp(vn / 12, 0.2, 1));
  }
  // one car's share of a crash with another: P (world), Nw the push on it (world), the other car (a record, or a
  // parked list entry) for the width of what hit it
  carCrash(c, other, otherParked, P, Nw, speed, mSelf, mOther) {
    const rig = c.rig; if (!rig || !rig.object || !rig.object.parent) return;
    const rd = this.of(rig);
    if (!c.parked) { rd.trafficCar = c; if (!this.trafficDamaged.includes(rd)) { this.trafficDamaged.push(rd); this.limitTraffic(); } }
    rig.object.updateWorldMatrix(true, false);
    const M = rig.object.matrixWorld, inv = new THREE.Matrix4().copy(M).invert(), qi = rig.object.getWorldQuaternion(new THREE.Quaternion()).invert();
    const N = Nw.clone().applyQuaternion(qi); N.y = 0; N.normalize();
    const Pl = new THREE.Vector3(P.x, M.elements[13], P.z).applyMatrix4(inv); Pl.y = 0;
    const T = new THREE.Vector3(0, 1, 0).cross(N).normalize();
    const od = (other && other.rig && other.rig.dims) || (otherParked && otherParked.K && otherParked.K.dims) || { width: 1.8, length: 4.6, height: 1.45, front: 2.3, rear: 2.3 };
    const oc = other || (otherParked ? { x: otherParked.x, z: otherParked.z, yaw: otherParked.heading * Math.PI / 180, offYaw: 0 } : { x: P.x, z: P.z, yaw: 0, offYaw: 0 });
    const f = footprint(oc, od);
    let lo = Infinity, hi = -Infinity;
    for (const [s1, s2] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const wx = f.cx + f.fx * s1 * f.hl + f.rx * s2 * f.hw, wz = f.cz + f.fz * s1 * f.hl + f.rz * s2 * f.hw;
      const t = new THREE.Vector3(wx, M.elements[13], wz).applyMatrix4(inv).sub(Pl).dot(T); lo = Math.min(lo, t); hi = Math.max(hi, t);
    }
    const imp = { P: Pl, N, speed, kind: 'car', t0: lo, t1: hi, b0: 0.22, b1: Math.max(0.6, (od.height || 1.45) * 0.62), edge: 0.28, world: new THREE.Vector3(P.x, M.elements[13] + 0.5, P.z), normal: Nw.clone() };
    this.impact(rd, imp, { mSelf, mOther });
    if (!c.parked && (rd.crushTotal > 0.35 || rd.engine > 0.3)) { c.hitT = Math.max(c.hitT || 0, 1e6); c.wreck = true; }
  }

  // an impact on any car: imp in its frame (P, N, kind ...), with speeds and masses for the crush depth
  impact(rd, imp, { mSelf = 1500, mOther = Infinity, mul = 1, vehicle = null } = {}) {
    const tI = performance.now();
    const A = rd.analysis();
    const N = imp.N;
    const side = Math.abs(N.y) > 0.6 ? (N.y < 0 ? 'roof' : 'under') : Math.abs(N.z) >= Math.abs(N.x) ? (N.z > 0 ? 'front' : 'rear') : (N.x > 0 ? 'left' : 'right');
    imp.side = side;
    const vEff = Math.max(0, imp.speed - V_ELASTIC);
    // the share of the crush this car takes (springs in series: the lighter car crushes more)
    const share = Number.isFinite(mOther) ? mOther / (mSelf + mOther) : 1;
    // (tuned to NHTSA's 32 km/h, 75 degree side pole tests of large sedans: 300 to 373 mm static crush)
    if (imp.kind === 'pole' && (side === 'left' || side === 'right')) mul *= 0.62;
    const stiff = side === 'front' ? 1 : side === 'rear' ? 1.12 : side === 'roof' ? 1.5 : side === 'under' ? 0.4 : 1.3;
    let D = Math.min(1.5, vEff * K_CRUSH * share * stiff * mul * (imp.Dmul || 1));
    // a roof comes down to about the occupants' heads, not through them (the pillars hold the rest)
    if (side === 'roof') { const eye = rd.rig.mounts && rd.rig.mounts.driver ? rd.rig.mounts.driver.y : A.roofY - 0.25; D = Math.min(D, Math.max(0.04, A.roofY - eye - 0.06 - rd.roof * 0.5)); }
    imp.D = D;
    const mu = Number.isFinite(mOther) ? mSelf * mOther / (mSelf + mOther) : mSelf;
    imp.energy = 0.5 * mu * imp.speed * imp.speed;
    rd.lastImpact = this.lastImpactT = performance.now();
    this.n.impacts++;
    let res = null;
    const self = this;
    // the crush, the paint round it and what it breaks: one piece of work for this car, after anything it is still
    // doing, spread over the frames after the hit (the first slice of it now)
    const work = function* (job) {
      if (side === 'front' && D > (rd.npc ? 0.3 : 0.2)) { try { yield* rd.addBayGen(job); } catch (e) { console.warn('engine bay', e); } }
      if (D > 0.004) {
        try { res = yield* rd.crushGen(job, imp); } catch (e) { console.warn('crush', e); }
        // the outside first; what breaks right after it; the inside and the shadow's stand-in last
        if (res && res.work) yield* res.work(job, 'out');
      }
      if (res && res.uAt) {
        // paint at the hit: chipped and scuffed round it
        const n = imp.N.clone().negate();
        // (a pole leaves one scuffed band down the side where it touched, bare in a narrow strip; anything else chips
        // the paint round the hit)
        if (imp.kind === 'pole' && (side === 'left' || side === 'right')) rd.scratch(res.uAt.clone().setY(0.22), res.uAt.clone().setY(A.belt + 0.02), n, Math.max(0.05, (imp.r || 0.12) * 0.7), [0.5, 0.6, 0.75, 0.3], 0);
        else rd.scratch(res.uAt, res.uAt.clone().addScaledVector(new THREE.Vector3(0, 1, 0).cross(n).normalize(), 0.01), n, 0.05 + D * 0.35, [0.1, 0.35, 0.45, 0.25], 1);
      }
      if (res && res.maxU > 0.003) {
        // (the paint's meshes made the car's own a few at a time first: all at once, for a traffic car not prepared
        // ahead, held a frame for 20 to 30 ms)
        if (!rd.atlas) for (const e of rd.list()) { if (e.cur || e.role === 'proxy' || e.role === 'glass') continue; if (e.isPaint()) { e.own(); if (performance.now() >= job.deadline) yield; } }
        try { rd.atlasReady(); } catch (e) { console.warn('damage atlas', e); }
      }
      yield* rd.consequencesGen(job, imp, res);
      if (vehicle) vehicle.powerK = self.powerOf(rd);
      if (res && res.work) { yield* res.work(job, 'in'); res.finish(); }
      // nothing of the bay ahead of the crushed front (where the skin is still there)
      if (rd.bay && side === 'front' && res && res.maxU > 0.02) {
        try {
          const A = rd.A, map = yield* rd.skinMapGen(job, A.box.min.z, Math.min(A.zA, A.box.min.z + 2));
          for (const e of rd.entries) if (e.mesh.userData.dmgBay && e.cur && !e.partOf && e.mesh.material !== BAY_DARK) rd.fitBay(e, map, 0.03, false);
        } catch (e) { console.warn('bay fit', e); }
      }
    };
    const job = makeJob(rd, work);
    // background subdividing of this car stops (it only ever pauses where nothing is half changed); a door being cut
    // out ahead is finished first if it was started (a half cut door would be left in pieces)
    // (moved to the front of the crash queue, so the crush waits for it rather than the game: finishing it here held
    // a frame for up to half a second)
    const dj = rd.doorJob && !rd.doorJob.done && rd.doorJob.started ? rd.doorJob : null;
    if (rd.doorJob && !dj) rd.doorJob = null;
    this.bg = this.bg.filter(j => j.rd !== rd);
    if (dj && !this.jobs.includes(dj)) this.jobs.unshift(dj);
    if (imp.sync) { this.flushRig(rd); job.run(1e9); }
    else {
      const busy = this.jobs.some(j => j.rd === rd);
      this.jobs.push(job);
      // (the player's own crush starts in this frame; another car's waits for the next, so two in one frame do not stack)
      // (nothing of it in the crash's own frame: the impact's sound, sparks and events are enough for that frame)
    }
    if (vehicle) vehicle.powerK = Math.min(vehicle.powerK ?? 1, this.powerOf(rd));
    if (imp.speed > 3) this.fx.sound.crunch(Math.min(1, imp.speed / 18));
    this.soundReady();
    // sparks and a puff of dust at the hit
    if (imp.world && imp.speed > 4) {
      const vel = rd.velocityAt(imp.world);
      this.fx.sparkBurst(imp.world, vel, Math.round(Math.min(40, imp.speed * 2)), rd.groundY(imp.world), 1);
      this.fx.puff('dust', imp.world.x, imp.world.y, imp.world.z, vel.x * 0.2, 0.4, vel.z * 0.2);
      // bits of black plastic (clips, grille slats, liner) on the road after a hard front or rear crash, as on the
      // floor round every NCAP car
      if ((side === 'front' || side === 'rear') && D > 0.25) {
        const out = imp.normal ? imp.normal.clone().negate().setY(0.3) : new THREE.Vector3(0, 0.3, 0);
        this.fx.shardBurst(imp.world, vel, out, rd.groundY(imp.world), Math.round(clamp(D * 30, 6, 22)), [0x141416, 0x1e1f21, 0x2b2c2f, 0x3a3b3e], 0.06);
      }
    }
    const ev = { type: 'impact', car: rd.rig, vehicle: vehicle || null, point: imp.world ? imp.world.clone() : rd.toWorld(imp.P), normal: imp.normal ? imp.normal.clone() : imp.N.clone().applyQuaternion(rd.root.getWorldQuaternion(_q)), speed: imp.speed, energy: imp.energy, side, rollover: !!imp.rollover, crush: res ? res.maxU : D };
    const tE = performance.now();
    this.emit(ev);
    (this.impactMs || (this.impactMs = [])).push({ own: +(tE - tI).toFixed(1), listeners: +(performance.now() - tE).toFixed(1) }); if (this.impactMs.length > 20) this.impactMs.shift();
    return res;
  }

  // a traffic car hit by the player's: its own crush, in its frame
  trafficHit(c, v, h, prd) {
    const rig = c.rig; if (!rig || !rig.object) return;
    const rd = this.of(rig);
    rd.trafficCar = c;
    if (!this.trafficDamaged.includes(rd)) { this.trafficDamaged.push(rd); this.limitTraffic(); }
    rig.object.updateWorldMatrix(true, false);
    const M = rig.object.matrixWorld, inv = new THREE.Matrix4().copy(M).invert(), qi = rig.object.getWorldQuaternion(new THREE.Quaternion()).invert();
    // the push on it is the other way
    const N = new THREE.Vector3(-h.nx, 0, -h.nz).applyQuaternion(qi); N.y = 0; N.normalize();
    const P = new THREE.Vector3(h.px, M.elements[13], h.pz).applyMatrix4(inv); P.y = 0;
    const pd = prd.rig.dims || { width: 1.8, height: 1.4 };
    const T = new THREE.Vector3(0, 1, 0).cross(N).normalize();
    // the player's car as the impactor: its corners across the push
    const o = v.origin(), fx = Math.sin(v.heading * Math.PI / 180), fz = -Math.cos(v.heading * Math.PI / 180);
    let lo = Infinity, hi = -Infinity;
    for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const wx = o.x + fx * a * pd.length / 2 - fz * b * pd.width / 2, wz = o.z + fz * a * pd.length / 2 + fx * b * pd.width / 2;
      const t = new THREE.Vector3(wx, M.elements[13], wz).applyMatrix4(inv).sub(P).dot(T); lo = Math.min(lo, t); hi = Math.max(hi, t);
    }
    const imp = { P, N, speed: h.speed, kind: 'car', t0: lo, t1: hi, b0: 0.22, b1: Math.max(0.6, pd.height * 0.62), edge: 0.28, world: new THREE.Vector3(h.px, M.elements[13] + 0.5, h.pz), normal: new THREE.Vector3(-h.nx, 0, -h.nz) };
    this.impact(rd, imp, { mSelf: rd.mass, mOther: prd.mass });
    // a wreck stays where it stopped (its hazards on)
    if (rd.crushTotal > 0.35 || rd.engine > 0.3) { c.hitT = Math.max(c.hitT || 0, 1e6); c.wreck = true; }
  }
  // too many damaged traffic cars: the farthest one goes back to new
  limitTraffic() {
    while (this.trafficDamaged.length > 10) {
      const car = this.drive.car ? this.drive.car.vehicle.pos : new THREE.Vector3();
      let far = 0, fd = -1;
      this.trafficDamaged.forEach((rd, i) => { const d = rd.root.position.distanceToSquared(car); if (d > fd) { fd = d; far = i; } });
      const rd = this.trafficDamaged[far];
      this.trafficDamaged.splice(far, 1);
      rd.reset();
    }
  }

  // ---- scraping: contacts sliding along the car's side: scratches, small dents, sparks, the sound
  scrape(rd, v, dt, env) {
    const list = v.touch;
    let level = 0;
    if (list && list.length) {
      const A = rd.analysis();
      const o = v.origin(), qi = _q.copy(v.q).invert();
      const seen = new Set();
      for (const h of list) {
        const key = h.other ? h.other.obj : h.shape || 'w';
        if (seen.has(key)) continue; seen.add(key);
        // the contact's velocity relative to what it touches
        const r = _w.set(h.px, v.pos.y - 0.1, h.pz).sub(v.pos);
        const vp = _v.copy(v.v).add(_u.crossVectors(v.w, r));
        if (h.other) { vp.x -= h.other.vx || 0; vp.z -= h.other.vz || 0; }
        const vn = vp.x * h.nx + vp.z * h.nz;
        const tx = vp.x - vn * h.nx, tz = vp.z - vn * h.nz, vt = Math.hypot(tx, tz);
        if (vt < 1.2) continue;
        const press = Math.min(1, (h.depth || 0) * 12 + Math.max(0, -vn) * 0.25 + 0.15);
        level = Math.max(level, Math.min(1, vt / 14) * (0.4 + press * 0.6));
        // in the car's frame
        const N = new THREE.Vector3(h.nx, 0, h.nz).applyQuaternion(qi); N.y = 0; N.normalize();
        const P = new THREE.Vector3(h.px, o.y, h.pz).sub(o).applyQuaternion(qi);
        const Tv = new THREE.Vector3(tx, 0, tz).applyQuaternion(qi); Tv.y = 0;
        rd.scrapeT += dt;
        // the touching band: the outermost points of the side near the contact, at the contact's height range
        let yLo = 0.12, yHi = A.belt + 0.05;
        if (h.other) { yLo = 0.25; yHi = 0.95; }
        else if (h.shape && Number.isFinite(h.shape.y1) && h.shape.y1 < 1e3) { yLo = Math.max(yLo, h.shape.y0 - o.y); yHi = Math.min(A.roofY, h.shape.y1 - o.y); }
        this.scrapeMarks(rd, P, N, Tv, vt, dt, press, yLo, yHi, !!h.other);
        // sparks (metal on stone or metal), dense at speed
        if (Math.random() < Math.min(1, vt / 6) * 0.9) {
          const wp = new THREE.Vector3(h.px, o.y + clamp((yLo + yHi) / 2, 0.25, 0.7), h.pz);
          const n = Math.round(1 + vt / 4 + press * 4);
          this.fx.sparkBurst(wp, new THREE.Vector3(tx, 0, tz), n, rd.groundY(wp), 0.5);
        }
        this.n.scrapes++;
        // a mirror on the side scraping goes
        if (vt > 5 && rd.A.mirrors.length) {
          for (const m of rd.A.mirrors) if (Math.sign(m.box.min.x + m.box.max.x) === Math.sign(-N.x) && !rd.parts.has('mirror' + m.side) && Math.random() < dt * 4) rd.later('mirror' + m.side, jb => rd.detachGen(jb, 'mirror' + m.side, { P, N, speed: vt, scrape: true, speedT: vt }, { kind: 'mirror', box: m.box, test: (x, y, z) => m.box.containsPoint(_a.set(x, y, z)) }));
        }
        // a small dent where it presses hard
        if (press > 0.55 && Math.random() < dt * 2 && !this.jobs.some(j => j.rd === rd)) {
          const imp = { P, N, speed: V_ELASTIC + 0.6 + press * 1.5, kind: h.other ? 'car' : 'flat', t0: -0.25, t1: 0.25, b0: yLo, b1: yHi, edge: 0.08, Dmul: 0.6, scrape: true, speedT: vt };
          try { const r = rd.crush({ ...imp, D: 0.01 + press * 0.025 }); if (r && r.job) { r.job.run(3); if (!r.job.done) this.jobs.push(r.job); } } catch (e) {}
        }
      }
    }
    this.scrapeLevel = Math.max(level, this.scrapeLevel * Math.exp(-dt * 10));
  }
  // scratches along the line of travel on the band of the side touching
  scrapeMarks(rd, P, N, Tv, vt, dt, press, yLo, yHi, metal) {
    const A = rd.A;
    // the contact's face: the side, the front or the back
    const nOut = N.clone().negate();
    const along = Tv.clone().normalize().negate(); // the scratch runs the way the surface moves past the contact
    // the body's contacts are a few points along its side: each scratch runs well past its point, so the marks
    // join into long lines down the side
    const len = clamp(vt * 0.1, 0.35, 1.3);
    // the bands at the heights where the body reaches out furthest (the shoulder, the arches, the bumper): a wall
    // touches those first, and the harder it presses the more of the side it reaches
    const S = A.side, bands = [];
    if (S && Math.abs(nOut.x) > 0.5) {
      let mx = 0;
      for (let b = 0; b < S.NB; b++) { const y = (b + 0.5) / S.NB * S.top; if (y >= yLo && y <= yHi && S.prof[b] > mx) mx = S.prof[b]; }
      const reach = 0.04 + press * 0.08;
      // the widest heights first (they touch first), more of them the harder it presses
      const cand = [];
      for (let b = 0; b < S.NB; b++) { const y = (b + 0.5) / S.NB * S.top; if (y >= yLo && y <= yHi && S.prof[b] >= mx - reach) cand.push([S.prof[b], y]); }
      cand.sort((p, q) => q[0] - p[0]);
      for (const [, y] of cand.slice(0, 1 + Math.round(press * 2))) bands.push([y, Math.max(0.03, S.top / S.NB * 0.7) * (0.8 + press * 0.7)]);
      // and the doors' and wings' bulge at about handle height, the line a wall rubs on most cars
      const yd = clamp(A.belt - 0.2, yLo + 0.05, yHi - 0.05);
      if (yd > yLo && !bands.some(b => Math.abs(b[0] - yd) < 0.08)) bands.push([yd, 0.035 + press * 0.035]);
    }
    if (!bands.length) bands.push([clamp((yLo + yHi) / 2, 0.25, A.belt), 0.05]);
    const deep = press * Math.min(1, vt / 8);
    for (const [y, hh] of bands) {
      const a = P.clone(); a.y = y + rnd(-0.3, 0.3) * hh;
      // on the surface: just inside the body's outer side
      if (Math.abs(nOut.x) > 0.5) a.x = Math.sign(nOut.x) * A.hw; else if (Math.abs(nOut.z) > 0.5) a.z = nOut.z < 0 ? A.box.min.z : A.box.max.z;
      a.addScaledVector(along, -len * 0.5);
      const b = a.clone().addScaledVector(along, len);
      // into the side's map and the top's (a shoulder or a crease line faces partly up)
      const nn = _w.copy(nOut).setY(0.62).normalize();
      rd.scratch(a, b, nn, Math.max(0.03, hh) * rnd(0.9, 1.3), [deep > 0.25 ? 0.95 : 0.35, Math.min(1, 0.45 + deep * 1.3), 1, 0], 0, Math.round(y * 40) * 3.7);
    }
  }

  // ---- body corners against the ground: a car on its side or roof slides on its body, grinding
  bodyContacts(v, rd, dt, env, F, Tq, up) {
    // (only once the model is worked out, a slice a frame in the background after a drop or a new car, ready():
    // worked out here, on the first physics step, it held the game for 0.6 to 1.5 s; perf)
    if (!rd.A) return;
    const A = rd.A;
    if (!rd.bodyPts) {
      const hw = A.hw - 0.06, z0 = A.box.min.z + 0.1, z1 = A.box.max.z - 0.1, yl = Math.max(0.1, A.wheelR * 0.5);
      const rhw = Math.max(0.3, A.hw - 0.24), rf = A.zA + 0.25, rr = A.zC - 0.2, ry = A.roofY - 0.02;
      const pts = [];
      for (const sx of [-1, 1]) {
        pts.push([sx * hw, yl, z0, 'low'], [sx * hw, yl, z1, 'low'], [sx * A.hw, A.belt, z0 + 0.25, 'side'], [sx * A.hw, A.belt, z1 - 0.25, 'side'], [sx * A.hw, A.belt, (A.zA + A.zC) / 2, 'side']);
        pts.push([sx * rhw, ry, rf, 'roof'], [sx * rhw, ry, rr, 'roof']);
      }
      pts.push([0, ry + 0.01, (rf + rr) / 2, 'roof'], [0, yl, A.box.min.z + 0.03, 'low'], [0, yl, A.box.max.z - 0.03, 'low']);
      // where a wheel was: its hub and arms drag on the road once it is gone
      (rd.rig.wheels || []).forEach((w, i) => { if (w && w.pos) pts.push([w.pos.x * 0.9, Math.max(0.1, (w.radius || A.wheelR) * 0.45), w.pos.z, 'hub', i]); });
      rd.bodyPts = pts.map(p => ({ p: new THREE.Vector3(p[0], p[1], p[2]), kind: p[3], i: p[4], gx: NaN, gz: NaN, gh: 0, on: false }));
    }
    const m = v.p.mass;
    const k = m * 260, c = 2 * Math.sqrt(k * m / 6) * 0.6;
    // on all four wheels and upright: nothing can touch but the low points
    const upright = up.y > 0.75 && v.wheels.every(w => w.contact || w.gone);
    // the flight module's rigid body contact (flight.js groundContact) holds the body up when it is on this car:
    // then these points only make sparks, scratches and crushes, and push nothing
    const theirs = !!v.ext, tipped = up.y < 0.5, lost = v.wheels.some(w => w.gone);
    let touching = 0, grind = 0;
    for (const bp of rd.bodyPts) {
      if (bp.kind === 'hub' && !(v.wheels[bp.i] && v.wheels[bp.i].gone)) { bp.on = false; continue; }
      if (upright && bp.kind !== 'low' && bp.kind !== 'hub') continue;
      // the point in the world (body frame relative to the centre of mass), with the roof crushed in
      _p.copy(bp.p); if (bp.kind === 'roof') _p.y -= rd.roof * 0.9;
      _p.sub(v.com).applyQuaternion(v.q).add(v.pos);
      if (!(Math.abs(_p.x - bp.gx) < 0.3 && Math.abs(_p.z - bp.gz) < 0.3)) {
        // skip the query while clearly above the road the wheels see
        const est = v.wheels.reduce((a, w) => w.gh !== null && Number.isFinite(w.gh) ? Math.max(a, w.gh) : a, -Infinity);
        if (upright && Number.isFinite(est) && _p.y > est + 0.07) { bp.on = false; continue; }
        const h = env.ground(_p.x, _p.z, _p.y + 0.5);
        bp.gx = _p.x; bp.gz = _p.z; bp.gh = h === null || h === undefined || !Number.isFinite(h) ? -1e9 : h;
      }
      const pen = bp.gh - _p.y;
      if (pen <= 0) { bp.on = false; continue; }
      touching++;
      const r = _a.copy(_p).sub(v.pos);
      const vp = _b.copy(v.v).add(_u.crossVectors(v.w, r));
      const vn = vp.y;
      // the moment it lands on its roof or side hard: a crush there (the flight module reports its own landings)
      // (vehicle.js's floorGuard reports landings as groundHit, taken in step(): then this is not needed)
      if (!theirs && !v.floorGuard && bp.kind !== 'low' && bp.kind !== 'hub' && !bp.on && vn < -2.5 && performance.now() - (rd.lastBody || 0) > 150) {
        rd.lastBody = performance.now();
        const qi = _q.copy(v.q).invert();
        const N = new THREE.Vector3(0, 1, 0).applyQuaternion(qi);
        const P = bp.p.clone();
        const roll = bp.kind !== 'low';
        const imp = { P, N, speed: -vn, kind: 'ground', world: _p.clone(), normal: new THREE.Vector3(0, 1, 0), rollover: roll };
        if (bp.kind === 'roof') rd.roof = Math.min(0.5, rd.roof + Math.max(0, -vn - 2) * 0.03);
        setTimeout(() => { try { this.impact(rd, imp, { mSelf: m, vehicle: v }); } catch (e) {} }, 0);
      }
      bp.on = true;
      const tx = vp.x, tz = vp.z, tl = Math.hypot(tx, tz);
      // (a corner whose wheel is gone rests on its hub, or on the bumper's corner)
      if (!theirs && ((tipped && bp.kind !== 'low') || bp.kind === 'hub' || (lost && bp.kind === 'low'))) {
        let fn = k * Math.min(pen, 0.08) - c * Math.min(0, vn);
        fn = Math.max(0, Math.min(fn, m * 9.81 * 3));
        // sliding friction, metal on the road
        const mu = 0.45;
        const ft = tl > 0.05 ? mu * fn : mu * fn * tl / 0.05;
        const fx = tl > 1e-4 ? -tx / tl * ft : 0, fz = tl > 1e-4 ? -tz / tl * ft : 0;
        F.x += fx; F.y += fn; F.z += fz;
        Tq.add(_w.set(r.y * fz - r.z * fn, r.z * fx - r.x * fz, r.x * fn - r.y * fx));
      }
      if (tl > 2) {
        grind = Math.max(grind, Math.min(1, tl / 12));
        if (Math.random() < dt * 30) this.fx.sparkBurst(_p.clone().setY(bp.gh + 0.02), vp.clone(), 2 + Math.round(tl / 5), bp.gh, 0.7);
        // the roof or side scraped
        if (Math.random() < dt * 10) {
          const qi = _q.copy(v.q).invert();
          const n = new THREE.Vector3(0, -1, 0).applyQuaternion(qi);
          const tv = new THREE.Vector3(tx, 0, tz).applyQuaternion(qi).normalize();
          const a = bp.p.clone(); const b = a.clone().addScaledVector(tv, -Math.min(0.6, tl * 0.05));
          rd.scratch(a, b, n, 0.08, [0.5, 0.9, 1, 0.35], 0);
        }
      }
    }
    this.bodyGrind = grind;
    if (touching) this.scrapeLevel = Math.max(this.scrapeLevel, grind);
  }

  // ---- each frame
  update(dt) {
    const tU = performance.now();
    this.updateBody(dt);
    if (!this._sndT || performance.now() > this._sndT) { this._sndT = performance.now() + 1000; if (!this.jobs.length) this.soundReady(); }
    // how long damage took each frame (the last 240, for tests)
    const ms = performance.now() - tU;
    (this.frameMs || (this.frameMs = [])).push(+ms.toFixed(2)); if (this.frameMs.length > 240) this.frameMs.shift();
  }
  updateBody(dt) {
    const drive = this.drive;
    const car = drive.car;
    // the material holders: drawn for the first 10 s of driving (their programs built and used once), then hidden
    if (this.holders && drive.active && !drive.holdRender && (this._holdT = (this._holdT || 0) + dt) > 10) { for (const h of this.holders) h.visible = false; this.holders = null; }
    if (car && car.rig && car.vehicle && (!car.vehicle._dmgAttached || !car.rig._dmg || car.rig._dmg.vehicle !== car.vehicle)) this.attachPlayer(car);
    // crushes still being worked through, 4 ms a frame
    if (this.jobs.length) {
      // (a little more in the first half second after a crash, so the crush shows sooner)
      const tEnd = performance.now() + (performance.now() - (this.lastImpactT || 0) < 500 ? 4 : 3);
      while (this.jobs.length && performance.now() < tEnd) { const j = this.jobs[0]; let done = true; try { done = j.run(tEnd - performance.now()); } catch (e) { console.warn('crush job', e); } if (done) this.jobs.shift(); else break; }
    } else if (this.bg.length) {
      // background work, 2 ms a frame, only while no crash is being worked through (a job waiting for another's
      // result, job.waiting, lets the next one run)
      // (4 ms while the player's car's model is being worked out, so it is ready sooner: a crash before it is done
      // works it out there and then, half a second or more)
      const end = performance.now() + (this.bg[0] && this.bg[0].analysis ? 4 : 2);
      for (let k = 0; k < this.bg.length && performance.now() < end; k++) {
        const j = this.bg[k]; let done = true;
        try { done = j.run(Math.max(0.2, end - performance.now())); } catch (e) { console.warn('damage bg', e); }
        if (done) { const at = this.bg.indexOf(j); if (at >= 0) this.bg.splice(at, 1); k--; continue; }
        if (!j.waiting) break;
      }
    } else this.preAnalyse();
    for (const rd of this.rigs) {
      if (!rd.damaged) continue;
      rd.animate(dt);
      if (rd.stamps.length) rd.flushStamps();
    }
    // traffic wrecks freed by the traffic module are reset there (rig.onFree); keep the list tidy
    this.trafficDamaged = this.trafficDamaged.filter(rd => rd.damaged && rd.root.parent);
    // knocked traffic running into the rest, and the swapped parked cars kept in their places
    try { this.knocks(dt); this.parkedTidy(); } catch (e) { if (!this._knErr) { console.warn('damage knocks', e); this._knErr = true; } }
    const near = car ? car.vehicle.pos : null;
    this.fx.update(dt, drive.camera, near);
    for (const rd of this.rigs) if (rd.cabin) rd.cabin.update(dt);
    this.fx.sound.scrape(this.scrapeLevel, 1);
  }

  // ---- tests and tools

  // hit(target, { point, dir, speed, kind, r, local }): target 'player', a rig, or a traffic car record; point and
  // dir in the world (dir: the way the impactor moves, into the car) or the car's frame with local: true
  hit(target, o = {}) {
    let rig = null, vehicle = null, c = null;
    if (!target || target === 'player') { rig = this.drive.car.rig; vehicle = this.drive.car.vehicle; }
    else if (target.rig && (target.L || target.parked)) { c = target; rig = c.rig; }
    else if (target.object) rig = target;
    if (!rig) return null;
    const rd = this.of(rig);
    if (vehicle) { rd.vehicle = vehicle; if (!vehicle._dmgAttached) this.attachPlayer(this.drive.car); }
    if (c && !c.parked) { rd.trafficCar = c; if (!this.trafficDamaged.includes(rd)) this.trafficDamaged.push(rd); }
    rd.analysis();
    rig.object.updateWorldMatrix(true, false);
    const M = rig.object.matrixWorld, inv = new THREE.Matrix4().copy(M).invert(), q = rig.object.getWorldQuaternion(new THREE.Quaternion());
    let P, N;
    if (o.local) { P = new THREE.Vector3().fromArray(o.point || [0, 0.5, -3]); N = new THREE.Vector3().fromArray(o.dir || [0, 0, 1]).normalize(); }
    else { P = new THREE.Vector3().fromArray(o.point).applyMatrix4(inv); N = new THREE.Vector3().fromArray(o.dir).applyQuaternion(q.clone().invert()).normalize(); }
    const yMid = P.y; if (Math.abs(N.y) < 0.6) { P.y = 0; N.y = 0; N.normalize(); }
    const imp = { sync: o.sync !== false, P, N, speed: o.speed || 10, kind: o.kind || 'flat', r: o.r || 0.15, t0: o.t0 ?? (o.width ? -o.width / 2 : -Infinity), t1: o.t1 ?? (o.width ? o.width / 2 : Infinity), b0: o.b0 ?? -Infinity, b1: o.b1 ?? Infinity, edge: o.edge, yMid, rollover: !!o.rollover };
    imp.world = P.clone().setY(o.local ? yMid : yMid).applyMatrix4(M);
    imp.normal = N.clone().applyQuaternion(q);
    const res = this.impact(rd, imp, { mSelf: rd.mass, mOther: o.mOther ?? Infinity, mul: o.mul ?? (imp.kind === 'pole' ? 1.55 : 1), vehicle });
    if (imp.sync) this.flush();
    rd.flushStamps();
    return { crush: res ? res.maxU : 0, D: imp.D, ms: res ? res.ms : null, side: imp.side };
  }
  // a scrape from a test: along the car's left or right side for a distance
  scrapeTest(target, { side = 'L', speed = 12, seconds = 1, y0 = 0.3, y1 = 0.9 } = {}) {
    const rig = !target || target === 'player' ? this.drive.car.rig : target.object ? target : target.rig;
    const rd = this.of(rig); rd.analysis();
    const N = new THREE.Vector3(side === 'L' ? 1 : -1, 0, 0), dt = 1 / 60;
    for (let t = 0; t < seconds; t += dt) {
      const P = new THREE.Vector3((side === 'L' ? -1 : 1) * rd.A.hw, 0, rnd(rd.A.box.min.z + 0.4, rd.A.box.max.z - 0.4));
      this.scrapeMarks(rd, P, N, new THREE.Vector3(0, 0, -speed), speed, dt, 0.7, y0, y1, false);
    }
    rd.flushStamps();
  }
  // back to new
  reset(rig) {
    if (!rig || !rig._dmg) return;
    const rd = rig._dmg;
    if (rd.doorJob && !rd.doorJob.done && rd.doorJob.started) { try { rd.doorJob.run(1e9); } catch (e) {} }
    this.bg = this.bg.filter(j => j.rd !== rd || j.analysis); rd.doorJob = null;
    try { rd.reset(); } catch (e) { console.warn('damage reset', e); }
    this.trafficDamaged = this.trafficDamaged.filter(r => r !== rd);
    // the player's outside subdivided again and the driver's door cut out again, ahead (R puts the car back as new)
    if (this.drive.car && this.drive.car.rig === rig && rd.readied) { try { this.presplit(rd); this.predoor(rd); } catch (e) {} }
  }
  repair(rig) { this.reset(rig); }
  clearDebris() { this.fx.clear(); for (const rec of this.parkedRecs.slice()) this.dropParked(rec, true); this._plist = null; }
  // a window broken from outside the crash (someone thrown through it): the nearest window of that kind to a point
  // in the car's frame shatters (a windscreen cracks)
  breakGlass(rig, localPoint, { kind } = {}) {
    const rd = this.of(rig), A = rd.analysis();
    let best = null, bd = Infinity;
    for (const w of A.windows) {
      if (w.merged || w.kind === 'lens' || w.kind === 'inner' || rd.ws(w).state === 'broken') continue;
      if (kind === 'front' && w.kind !== 'front') continue;
      const d = w.center.distanceToSquared(localPoint);
      if (d < bd) { bd = d; best = w; }
    }
    if (!best || bd > 6) return false;
    const imp = { P: localPoint.clone(), Ph: localPoint.clone(), N: best.center.clone().sub(localPoint).normalize(), side: kind === 'front' ? 'front' : localPoint.x < 0 ? 'left' : 'right', speed: 8 };
    if (best.laminated) rd.crackWindow(best, imp, null, 1.2); else rd.breakWindow(best, imp, null);
    return true;
  }
  // finish the queued work of one car now
  flushRig(rd) {
    const mine = this.jobs.filter(j => j.rd === rd);
    if (!mine.length) return;
    this.jobs = this.jobs.filter(j => j.rd !== rd);
    for (const j of mine) { try { j.run(1e9); } catch (e) { console.warn('damage job', e); } }
  }
  // finish every queued piece of work now
  flush() { let k = 0; while (this.jobs.length && k++ < 500) { const j = this.jobs[0]; try { if (j.run(1e9)) this.jobs.shift(); } catch (e) { console.warn('damage job', e); this.jobs.shift(); } } }
  stats() {
    const out = { impacts: this.n.impacts, scrapes: this.n.scrapes, lastCrush: this.lastCrush, debris: this.fx.debris.length, glass: this.fx.glass.used, sparks: this.fx.sparks.n, traffic: this.trafficDamaged.length, parked: this.parkedRecs.length, smoke: this.fx.smoke.list.length };
    const car = this.drive.car;
    if (car && car.rig && car.rig._dmg) { const rd = car.rig._dmg; out.player = { crush: +rd.crushTotal.toFixed(3), front: +rd.front.toFixed(3), engine: +rd.engine.toFixed(3), roof: +rd.roof.toFixed(3), parts: [...rd.parts.keys()], lamps: rd.lampsBroken.size, windows: rd.winState ? [...rd.winState.values()].filter(w => w.state === 'broken').length : 0, cracked: rd.winState ? [...rd.winState.values()].filter(w => w.cracks).length : 0, verts: rd.entries ? rd.entries.reduce((a, e) => a + (e.cur ? e.cur.length / 3 : 0), 0) : 0, analysisMs: rd.A ? rd.A.ms : null }; }
    return out;
  }
}
