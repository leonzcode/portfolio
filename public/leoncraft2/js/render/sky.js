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
import { COMMON, ATMOS } from './glsl.js?v=12';
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
const vec3 WARM = vec3(1.06, 1.0, 0.88);
const float KEY = 0.85;
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
  o = vec4(L * SKY_GAIN, 1.0);
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
  return texture(uView, vec2(az / TAU, v)).rgb;
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
  if (i == 0) c = irr(vec3(0.0, 1.0, 0.0)) * AMB_BOOST;
  else if (i == 1) c = (irr(vec3(1.0, 0.0, 0.0)) + irr(vec3(-1.0, 0.0, 0.0)) + irr(vec3(0.0, 0.0, 1.0)) + irr(vec3(0.0, 0.0, -1.0))) * 0.25 * AMB_BOOST;
  else if (i == 2) {
    // what bounces off the ground: sky and sun on grass-ish ground
    vec3 Eg = irr(vec3(0.0, 1.0, 0.0)) + sunT * uSunI * sat(uSunDir.y) + moonT * uMoonI * sat(uMoonDir.y);
    c = Eg * 0.18 * AMB_BOOST;
  }
  else if (i == 3) c = light * WARM;
  else if (i == 4) c = sunT * uSunI;
  else if (i == 5) c = moonT * uMoonI;
  else if (i == 6) {
    // how much light falls on an everyday scene (a third of the sun, all of the sky), and the exposure that keeps it
    // mid-bright; at night it opens no further than the moon allows, so night stays night
    float E = lum(light) * 0.35 + lum(irr(vec3(0.0, 1.0, 0.0))) * AMB_BOOST;
    c = vec3(clamp(KEY / max(E, 1e-4), 0.05, 4.5));
  }
  o = vec4(c, 1.0);
}`;

export class Sky {
  constructor(renderer) {
    this.renderer = renderer;
    this.fs = new FullScreen(null);
    this.trans = floatTarget(256, 64);
    this.ms = floatTarget(32, 32);
    this.view = floatTarget(192, 108, { wrapS: THREE.RepeatWrapping });
    this.amb = floatTarget(8, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.uniforms = {
      uTrans: { value: this.trans.texture }, uMS: { value: this.ms.texture }, uView: { value: this.view.texture },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uCamH: { value: 0.2 }, uSunI: { value: SUN_I }, uMoonI: { value: MOON_I },
    };
    this.mTrans = rawMat(FS_TRANS, {});
    this.mMS = rawMat(FS_MS, this.uniforms);
    this.mView = rawMat(FS_VIEW, this.uniforms);
    this.mAmb = rawMat(FS_AMB, this.uniforms);
    this.fs.material = this.mTrans; this.fs.render(renderer, this.trans);
    this.fs.material = this.mMS; this.fs.render(renderer, this.ms);
  }
  update(sunDir, moonDir, eyeY) {
    this.uniforms.uSunDir.value.copy(sunDir);
    this.uniforms.uMoonDir.value.copy(moonDir);
    this.uniforms.uCamH.value = Math.max(0.01, 0.2 + (eyeY - 63) / 1000);
    this.fs.material = this.mView; this.fs.render(this.renderer, this.view);
    this.fs.material = this.mAmb; this.fs.render(this.renderer, this.amb);
  }
}
