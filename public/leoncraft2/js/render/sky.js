/* ---------------------------------------------------------------------------
   Leoncraft 2 - the sky.

   A physically based atmosphere in four small passes (Hillaire 2020, "A
   Scalable and Production Ready Sky and Atmosphere Rendering Technique"):

     transmittance   256 x 64, once: how much light gets through the air
                     from any height towards any angle
     multi-scatter   32 x 32, once: light bounced more than once in the air
     sky view        192 x 108, every frame: the sky's colour in every
                     direction, from where the player stands
     ambient         8 x 1, every frame: what the rest of the shaders light
                     with - the sky's light from above, from the side and
                     from the ground, and the colour of the sun (or moon) -
                     and how open the eye should be for that light

   The sun reddens at sunset because there is more air to get through, the
   sky goes deep blue overhead and pale at the horizon, and the world takes
   its colour from the same sky it is under.
--------------------------------------------------------------------------- */
import { COMMON, ATMOS } from './glsl.js?v=107';
const THREE = window.THREE;

export const SUN_I = 14.0;      // the sun's strength in the scene's units
export const MOON_I = 0.045;    // and the moon's: dim, but enough to walk by
/* Detailed's light look: a lighter sky than the atmosphere gives (so the
   day reads bright and clear, and the fog and the water's sheen with it),
   the sky's light into the shade brighter still (so a shadow is soft and
   readable, never black), and sunlight a little warmer. The exposure is
   then worked out from that light (texel 6), so the picture stays the same
   brightness from noon to dusk. */
const LOOK = /* glsl */`
const float SKY_GAIN = 1.5;
const float AMB_BOOST = 1.7;
const float KEY = 0.85;
// the Shader Options (render/looks.js): the sun's colour and strength (1.06, 1.0, 0.88 as it was),
// the sky's light in the shade, the sky's colour, and the exposure in stops as a factor
uniform vec3 uWarm;
uniform float uSkyK, uSkySat, uExpBias;
`;

export class FullScreen {
  constructor(material) {
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  set material(m) { this.mesh.material = m; }
  get material() { return this.mesh.material; }
  render(renderer, target) {
    renderer.setRenderTarget(target || null);
    renderer.render(this.scene, this.cam);
  }
}

export const VS_FULL = /* glsl */`
in vec3 position;
out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const HEAD = `precision highp float; precision highp int;\n`;

export function rawMat(fs, uniforms, extra) {
  return new THREE.RawShaderMaterial(Object.assign({
    glslVersion: THREE.GLSL3, vertexShader: HEAD + VS_FULL, fragmentShader: HEAD + fs,
    uniforms, depthTest: false, depthWrite: false,
  }, extra || {}));
}
export function floatTarget(w, h, o) {
  return new THREE.WebGLRenderTarget(w, h, Object.assign({
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
  }, o || {}));
}

/* ---- the passes ---- */
const FS_TRANS = COMMON + ATMOS + /* glsl */`
in vec2 vUv; out vec4 o;
void main() {
  float h = vUv.y * vUv.y * (RT - RG), mu = vUv.x * 2.0 - 1.0;
  vec3 ro = vec3(0.0, RG + h, 0.0), rd = vec3(sqrt(max(0.0, 1.0 - mu * mu)), mu, 0.0);
  float tg = raySphere(ro, rd, RG);
  if (tg > 0.0 && mu < 0.0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float t = raySphere(ro, rd, RT);
  vec3 od = vec3(0.0);
  const int N = 40;
  for (int i = 0; i < N; i++) {
    vec3 p = ro + rd * (float(i) + 0.5) / float(N) * t;
    od += medium(length(p) - RG).ext * t / float(N);
  }
  o = vec4(exp(-od), 1.0);
}`;

const FS_MS = COMMON + ATMOS + /* glsl */`
uniform sampler2D uTrans;
in vec2 vUv; out vec4 o;
vec3 trans(float h, float mu) { return textureLod(uTrans, transUV(h, mu), 0.0).rgb; }
void main() {
  float h = max(0.01, vUv.y * (RT - RG)), muS = vUv.x * 2.0 - 1.0;
  vec3 ro = vec3(0.0, RG + h, 0.0);
  vec3 sun = vec3(sqrt(max(0.0, 1.0 - muS * muS)), muS, 0.0);
  vec3 L2 = vec3(0.0), F = vec3(0.0);
  const int D = 8, N = 20;
  for (int i = 0; i < D; i++) for (int j = 0; j < D; j++) {
    float th = PI * (float(i) + 0.5) / float(D), ph = TAU * (float(j) + 0.5) / float(D);
    vec3 rd = vec3(sin(th) * cos(ph), cos(th), sin(th) * sin(ph));
    float tg = raySphere(ro, rd, RG);
    float t = tg > 0.0 ? tg : raySphere(ro, rd, RT);
    vec3 T = vec3(1.0), L = vec3(0.0), f = vec3(0.0);
    for (int k = 0; k < N; k++) {
      float dt = t / float(N);
      vec3 p = ro + rd * (float(k) + 0.5) * dt;
      float hp = length(p) - RG;
      Medium M = medium(hp);
      vec3 S = M.scatR + M.scatM;
      vec3 Ts = trans(hp, dot(normalize(p), sun));
      vec3 stp = exp(-M.ext * dt);
      vec3 integ = (1.0 - stp) / max(M.ext, 1e-6);
      L += T * S * Ts / (4.0 * PI) * integ;
      f += T * S * integ;
      T *= stp;
    }
    if (tg > 0.0) {
      vec3 pg = ro + rd * tg;
      float NoL = sat(dot(normalize(pg), sun));
      L += T * trans(0.0, dot(normalize(pg), sun)) * NoL * 0.3 / PI;
    }
    L2 += L / float(D * D); F += f / float(D * D);
  }
  o = vec4(L2 / (1.0 - F), 1.0);
}`;

const FS_VIEW = COMMON + ATMOS + LOOK + /* glsl */`
uniform sampler2D uTrans, uMS;
uniform vec3 uSunDir, uMoonDir;
uniform float uCamH, uSunI, uMoonI;
in vec2 vUv; out vec4 o;
vec3 trans(float h, float mu) { return textureLod(uTrans, transUV(h, mu), 0.0).rgb; }
vec3 ms(float h, float mu) { return textureLod(uMS, vec2(mu * 0.5 + 0.5, sat(h / (RT - RG))), 0.0).rgb; }
void main() {
  // more of the table at the horizon, where the colour changes fastest
  float v = vUv.y - 0.5;
  float elev = sign(v) * sqr(2.0 * abs(v)) * (PI * 0.5);
  float az = vUv.x * TAU;
  vec3 rd = vec3(cos(elev) * cos(az), sin(elev), cos(elev) * sin(az));
  vec3 ro = vec3(0.0, RG + uCamH, 0.0);
  float tg = raySphere(ro, rd, RG);
  float t = tg > 0.0 ? tg : raySphere(ro, rd, RT);
  t = min(t, 400.0);
  vec3 T = vec3(1.0), L = vec3(0.0);
  float cs = dot(rd, uSunDir), cm = dot(rd, uMoonDir);
  float pRs = phaseRay(cs), pMs = phaseHG(cs, MIE_G), pRm = phaseRay(cm), pMm = phaseHG(cm, MIE_G);
  const int N = 30;
  for (int k = 0; k < N; k++) {
    // steps bunched up near the eye
    float a = float(k) / float(N), b = float(k + 1) / float(N);
    float t0 = a * a * t, t1 = b * b * t, dt = t1 - t0;
    vec3 p = ro + rd * (t0 + dt * 0.5);
    float hp = length(p) - RG;
    vec3 up = normalize(p);
    Medium M = medium(hp);
    vec3 stp = exp(-M.ext * dt);
    vec3 integ = (1.0 - stp) / max(M.ext, 1e-6);
    float mus = dot(up, uSunDir), mum = dot(up, uMoonDir);
    vec3 sunL = trans(hp, mus) * (M.scatR * pRs + M.scatM * pMs) + ms(hp, mus) * (M.scatR + M.scatM);
    vec3 moonL = trans(hp, mum) * (M.scatR * pRm + M.scatM * pMm) + ms(hp, mum) * (M.scatR + M.scatM);
    L += T * (sunL * uSunI + moonL * uMoonI) * integ;
    T *= stp;
  }
  // Shader Options, Sky Colour: towards grey, or deeper
  L *= SKY_GAIN;
  float g = dot(L, vec3(0.2126, 0.7152, 0.0722));
  o = vec4(max(vec3(0.0), g + (L - g) * uSkySat), 1.0);
}`;

// what the scene is lit by: sky light from above, from the side, from below, then the sun or moon,
// then the exposure for that light
const FS_AMB = COMMON + ATMOS + LOOK + /* glsl */`
uniform sampler2D uView, uTrans;
uniform vec3 uSunDir, uMoonDir;
uniform float uCamH, uSunI, uMoonI;
in vec2 vUv; out vec4 o;
vec3 skyL(vec3 d) {
  float elev = asin(clamp(d.y, -1.0, 1.0));
  float v = 0.5 + 0.5 * sign(elev) * sqrt(abs(elev) / (PI * 0.5));
  float az = atan(d.z, d.x); if (az < 0.0) az += TAU;
  return textureLod(uView, vec2(az / TAU, v), 0.0).rgb;
}
vec3 irr(vec3 n) {
  vec3 E = vec3(0.0);
  for (int i = 0; i < 6; i++) for (int j = 0; j < 12; j++) {
    float th = (float(i) + 0.5) / 6.0 * PI * 0.5;
    float ph = (float(j) + 0.5) / 12.0 * TAU;
    vec3 d = vec3(sin(th) * cos(ph), cos(th), sin(th) * sin(ph));
    // turn the upward hemisphere to face n
    vec3 up = abs(n.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 tx = normalize(cross(up, n)), ty = cross(n, tx);
    vec3 w = tx * d.x + n * d.y + ty * d.z;
    vec3 Lw = w.y > 0.0 ? skyL(w) : vec3(0.0);
    E += Lw * cos(th) * sin(th);
  }
  return E * (PI * 0.5 / 6.0) * (TAU / 12.0);
}
void main() {
  int i = int(gl_FragCoord.x);
  vec3 sunT = texture(uTrans, transUV(uCamH, uSunDir.y)).rgb;
  vec3 moonT = texture(uTrans, transUV(uCamH, uMoonDir.y)).rgb;
  vec3 c = vec3(0.0);
  vec3 light = uSunDir.y > -0.02 ? sunT * uSunI * smoothstep(-0.02, 0.03, uSunDir.y) : moonT * uMoonI * smoothstep(-0.02, 0.06, uMoonDir.y);
  /* The sky's light on the faces this texel wants: the four sides averaged
     for 1, straight up for 0, 2 and 6. Gathered in one loop whose length the
     shader compiler cannot know, so irr() is in the program once: called
     seven times over, each copy unrolled, it took the compiler two thirds
     of a second the first time a shader look was chosen. (The same sums in
     the same order as before; the sky table is read with textureLod, as a
     loop of unknown length allows, the same texel it read before.) */
  int faces = i == 1 ? 4 : i == 0 || i == 2 || i == 6 ? 1 : 0;
  vec3 Ei = vec3(0.0);
  for (int k = 0; k < faces; k++)
    Ei += irr(i != 1 ? vec3(0.0, 1.0, 0.0) : k == 0 ? vec3(1.0, 0.0, 0.0) : k == 1 ? vec3(-1.0, 0.0, 0.0) : k == 2 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 0.0, -1.0));
  if (i == 0) c = Ei * AMB_BOOST * uSkyK;
  else if (i == 1) c = Ei * 0.25 * AMB_BOOST * uSkyK;
  else if (i == 2) {
    // what bounces off the ground: sky and sun on grass-ish ground
    vec3 Eg = Ei + sunT * uSunI * sat(uSunDir.y) + moonT * uMoonI * sat(uMoonDir.y);
    c = Eg * 0.18 * AMB_BOOST * uSkyK;
  }
  else if (i == 3) c = light * uWarm;
  else if (i == 4) c = sunT * uSunI;
  else if (i == 5) c = moonT * uMoonI;
  else if (i == 6) {
    // how much light falls on an everyday scene (a third of the sun, all of the sky), and the exposure that keeps it
    // mid-bright; at night it opens no further than the moon allows, so night stays night
    float E = lum(light) * 0.35 + lum(Ei) * AMB_BOOST;
    c = vec3(clamp(KEY / max(E, 1e-4), 0.05, 4.5) * uExpBias);
  }
  o = vec4(c, 1.0);
}`;

/* The fog's colour in every direction above the horizon, for the shaders
   that fog per vertex: the sky table again, laid out so a direction finds
   its place without any angles (a hemi-octahedron: x + z and x - z over the
   sum of the three, the horizon round the edge). */
const FS_FOGTAB = COMMON + /* glsl */`
uniform sampler2D uView;
in vec2 vUv; out vec4 o;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  vec2 xz = vec2(p.x + p.y, p.x - p.y) * 0.5;
  vec3 d = normalize(vec3(xz.x, max(1.0 - abs(xz.x) - abs(xz.y), 0.0), xz.y));
  d = normalize(vec3(d.x, max(d.y, 0.02), d.z));
  float elev = asin(clamp(d.y, -1.0, 1.0));
  float v = 0.5 + 0.5 * sign(elev) * sqrt(abs(elev) / (PI * 0.5));
  float az = atan(d.z, d.x); if (az < 0.0) az += TAU;
  o = vec4(texture(uView, vec2(az / TAU, v)).rgb, 1.0);
}`;

export class Sky {
  /* later: its shaders made but not yet drawn with, so they can be built in the
     background first (render/looks.js), and the tables drawn by init() once they
     are; the first time the shaders are turned on while playing, building them
     where they were first drawn held the game up for a second and more */
  constructor(renderer, later) {
    this.renderer = renderer;
    this.fs = new FullScreen(null);
    this.trans = floatTarget(256, 64);
    this.ms = floatTarget(32, 32);
    this.view = floatTarget(192, 108, { wrapS: THREE.RepeatWrapping });
    this.amb = floatTarget(8, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.fog = floatTarget(64, 64);
    this.uniforms = {
      uTrans: { value: this.trans.texture }, uMS: { value: this.ms.texture }, uView: { value: this.view.texture },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uCamH: { value: 0.2 }, uSunI: { value: SUN_I }, uMoonI: { value: MOON_I },
      uWarm: { value: new THREE.Vector3(1.06, 1.0, 0.88) }, uSkyK: { value: 1 }, uSkySat: { value: 1 }, uExpBias: { value: 1 },
    };
    this.mTrans = rawMat(FS_TRANS, {});
    this.mMS = rawMat(FS_MS, this.uniforms);
    this.mView = rawMat(FS_VIEW, this.uniforms);
    this.mAmb = rawMat(FS_AMB, this.uniforms);
    this.mFog = rawMat(FS_FOGTAB, this.uniforms);
    // the light table, as numbers the CPU can hand to the shaders (see readLight)
    this.light = new Float32Array(32);
    this.lightRead = false;
    this.ready = false;
    if (!later) this.init();
  }
  // every shader the tables are drawn with, for building ahead
  get materials() { return [this.mTrans, this.mMS, this.mView, this.mAmb, this.mFog]; }
  // the two tables that never change (the air's transmittance and its multiple scattering)
  init() {
    if (this.ready) return;
    this.ready = true;
    this.fs.material = this.mTrans; this.fs.render(this.renderer, this.trans);
    this.fs.material = this.mMS; this.fs.render(this.renderer, this.ms);
  }
  update(sunDir, moonDir, eyeY) {
    for (let k = 0; k < 3; k++) this.part(k, sunDir, moonDir, eyeY);
  }
  /* The same, a third at a time (renderer.js spreads it over three frames, so
     no one frame pays for the whole table): 0 the sky in every direction,
     1 the fog's table from it, 2 the light it gives and its read-back. */
  part(k, sunDir, moonDir, eyeY, later) {
    if (k === 0) {
      this.uniforms.uSunDir.value.copy(sunDir);
      this.uniforms.uMoonDir.value.copy(moonDir);
      this.uniforms.uCamH.value = Math.max(0.01, 0.2 + (eyeY - 63) / 1000);
      this.fs.material = this.mView; this.fs.render(this.renderer, this.view);
    } else if (k === 1) { this.fs.material = this.mFog; this.fs.render(this.renderer, this.fog); }
    else { this.fs.material = this.mAmb; this.fs.render(this.renderer, this.amb); this.askLight(later); }
  }
  /* The eight numbers of the light table (sky light from above, the side
     and below, the sun or moon, the exposure...) read back to the CPU, so
     the shaders that light per vertex take them as plain values instead of
     reading the table at every vertex. The read is started after the table
     is drawn and picked up a frame or two later, when the graphics card has
     done it (a fence), so it never makes the CPU wait; the very first one is
     read at once, unless later (render/looks.js waits for it). The sky
     changes slowly, so a frame or two late is never seen. */
  askLight(later) {
    const r = this.renderer, gl = r.getContext();
    if (this.fence) return;
    r.setRenderTarget(this.amb);
    if (!this.lightRead && !later) {
      gl.readPixels(0, 0, 8, 1, gl.RGBA, gl.FLOAT, this.light);
      this.lightRead = true;
      return;
    }
    if (!this.pbo) {
      this.pbo = gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, this.light.byteLength, gl.STREAM_READ);
    } else gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.readPixels(0, 0, 8, 1, gl.RGBA, gl.FLOAT, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
  }
  /* Once a frame, for Detailed: the table's values as the per-vertex shaders
     take them (materials.js LEAN_VS, glsl.js fogTerms). The sky's light from
     above, the side and below is greyed a little and has the sun's bounce off
     the ground added, as the blocks' shader always did; the exposure is the
     table's, eased over to the renderer's own in a cave, and the renderer's
     alone in the Nether and the End (glsl.js EXPOSURE); the fog thickens
     below the eye's height (uFogK). */
  setUniforms(U, camY) {
    this.readLight();
    const a = this.light;
    const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const sr = a[12], sg = a[13], sb = a[14];
    const put = (v, i) => {
      const r = a[i], g = a[i + 1], b = a[i + 2], m = lum(r, g, b);
      v.set(r + (m - r) * 0.22 + sr * 0.03, g + (m - g) * 0.22 + sg * 0.03, b + (m - b) * 0.22 + sb * 0.03);
    };
    put(U.uAmbUp.value, 0); put(U.uAmbSide.value, 4); put(U.uAmbDown.value, 8);
    U.uSunC.value.set(sr, sg, sb);
    U.uDayK.value = Math.min(1, Math.max(0, lum(sr, sg, sb) * 0.3));
    const e = Math.max(1e-4, a[24]), cave = U.uCave.value, ex = U.uExposure.value;
    U.uExpo.value = U.uDim.value > 0.5 ? ex : cave > 0 ? Math.exp(Math.log(e) + (Math.log(ex) - Math.log(e)) * cave) : e;
    U.uFogK.value = 0.0019 * Math.exp(-(camY - 63) / 60);
  }
  // once a frame: has the last read arrived?
  readLight() {
    if (!this.fence) return;
    const gl = this.renderer.getContext();
    if (gl.clientWaitSync(this.fence, 0, 0) === gl.TIMEOUT_EXPIRED) return;
    gl.deleteSync(this.fence);
    this.fence = null;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.light);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.lightRead = true;
  }
}
