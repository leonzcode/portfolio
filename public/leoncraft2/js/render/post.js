/* ---------------------------------------------------------------------------
   Leoncraft 2 - everything after the world is drawn.

     copies      the opaque scene's colour and linear depth, for the water
     light       volumetric light at half resolution: a dithered march along
                 every view ray through the shadow map, scattering forward
                 (Henyey-Greenstein), so sunbeams come down through the gaps
                 in the leaves; under water, shafts broken up by caustics
     clouds      a volumetric cloud layer, marched at half resolution and
                 blended over the last frame's so it settles smooth
     composite   the sky (from the atmosphere), the sun's disc, the moon in
                 its phase, stars; height fog in the sky's own colour; the
                 render distance faded into the horizon; under water, the
                 water's colour closing in
     bloom       six halvings down and back up (13-tap down, tent up)
     exposure    the scene's average brightness, adapted to over a second
     final       AgX tone mapping, a little vignette, sRGB, then FXAA
--------------------------------------------------------------------------- */
import { COMMON, SHADOW, TONEMAP, ATMOS, LIGHTS, TONE_CURVES, VOID } from './glsl.js?v=107';
import { FullScreen, rawMat, floatTarget } from './sky.js?v=107';
import { END_FLASH_GLSL } from './endflash.js?v=107';
const THREE = window.THREE;
/* How much brighter the day sky is drawn than the eye has it (on top of 1): at noon our sky, exposed for
   the land, was a grey blue about half as bright on the screen as the game's light blue (FS_FINAL) */
const SKY_GAIN = 1.5;
const HEAD = `precision highp float; precision highp int; precision highp sampler2DShadow; precision highp sampler3D;\n`;
const mat = (fs, u, extra) => {
  const m = rawMat(fs, u, extra);
  m.fragmentShader = HEAD + m.fragmentShader.replace('precision highp float; precision highp int;\n', '');
  return m;
};

const SKYFN = /* glsl */`
uniform sampler2D uView;
vec3 skyRadiance(vec3 d) {
  float elev = asin(clamp(d.y, -1.0, 1.0));
  float v = 0.5 + 0.5 * sign(elev) * sqrt(abs(elev) / (PI * 0.5));
  float az = atan(d.z, d.x); if (az < 0.0) az += TAU;
  return texture(uView, vec2(az / TAU, v)).rgb;
}
`;
const RECON = /* glsl */`
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform float uNear, uFar;
float linearize(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
vec3 worldAt(vec2 uv, float d) { vec4 p = uInvViewProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
`;

const FS_COPY = /* glsl */`
uniform sampler2D uSrc; in vec2 vUv; out vec4 o;
void main() { o = texture(uSrc, vUv); }`;
const FS_LINDEPTH = /* glsl */`
uniform sampler2D uDepth; uniform float uNear, uFar; in vec2 vUv; out vec4 o;
void main() {
  float d = texture(uDepth, vUv).r;
  float z = d * 2.0 - 1.0;
  float l = d >= 1.0 ? uFar : 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
  o = vec4(l, 0.0, 0.0, 1.0);
}`;

/* ---- volumetric light ---- */
const FS_VL = COMMON + SHADOW + RECON + /* glsl */`
uniform sampler2D uDepth, uAmbient, uNoise;
uniform vec3 uLightDir;
uniform float uFrame, uEyeInWater, uTime, uSkyAtEye;
uniform vec3 uWaterTint;
uniform float uDim;
uniform float uVLK;     // Light Shafts: how strong in the air (Low 1, High more)
in vec2 vUv; out vec4 o;
float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
float caustic(vec3 p) {
  vec2 q = p.xz - uLightDir.xz / max(uLightDir.y, 0.2) * p.y * 0.2;
  float t = uTime * 0.35;
  float a = textureLod(uNoise, q * 0.045 + vec2(t * 0.3, t * 0.17), 0.0).r;
  float b = textureLod(uNoise, q * 0.071 - vec2(t * 0.21, -t * 0.26), 0.0).g;
  return pow(sat(1.0 - abs(a - b) * 3.2), 3.0) * 1.4 + 0.4;
}
` + LIGHTS + /* glsl */`
void main() {
  if (uDim > 0.5) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }     // no sun to make shafts of
  float d = texture(uDepth, vUv).r;
  vec3 wp = worldAt(vUv, d);
  vec3 ro = uCamPos;
  vec3 rd = wp - ro;
  float len = length(rd); rd /= len;
  bool water = uEyeInWater > 0.5;
  float maxD = water ? 48.0 : 160.0;
  len = min(len, maxD);
  vec3 sunC = texelFetch(uAmbient, ivec2(3, 0), 0).rgb;
  float c = dot(rd, uLightDir);
  float phase = water ? 0.7 * hg(c, 0.55) + 0.3 / (4.0 * PI) : 0.65 * hg(c, 0.62) + 0.35 * hg(c, -0.15);
  const int N = VL_STEPS;
  float jit = ign(gl_FragCoord.xy, uFrame);
  vec3 T = vec3(1.0), L = vec3(0.0);
  float prevT = 0.0;
  vec3 absorb = -0.15 * log(max(uWaterTint, vec3(0.02))) + 0.03;
  for (int i = 0; i < N; i++) {
    float f = (float(i) + jit) / float(N);
    float t = f * f * len;
    float dt = t - prevT; prevT = t;
    vec3 p = ro + rd * t;
    vec4 sc = uShadowMat * vec4(p, 1.0);
    sc.z *= 0.2;
    vec3 s = sc.xyz * 0.5 + 0.5;
    float vis = shadowHard(s);
    vec3 sigS, sigT;
    if (water) {
      sigS = vec3(0.045) * uWaterTint * 1.6; sigT = absorb * 0.9 + 0.03;
      vis *= caustic(p);
    } else {
      float h = max(p.y - 63.0, -8.0);
      float dens = (0.0045 * exp(-h / 45.0) + 0.0007) * uVLK;
      sigS = vec3(dens); sigT = vec3(dens * 1.05);
    }
    vec3 stepT = exp(-sigT * dt);
    L += T * sigS * vis * phase * (1.0 - stepT) / max(sigT, 1e-5);
    T *= stepT;
  }
  o = vec4(L * sunC * uSkyAtEye, 1.0);
}`;

/* ---- clouds ---- */
const FS_CLOUDS = COMMON + RECON + SKYFN + /* glsl */`
uniform sampler2D uDepth, uAmbient, uNoise, uHistory;
uniform sampler3D uNoise3;
uniform vec3 uLightDir, uSunDir;
uniform float uFrame, uTime, uCover;
uniform mat4 uPrevViewProj;
in vec2 vUv; out vec4 o;
const float C0 = 250.0, C1 = 330.0;
float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
float density(vec3 p, bool cheap) {
  vec2 wind = vec2(uTime * 2.2, uTime * 0.9);
  float h = (p.y - C0) / (C1 - C0);
  float cov = textureLod(uNoise, (p.xz + wind) * 0.00018, 0.0).a * 0.65 + textureLod(uNoise, (p.xz + wind * 1.3) * 0.0007, 0.0).r * 0.35;
  cov = sat((cov - (1.0 - uCover)) * 2.6);
  // fat at the bottom, thin at the top: a cumulus profile
  float prof = smoothstep(0.0, 0.12, h) * smoothstep(1.0, 0.45, h);
  float d = cov * prof;
  if (d < 0.02) return 0.0;
  if (cheap) return d;
  vec3 q = (p + vec3(wind.x, 0.0, wind.y) * 1.2) * 0.012;
  vec4 n = textureLod(uNoise3, q, 0.0);
  float erosion = n.r * 0.6 + n.g * 0.3 + n.b * 0.1;
  return sat(d - erosion * 0.45 * (1.0 - h * 0.3)) * 1.6;
}
void main() {
  float d = texture(uDepth, vUv).r;
  vec3 wp = worldAt(vUv, d);
  vec3 ro = uCamPos, rd = normalize(wp - ro);
  float sceneT = d >= 1.0 ? 1e9 : length(wp - ro);
  // where the ray is inside the slab
  float t0, t1;
  if (abs(rd.y) < 1e-4) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float ta = (C0 - ro.y) / rd.y, tb = (C1 - ro.y) / rd.y;
  t0 = max(min(ta, tb), 0.0); t1 = max(ta, tb);
  t1 = min(t1, min(sceneT, 9000.0));
  if (t1 <= t0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float span = t1 - t0;
  const int N = CLOUD_STEPS;
  float dt = span / float(N);
  float jit = ign(gl_FragCoord.xy, uFrame);
  vec3 sunC = texelFetch(uAmbient, ivec2(3, 0), 0).rgb;
  vec3 ambC = texelFetch(uAmbient, ivec2(0, 0), 0).rgb / PI;
  float c = dot(rd, uLightDir);
  float ph = 0.6 * hg(c, 0.7) + 0.4 * hg(c, -0.2);
  float T = 1.0; vec3 L = vec3(0.0);
  for (int i = 0; i < N; i++) {
    vec3 p = ro + rd * (t0 + (float(i) + jit) * dt);
    float den = density(p, false);
    if (den <= 0.0) continue;
    // light reaching this point through the cloud above it
    float od = 0.0;
    for (int j = 1; j <= 4; j++) od += density(p + uLightDir * float(j * j) * 6.0, true) * 6.0 * float(2 * j - 1);
    float sig = den * 0.045;
    float beer = exp(-od * 0.012) * 0.7 + exp(-od * 0.003) * 0.3, powder = 1.0 - exp(-od * 0.05);
    vec3 S = sunC * beer * mix(1.0, powder * 2.0, 0.5) * ph * 1.6 + ambC * (0.55 + 0.45 * (p.y - C0) / (C1 - C0));
    float st = exp(-sig * dt);
    L += T * S * (1.0 - st);
    T *= st;
    if (T < 0.03) break;
  }
  // far clouds melt into the haze
  float fade = exp(-t0 * 0.00022);
  L *= fade; T = mix(1.0, T, fade);
  vec4 cur = vec4(L, T);
  // settle over a few frames where the last frame saw the same sky
  vec3 far = ro + rd * (t0 + span * 0.5);
  vec4 pc = uPrevViewProj * vec4(far, 1.0);
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
  if (pc.w > 0.0 && puv.x > 0.0 && puv.y > 0.0 && puv.x < 1.0 && puv.y < 1.0 && d >= 1.0) {
    vec4 h = texture(uHistory, puv);
    cur = mix(cur, h, 0.82);
  }
  o = cur;
}`;

/* ---- composite ---- */
const FS_COMP = COMMON + RECON + SKYFN + VOID + TONEMAP + END_FLASH_GLSL + /* glsl */`
uniform sampler2D uColor, uDepth, uVL, uClouds, uAmbient, uMoon, uExpoTex;
uniform vec3 uSunDir, uMoonDir;
uniform float uTime, uEyeInWater, uRender, uMoonPhase, uSkyAtEye;
uniform vec3 uWaterTint;
// the other dimensions (js/dims.js): their fog colour and range, and the End's sky
uniform float uDim;
uniform vec3 uDimFog;
uniform vec2 uDimFogRange;
uniform sampler2D uEndSky;
uniform float uFogMul;          // the fog's thickness (Shader Options: Fog)
uniform vec3 uShut;             // Blindness and Darkness: a black fog from x to y blocks, z its strength (vanilla.js shutFog)
uniform mat4 uVPNow;            // this frame's view and projection (RIP Computer's puddles)
uniform sampler2D uNoise;
uniform float uRain;
in vec2 vUv; out vec4 o;
/* RIP Computer's puddles (materials.js PUDDLES marks them in the alpha): what is round them and the sky, seen in
   water, with the rain's rings on it. A ray off the water marched across the depth, as the water's own is (water.js
   ssr), the sky where it finds nothing; then mixed in by the water's Fresnel, before the fog. */
vec2 pudRand(vec2 c) { return fract(sin(vec2(dot(c, vec2(127.1, 311.7)), dot(c, vec2(269.5, 183.3)))) * 43758.5453); }
vec2 pudRings(vec2 p) {
  vec2 n = vec2(0.0);
  for (int k = 0; k < 2; k++) {
    vec2 q = p * (k == 0 ? 1.6 : 2.35) + float(k) * 17.3;
    vec2 cell = floor(q), f = fract(q), h = pudRand(cell);
    float t = fract(uTime * (0.8 + h.x * 0.7) + h.y);
    vec2 d = f - (0.3 + 0.4 * pudRand(cell + 5.17));
    float r = length(d), w = (r - t * 0.3) * 22.0;
    if (abs(w) < 3.14159) n += d / max(r, 1e-3) * sin(w) * (1.0 - t) * (1.0 - t);
  }
  return n;
}
vec2 pudUV(vec3 p, out float w) { vec4 c = uVPNow * vec4(p, 1.0); w = c.w; return c.xy / c.w * 0.5 + 0.5; }
vec3 puddleLook(vec3 col, vec3 wp, vec3 rd, float dist, float k) {
  vec2 ring = pudRings(wp.xz) * uRain;
  float n0 = textureLod(uNoise, wp.xz * 0.3 + uTime * 0.03, 0.0).y - 0.5;
  vec3 n = normalize(vec3(ring.x * 0.4 + n0 * 0.05, 1.0, ring.y * 0.4 + n0 * 0.05));
  vec3 R = reflect(rd, n);
  // (a little more than water's own 2 per cent head on: a puddle reads as one from a few blocks away, as it does outside)
  float F = 0.07 + 0.93 * pow(1.0 - sat(-dot(rd, n)), 4.0);
  vec3 refl = skyRadiance(normalize(vec3(R.x, max(R.y, 0.0), R.z)));
  float stepLen = 0.2 + dist * 0.012, w;
  vec3 p = wp + n * 0.04, prev = p;
  for (int i = 0; i < 28; i++) {
    prev = p; p += R * stepLen; stepLen *= 1.18;
    vec2 uv = pudUV(p, w);
    if (w <= uNear || uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) break;
    float sl = linearize(textureLod(uDepth, uv, 0.0).r);
    if (w > sl && w - sl < stepLen * 2.5 + 0.3) {
      vec3 a = prev, b = p;
      for (int j = 0; j < 5; j++) { vec3 m = (a + b) * 0.5; float mw; vec2 muv = pudUV(m, mw); if (mw > linearize(textureLod(uDepth, muv, 0.0).r)) b = m; else a = m; }
      float bw; vec2 huv = pudUV(b, bw);
      if (textureLod(uDepth, huv, 0.0).r >= 1.0) break;    // that was the sky
      vec2 e = abs(huv * 2.0 - 1.0);
      float fade = (1.0 - pow(max(e.x, e.y), 8.0)) * sat(1.0 - float(i) / 28.0 * 0.5);
      refl = mix(refl, textureLod(uColor, huv, 0.0).rgb, fade);
      break;
    }
  }
  return mix(col, refl, F * k);
}
float shutAt(float dist, float d) { return uShut.z > 0.0 ? uShut.z * (d >= 1.0 ? 1.0 : smoothstep(uShut.x, uShut.y, dist)) : 0.0; }
vec3 stars(vec3 d) {
  vec3 p = d * 220.0;
  vec3 i = floor(p), f = fract(p);
  float h = hash13(i);
  if (h < 0.9935) return vec3(0.0);
  float b = hash13(i + 7.1);
  float r = length(f - 0.5);
  float tw = 0.7 + 0.3 * sin(uTime * (2.0 + b * 4.0) + h * 100.0);
  vec3 col = mix(vec3(1.0, 0.82, 0.62), vec3(0.75, 0.85, 1.0), b);
  return col * smoothstep(0.35, 0.0, r) * (0.004 + 0.02 * b * b) * tw;
}
void main() {
  vec4 base = texture(uColor, vUv);
  float d = texture(uDepth, vUv).r;
  vec3 wp = worldAt(vUv, d);
  vec3 rd = normalize(wp - uCamPos);
  float dist = length(wp - uCamPos);
  vec3 col = base.rgb;
  if (base.a > 1.0005 && base.a < 1.5 && d < 1.0 && uDim < 0.5) col = puddleLook(col, wp, rd, dist, sat((base.a - 1.0) / 0.45));
  if (uDim > 0.5) {
    // no atmosphere: the Nether's sky is its fog, the End's a dark violet grain on a box; fog closes in linearly.
    // Both come out on the screen the colour the game shows them (as lava does: water.js), worked back
    // through the eye and the tone curve: put in as they were, the eye opened for the dark there made the
    // Nether's sky a glaring scarlet nearly three times as bright as the game's dark red
    // (worked out only where it shows: the fog's colour is the same over the whole frame)
    float E = max(texture(uExpoTex, vec2(0.5)).r, 1e-3);
    if (d >= 1.0) {
      if (uDim > 1.5) {
        vec3 a = abs(rd);
        vec2 q = a.x > a.y && a.x > a.z ? rd.zy / a.x : a.y > a.z ? rd.xz / a.y : rd.xy / a.z;
        col = agxInverse(fromSRGB(min(texture(uEndSky, (q * 0.5 + 0.5) * 16.0).rgb * (40.0 / 255.0) + endFlashSky(rd), 1.0))) / E;
      } else col = agxInverse(fromSRGB(pow(uDimFog, vec3(1.0 / 2.2)))) / E;
    } else {
      // (uDimFog is the screen colour to the power 2.2: dim/look.js)
      float f = sat((dist - uDimFogRange.x) / max(1.0, uDimFogRange.y - uDimFogRange.x));
      if (f > 0.0) col = mix(col, agxInverse(fromSRGB(pow(uDimFog, vec3(1.0 / 2.2)))) / E, f);
    }
    float sh = shutAt(dist, d);
    col *= 1.0 - sh;
    // (the sky is left out of the eye's measure too: set by the exposure, it would only chase it)
    o = vec4(col, base.a > 1.5 || sh > 0.5 || d >= 1.0 ? 0.0 : 1.0);
    return;
  }
  vec3 sunC = texelFetch(uAmbient, ivec2(4, 0), 0).rgb;
  vec3 moonC = texelFetch(uAmbient, ivec2(5, 0), 0).rgb;
  bool water = uEyeInWater > 0.5;
  // block clouds (renderer.js): their colour already weighed by how much of them there is, and what
  // shows through them in the alpha; the sky is put behind them here, and they melt by themselves
  bool cloud = base.a < 0.999 && d < 1.0;
  // how much of this pixel is the sky's own colour (the sky, and the fog and the haze at the world's
  // edge that are the sky's colour), for the day sky's brightening in FS_FINAL
  float skyW = d >= 1.0 || cloud ? 1.0 : 0.0;
  if (d >= 1.0 || cloud) {
    // below the horizon there is only what has not loaded yet: the haze at the horizon
    col = skyRadiance(vec3(rd.x, max(rd.y, 0.0), rd.z));
    // the sun's disc, darker at its edge
    float cs = dot(rd, uSunDir);
    float r = acos(clamp(cs, -1.0, 1.0)) / radians(0.75);
    if (r < 1.0) col += sunC * 260.0 * pow(1.0 - r * r, 0.25);
    col += sunC * 0.6 * pow(sat(cs), 900.0);
    // the moon, in its phase
    vec3 md = uMoonDir;
    vec3 mu = normalize(cross(md, vec3(0.0, 0.0, 1.0))), mv = cross(mu, md);
    vec2 mp = vec2(dot(rd, mu), dot(rd, mv)) / radians(1.6);
    if (dot(rd, md) > 0.0 && abs(mp.x) < 1.0 && abs(mp.y) < 1.0) {
      vec2 cell = vec2(mod(uMoonPhase, 4.0), floor(uMoonPhase / 4.0));
      vec2 muv = (cell + (mp * 0.5 + 0.5)) / vec2(4.0, 2.0);
      vec4 m = texture(uMoon, vec2(muv.x, 1.0 - muv.y));
      col += toLinear(m.rgb) * m.a * 2.2 * smoothstep(-0.05, 0.08, md.y);
    }
    float night = 1.0 - smoothstep(-0.12, 0.02, uSunDir.y);
    col += stars(rd) * night * sat(rd.y * 4.0);
    col = voidSky(col, rd);
    // (the dark under the horizon below the horizon height is not the sky's colour: not brightened)
    if (rd.y < 0.0 && 4.0 / max(-rd.y, 1e-4) * length(rd.xz) < 512.0) skyW = 1.0 - uVoid.x * (1.0 - voidFog(rd, 4.0));
    if (cloud) col = col * base.a + base.rgb;
  }
  // clouds, in front of the sky and anything beyond them
  vec4 cl = texture(uClouds, vUv);
  // (near the bottom of the world they go into the void's black fog with the sky, as the game fogs its clouds)
  if (!water) col = col * cl.a + cl.rgb * (1.0 - uVoid.y * (rd.y > 0.0313 ? voidFog(rd, 16.0) : 1.0));
  if (water) {
    // under water: the water closes in, losing red first
    vec3 absorb = -0.15 * log(max(uWaterTint, vec3(0.02))) + 0.03;
    vec3 Tr = exp(-(absorb + 0.025) * min(dist, 96.0));
    vec3 amb = texelFetch(uAmbient, ivec2(0, 0), 0).rgb / PI;
    vec3 sc = (amb * 0.6 + texelFetch(uAmbient, ivec2(3, 0), 0).rgb * 0.25 / PI) * uWaterTint * uSkyAtEye * 0.9;
    col = col * Tr + sc * (1.0 - Tr);
  } else if (d < 1.0 && !cloud) {
    // height fog, in the colour of the sky behind it
    float h0 = uCamPos.y - 63.0;
    float k = 1.0 / 60.0;
    float dy = rd.y * dist;
    float od = 0.0019 * uFogMul * exp(-h0 * k) * (abs(dy) > 0.01 ? (1.0 - exp(-dy * k)) / (dy * k) : 1.0) * dist;
    vec3 fogC = skyRadiance(normalize(vec3(rd.x, max(rd.y, 0.02), rd.z))) * (1.0 - uVoid.y);
    float T = exp(-od);
    col = col * T + fogC * (1.0 - T) * uSkyAtEye;
    // the edge of the loaded world melts into the horizon
    float hd = length((wp - uCamPos).xz);
    float edge = smoothstep(uRender * 0.72, uRender, hd);
    skyW = mix((1.0 - T) * uSkyAtEye, 1.0, edge);
    col = mix(col, skyRadiance(normalize(vec3(rd.x, max(rd.y, 0.0), rd.z))) * (1.0 - uVoid.y), edge);
  }
  // the light shafts' haze: none in the void's black fog near the bottom of the world, nor over the
  // dark under the horizon below sea level (the air there is out past the shadow map, all of it sunlit,
  // so it lit the void up a hazy white and brown where the game shows black)
  vec3 vl = texture(uVL, vUv).rgb * (1.0 - uVoid.y);
  if (d >= 1.0 && rd.y < 0.0) vl *= 1.0 - uVoid.x;
  col += vl;
  float sh = shutAt(dist, d);
  col *= 1.0 - sh;
  // (lava, marked 2 by water.js, marked 0 here: the eye does not adapt to it; nor to the black of Blindness and Darkness;
  // what the eye measures has 1 and the sky's share over it, FS_LUM counting it all the same)
  o = vec4(col, base.a > 1.5 || sh > 0.5 ? 0.0 : 1.0 + (water ? 0.0 : skyW));
}`;

/* ---- bloom ---- */
const FS_DOWN = /* glsl */`
uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uFirst;
in vec2 vUv; out vec4 o;
vec3 s(vec2 off) { return texture(uSrc, vUv + off * uTexel).rgb; }
vec3 karis(vec3 c) { return c / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722))); }
void main() {
  vec3 a = s(vec2(-2, -2)), b = s(vec2(0, -2)), c = s(vec2(2, -2));
  vec3 d = s(vec2(-1, -1)), e = s(vec2(1, -1));
  vec3 f = s(vec2(-2, 0)), g = s(vec2(0, 0)), h = s(vec2(2, 0));
  vec3 i = s(vec2(-1, 1)), j = s(vec2(1, 1));
  vec3 k = s(vec2(-2, 2)), l = s(vec2(0, 2)), m = s(vec2(2, 2));
  vec3 r;
  vec3 g0 = (d + e + i + j) * 0.25, g1 = (a + b + f + g) * 0.25, g2 = (b + c + g + h) * 0.25;
  vec3 g3 = (f + g + k + l) * 0.25, g4 = (g + h + l + m) * 0.25;
  if (uFirst > 0.5) {
    // weighted by brightness, so one blazing pixel cannot flicker the whole glow
    float w0 = 0.5 / (1.0 + dot(g0, vec3(0.2126, 0.7152, 0.0722)));
    float w1 = 0.125 / (1.0 + dot(g1, vec3(0.2126, 0.7152, 0.0722)));
    float w2 = 0.125 / (1.0 + dot(g2, vec3(0.2126, 0.7152, 0.0722)));
    float w3 = 0.125 / (1.0 + dot(g3, vec3(0.2126, 0.7152, 0.0722)));
    float w4 = 0.125 / (1.0 + dot(g4, vec3(0.2126, 0.7152, 0.0722)));
    r = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  } else {
    r = g0 * 0.5 + (g1 + g2 + g3 + g4) * 0.125;
  }
  o = vec4(r, 1.0);
}`;
const FS_UP = /* glsl */`
uniform sampler2D uSrc, uBase; uniform vec2 uTexel; uniform float uMix;
in vec2 vUv; out vec4 o;
void main() {
  vec3 s = texture(uSrc, vUv + uTexel * vec2(-1, -1)).rgb + texture(uSrc, vUv + uTexel * vec2(1, -1)).rgb
         + texture(uSrc, vUv + uTexel * vec2(-1, 1)).rgb + texture(uSrc, vUv + uTexel * vec2(1, 1)).rgb
         + 2.0 * (texture(uSrc, vUv + uTexel * vec2(0, -1)).rgb + texture(uSrc, vUv + uTexel * vec2(0, 1)).rgb
                + texture(uSrc, vUv + uTexel * vec2(-1, 0)).rgb + texture(uSrc, vUv + uTexel * vec2(1, 0)).rgb)
         + 4.0 * texture(uSrc, vUv).rgb;
  o = vec4(texture(uBase, vUv).rgb + s / 16.0 * uMix, 1.0);
}`;

/* ---- exposure ---- */
const FS_LUM = /* glsl */`
uniform sampler2D uSrc; in vec2 vUv; out vec4 o;
void main() {
  float l = 0.0, n = 0.0;
  for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++) {
    vec4 c = texture(uSrc, vUv + (vec2(i, j) - 1.5) / vec2(256.0, 144.0));
    // (lava is left out: it is drawn as its own colour whatever the eye does: water.js)
    float k = step(0.5, c.a);
    l += log2(max(dot(c.rgb, vec3(0.2126, 0.7152, 0.0722)), 1e-5)) * k; n += k;
  }
  // the middle of the screen counts for more
  float w = 1.0 - 0.6 * length(vUv - 0.5);
  o = vec4(l / 16.0 * w, n / 16.0 * w, 0.0, 1.0);
}`;
/* The eye opens to what the light pipeline (Low and Medium) would show: the
   sky's own light under the sky (sky.js, its seventh texel), one level in a
   cave or under a roof (eased over, uCave) and in the Nether and the End
   (glsl.js EXPOSURE, which already has the Shader Options' exposure in it).
   What is in front of you only nudges that, a little under half the way and
   never more than about a stop either way. It used to follow the screen's
   own brightness from a fortieth to five and a half times: a patch of sky
   in view darkened the land to black, the ground in view blew the sky out
   to white, and a cave lit by one torch swung between the two. */
const FS_EXPO = /* glsl */`
uniform sampler2D uLum, uPrev, uAmbient; uniform float uDt, uCave, uExposure, uDim;
in vec2 vUv; out vec4 o;
void main() {
  vec4 s = textureLod(uLum, vec2(0.5), 10.0);
  float avg = exp2(s.x / max(s.y, 1e-4));
  float sky = texelFetch(uAmbient, ivec2(6, 0), 0).r;
  float base = uDim > 0.5 ? uExposure : uCave > 0.0 ? exp(mix(log(max(sky, 1e-4)), log(uExposure), uCave)) : sky;
  float seen = 0.115 / max(avg, 1e-5);
  // (less in the Nether and the End, whose light is one level everywhere; and never opening past where
  // the sky table stops at night, so night stays night and a dark cave stays dark; closing a fifth at
  // most, so a snowfield or a desert in the sun stays as bright as the game's, not a grey two thirds)
  float target = base * clamp(pow(seen / base, 0.4), uDim > 0.5 ? 0.75 : 0.8, uDim > 0.5 ? 1.3 : 1.9);
  target = min(target, max(base, 4.5));
  float prev = texture(uPrev, vec2(0.5)).r;
  if (prev <= 0.0) prev = target;
  // brighter quickly, darker slowly, the way eyes go
  float speed = target > prev ? 1.6 : 0.9;
  float e = exp(mix(log(prev), log(target), 1.0 - exp(-uDt * speed)));
  o = vec4(e, 0.0, 0.0, 1.0);
}`;

/* ---- final ---- */
const FS_FINAL = COMMON + TONEMAP + /* glsl */`
uniform sampler2D uColor, uBloom, uExpo;
uniform float uEyeInWater, uTime, uBloomMix;
uniform float uSat, uContrast;  // Shader Options: Saturation and Contrast
uniform float uCurve;           // and Tone Mapping: 0 AgX, 1 ACES, 2 Reinhard (glsl.js toneCurve)
uniform float uSkyGain;         // the day sky brightened by this much more (Post.frame)
in vec2 vUv; out vec4 o;
void main() {
  vec2 uv = vUv;
  if (uEyeInWater > 0.5) uv += vec2(sin(uv.y * 24.0 + uTime * 2.1), cos(uv.x * 19.0 + uTime * 1.7)) * 0.0018;
  vec4 cc = texture(uColor, uv);
  vec3 c = cc.rgb;
  vec3 b = texture(uBloom, uv).rgb;
  float e = texture(uExpo, vec2(0.5)).r;
  c = mix(c, b / 6.0, uBloomMix);
  /* the day sky (and the fog and haze that are its colour) brighter than the eye has it, towards the
     game's light blue: by the eye set for the land the sky came out a dull grey blue, half as bright
     as the game's at noon. Left out of what the eye measures, so the land stays as it was */
  float skyK = uSkyGain * sat(cc.a - 1.0);
  c *= e * (1.0 + skyK);
  // a soft vignette, kinder to bright pixels
  vec2 q = uv - 0.5;
  c *= 1.0 - dot(q, q) * 0.38 * (1.0 - sat(lum(c)));
  if (uCurve < 0.5) c = agx(c);
  else if (uCurve < 1.5) { c *= 0.78; c = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0); }
  else { c *= 1.35; c = min(vec3(1.0), c * (1.0 + c / 64.0) / (1.0 + c)); }
  float l = lum(c);
  // (and the sky itself a little bluer, as the game's is: the tone curve greys a bright blue; not the land in the fog)
  c = max(vec3(0.0), l + (c - l) * uSat * (1.0 + uSkyGain * smoothstep(1.9, 2.0, cc.a) * 0.25));
  c = toSRGB(c);
  c = clamp((c - 0.5) * uContrast + 0.5, 0.0, 1.0);
  o = vec4(c, lum(c));
}`;
const FS_FXAA = /* glsl */`
uniform sampler2D uSrc; uniform vec2 uTexel;
in vec2 vUv; out vec4 o;
void main() {
  // FXAA 3.11 (quality preset 12-ish), on the luma in alpha
  vec4 c = texture(uSrc, vUv);
  float lM = c.a;
  float lN = texture(uSrc, vUv + vec2(0, uTexel.y)).a, lS = texture(uSrc, vUv - vec2(0, uTexel.y)).a;
  float lE = texture(uSrc, vUv + vec2(uTexel.x, 0)).a, lW = texture(uSrc, vUv - vec2(uTexel.x, 0)).a;
  float lMin = min(lM, min(min(lN, lS), min(lE, lW))), lMax = max(lM, max(max(lN, lS), max(lE, lW)));
  float range = lMax - lMin;
  if (range < max(0.0312, lMax * 0.125)) { o = vec4(c.rgb, 1.0); return; }
  float lNW = texture(uSrc, vUv + vec2(-uTexel.x, uTexel.y)).a, lNE = texture(uSrc, vUv + uTexel).a;
  float lSW = texture(uSrc, vUv - uTexel).a, lSE = texture(uSrc, vUv + vec2(uTexel.x, -uTexel.y)).a;
  float edgeH = abs(lNW + lNE - 2.0 * lN) + 2.0 * abs(lW + lE - 2.0 * lM) + abs(lSW + lSE - 2.0 * lS);
  float edgeV = abs(lNW + lSW - 2.0 * lW) + 2.0 * abs(lN + lS - 2.0 * lM) + abs(lNE + lSE - 2.0 * lE);
  bool horz = edgeH >= edgeV;
  float l1 = horz ? lS : lW, l2 = horz ? lN : lE;
  float g1 = abs(l1 - lM), g2 = abs(l2 - lM);
  float stepL = horz ? uTexel.y : uTexel.x;
  float lAvg;
  if (g1 >= g2) { stepL = -stepL; lAvg = 0.5 * (l1 + lM); } else lAvg = 0.5 * (l2 + lM);
  float gScaled = max(g1, g2) * 0.25;
  vec2 cur = vUv; if (horz) cur.y += stepL * 0.5; else cur.x += stepL * 0.5;
  vec2 off = horz ? vec2(uTexel.x, 0.0) : vec2(0.0, uTexel.y);
  vec2 u1 = cur - off, u2 = cur + off;
  float e1 = texture(uSrc, u1).a - lAvg, e2 = texture(uSrc, u2).a - lAvg;
  bool r1 = abs(e1) >= gScaled, r2 = abs(e2) >= gScaled;
  for (int i = 0; i < 10; i++) {
    if (r1 && r2) break;
    float q = i < 2 ? 1.0 : i < 5 ? 1.5 : i < 8 ? 2.0 : 4.0;
    if (!r1) { u1 -= off * q; e1 = textureLod(uSrc, u1, 0.0).a - lAvg; r1 = abs(e1) >= gScaled; }
    if (!r2) { u2 += off * q; e2 = textureLod(uSrc, u2, 0.0).a - lAvg; r2 = abs(e2) >= gScaled; }
  }
  float d1 = horz ? vUv.x - u1.x : vUv.y - u1.y, d2 = horz ? u2.x - vUv.x : u2.y - vUv.y;
  bool closer1 = d1 < d2;
  float dmin = min(d1, d2);
  bool smaller = lM < lAvg;
  bool ok = ((closer1 ? e1 : e2) < 0.0) != smaller;
  float px = ok ? -dmin / (d1 + d2) + 0.5 : 0.0;
  float sub = clamp(abs((2.0 * (lN + lS + lE + lW) + lNW + lNE + lSW + lSE) / 12.0 - lM) / range, 0.0, 1.0);
  float sub2 = (-2.0 * sub + 3.0) * sub * sub;
  px = max(px, sub2 * sub2 * 0.75);
  vec2 fuv = vUv; if (horz) fuv.y += px * stepL; else fuv.x += px * stepL;
  o = vec4(texture(uSrc, fuv).rgb, 1.0);
}`;

export class Post {
  constructor(renderer, shared, opts) {
    this.r = renderer;
    this.fs = new FullScreen(null);
    this.shared = shared;
    this.opts = opts;
    this.u = {
      uSrc: { value: null }, uBase: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 }, uMix: { value: 1 },
      uColor: { value: null }, uDepth: { value: null }, uVL: { value: null }, uClouds: { value: null }, uBloom: { value: null },
      uExpo: { value: null }, uLum: { value: null }, uPrev: { value: null }, uHistory: { value: null },
      uInvViewProj: { value: new THREE.Matrix4() }, uPrevViewProj: { value: new THREE.Matrix4() },
      uDt: { value: 0.016 }, uBias: { value: 1 }, uBloomMix: { value: 0.045 }, uSkyGain: { value: 0 },
      // the Shader Options' exposure (in stops, as a factor), saturation and contrast
      uEV: { value: 1 }, uSat: { value: 1 }, uContrast: { value: 1 }, uCurve: { value: 0 },
      // Light Shafts: Low or High (render/looks.js)
      uVLK: { value: 1 },
      // this frame's view and projection, for RIP Computer's puddles (FS_COMP puddleLook)
      uVPNow: { value: new THREE.Matrix4() },
    };
    const U = Object.assign({}, shared, this.u);
    // the same objects, so a value set here is seen by every pass
    for (const k in this.u) U[k] = this.u[k];
    this.U = U;
    this.mCopy = mat(FS_COPY, U);
    this.mLin = mat(FS_LINDEPTH, U);
    const Q = { VL_STEPS: opts.vlSteps || 14, CLOUD_STEPS: opts.cloudSteps || 20 };
    this.bloom = opts.bloom !== false;
    this.fxaa = opts.fxaa !== false;
    this.halfClouds = !!opts.halfClouds;      // edge smoothing as the last pass, or the tone-mapped picture straight to the screen    // the soft glow round bright things: eleven passes, left out where speed matters more
    // (each its own copy of the steps: one changing must not change the other's behind three.js's back)
    this.mVL = mat(FS_VL, U, { defines: Object.assign({}, Q) });
    this.mClouds = mat(FS_CLOUDS, U, { defines: Object.assign({}, Q) });
    this.mComp = mat(FS_COMP, U);
    this.mDown = mat(FS_DOWN, U);
    this.mUp = mat(FS_UP, U);
    this.mLum = mat(FS_LUM, U);
    this.mExpo = mat(FS_EXPO, U);
    this.mFinal = mat(FS_FINAL, U);
    this.mFxaa = mat(FS_FXAA, U);
    this.expo = [floatTarget(1, 1), floatTarget(1, 1)];
    this.expoI = 0;
    this.lum = floatTarget(64, 64, { minFilter: THREE.LinearMipmapLinearFilter, generateMipmaps: true });
    this.lum.texture.generateMipmaps = true;
    this.cloudHist = 0;
    this.cloudsOn = true; this.vlOn = true; this.bloomMix = 0.045;
    this.snap = 4;
    this.configure(opts);
  }
  /* The eye set straight to the picture, not eased over from where it was
     (the last time this chain was in use, or nothing at all): for the first
     few measurements after the chain is turned on, or the first frames had
     the screen flash white or black for a second while it caught up. */
  resetExposure() { this.snap = 4; }
  /* The Shader Options this chain has (render/looks.js): bloom and how strong,
     light shafts and how many steps, edge smoothing, exposure, saturation,
     contrast. A pass that is off is not run at all; its picture is cleared
     once so the composite reads nothing from it. */
  configure(o) {
    this.bloom = o.bloom !== false;
    this.bloomMix = o.bloomMix || 0.045;
    this.fxaa = !!o.fxaa;
    const vl = o.vlSteps === undefined ? 14 : o.vlSteps;
    this.vlOn = vl > 0;
    if (vl > 0 && this.mVL.defines.VL_STEPS !== vl) { this.mVL.defines.VL_STEPS = vl; this.mVL.needsUpdate = true; }
    const cs = o.cloudSteps || 20;
    if (this.mClouds.defines.CLOUD_STEPS !== cs) { this.mClouds.defines.CLOUD_STEPS = cs; this.mClouds.needsUpdate = true; }
    this.u.uVLK.value = o.vlStrength || 1;
    this.u.uEV.value = Math.pow(2, o.exposure || 0);
    this.u.uSat.value = o.saturation === undefined ? 1 : o.saturation;
    this.u.uContrast.value = o.contrast || 1;
    this.u.uCurve.value = TONE_CURVES[o.tone] || 0;
    this.cleared = false;
  }
  /* What a new look will draw this chain with that it has not got yet, for
     render/looks.js to have built in the background: the light shafts' and
     the clouds' passes with their new numbers of steps (configure() changes
     them only when the look lands, and three.js would otherwise build them at
     their first draw). */
  variants(o) {
    const out = [];
    const vl = o.vlSteps === undefined ? 14 : o.vlSteps;
    if (vl > 0 && this.mVL.defines.VL_STEPS !== vl) out.push(mat(FS_VL, this.U, { defines: Object.assign({}, this.mVL.defines, { VL_STEPS: vl }) }));
    const cs = o.cloudSteps || 20;
    if (this.mClouds.defines.CLOUD_STEPS !== cs) out.push(mat(FS_CLOUDS, this.U, { defines: Object.assign({}, this.mClouds.defines, { CLOUD_STEPS: cs }) }));
    return out;
  }
  // the pictures given back while another look is in use (made again by the next resize)
  release() {
    if (!this.w) return;
    [this.copyColor, this.linDepth, this.vl, this.comp, this.ldr, ...(this.clouds || []), ...(this.down || []), ...(this.up || [])].forEach(t => t && t.dispose());
    this.copyColor = this.linDepth = this.vl = this.comp = this.ldr = null;
    this.clouds = this.down = this.up = null;
    this.w = this.h = 0;
  }
  clearTo(t, a) { const r = this.r; r.setRenderTarget(t); r.setClearColor(0x000000, a); r.clear(true, false, false); }
  resize(w, h) {
    this.w = w; this.h = h;
    this.cleared = false;
    const dispose = t => t && t.dispose();
    [this.copyColor, this.linDepth, this.vl, this.comp, this.ldr, ...(this.clouds || []), ...(this.down || []), ...(this.up || [])].forEach(dispose);
    this.copyColor = floatTarget(w, h);
    this.linDepth = floatTarget(w, h, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.vl = floatTarget(Math.ceil(w / 2), Math.ceil(h / 2));
    this.clouds = [floatTarget(Math.ceil(w / 2), Math.ceil(h / 2)), floatTarget(Math.ceil(w / 2), Math.ceil(h / 2))];
    this.comp = floatTarget(w, h);
    this.ldr = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.down = []; this.up = [];
    let bw = w, bh = h;
    for (let i = 0; i < 6; i++) {
      bw = Math.max(1, Math.ceil(bw / 2)); bh = Math.max(1, Math.ceil(bh / 2));
      this.down.push(floatTarget(bw, bh));
      this.up.push(floatTarget(bw, bh));
    }
  }
  run(m, target) { this.fs.material = m; this.fs.render(this.r, target); }
  // the opaque scene's colour and linear depth, for the water to look through
  copies(main) {
    this.u.uSrc.value = main.texture; this.run(this.mCopy, this.copyColor);
    this.u.uDepth.value = main.depthTexture; this.run(this.mLin, this.linDepth);
  }
  frame(main, camera, dt) {
    const u = this.u;
    u.uInvViewProj.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
    u.uDepth.value = main.depthTexture;
    // the eye adjusts slowly: measuring the brightness every other frame is plenty
    this.expoDt = (this.expoDt || 0) + dt;
    u.uDt.value = this.expoDt;
    // light shafts
    const other = this.shared.uDim && this.shared.uDim.value > 0;    // the Nether and the End: no shafts, no clouds
    // a pass switched off: its picture cleared once (nothing to add, nothing in front of the sky)
    if (!this.cleared) { this.cleared = true; this.clearTo(this.vl, 1); for (const t of this.clouds) this.clearTo(t, 1); this.r.setClearColor(0x000000, 1); }
    if (!this.vlOn || other) { if (this.vlWas !== false) { this.clearTo(this.vl, 1); this.vlWas = false; } }
    else { this.vlWas = true; if (!this.halfClouds || ((this.cloudTick || 0) & 1)) this.run(this.mVL, this.vl); }   // light rays: on the faster setting, the frames the clouds skip
    // clouds, over the last frame's
    // they blend into the last frame's anyway: on the faster setting they are worked out every other frame
    this.cloudTick = (this.cloudTick || 0) + 1;
    if (!this.cloudsOn || other) { if (this.cloudsWas !== false) { for (const t of this.clouds) this.clearTo(t, 1); this.cloudsWas = false; } }
    else if (!this.halfClouds || (this.cloudTick & 1)) {
      this.cloudsWas = true;
      const ci = this.cloudHist;
      u.uHistory.value = this.clouds[ci].texture;
      this.run(this.mClouds, this.clouds[1 - ci]);
      this.cloudHist = 1 - ci;
    }
    u.uPrevViewProj.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    u.uVPNow.value.copy(u.uPrevViewProj.value);
    // the composite
    u.uColor.value = main.texture; u.uVL.value = this.vl.texture; u.uClouds.value = this.clouds[this.cloudHist].texture;
    this.run(this.mComp, this.comp);
    // (RIP Computer's soft smoke goes in here, over the sky and lit like the rest: render/smoke.js)
    if (this.afterComp) this.afterComp(this.comp, main, camera);
    // bloom: down, then back up
    let src = this.comp.texture, sw = this.w, sh = this.h;
    let upSrc = this.comp.texture;
    u.uBloomMix.value = this.bloom ? this.bloomMix : 0;
    if (this.bloom) {
    for (let i = 0; i < this.down.length; i++) {
      u.uSrc.value = src; u.uTexel.value.set(1 / sw, 1 / sh); u.uFirst.value = i === 0 ? 1 : 0;
      this.run(this.mDown, this.down[i]);
      src = this.down[i].texture; sw = this.down[i].width; sh = this.down[i].height;
    }
    upSrc = this.down[this.down.length - 1].texture;
    for (let i = this.down.length - 2; i >= 0; i--) {
      const big = this.down[i + 1];
      u.uSrc.value = upSrc; u.uBase.value = this.down[i].texture; u.uTexel.value.set(1 / big.width, 1 / big.height); u.uMix.value = 1.0;
      this.run(this.mUp, this.up[i]);
      upSrc = this.up[i].texture;
    }
    }
    // how bright it all is, and the eye adjusting to it
    this.expoTick = (this.expoTick || 0) + 1;
    if (!this.halfClouds || (this.expoTick & 1)) {
      u.uSrc.value = this.comp.texture; this.run(this.mLum, this.lum);
      // (nothing to ease from: the exposure jumps to what this frame wants)
      if (this.snap > 0) { this.snap--; this.clearTo(this.expo[this.expoI], 0); this.r.setClearColor(0x000000, 1); }
      u.uLum.value = this.lum.texture; u.uPrev.value = this.expo[this.expoI].texture;
      this.run(this.mExpo, this.expo[1 - this.expoI]);
      this.expoI = 1 - this.expoI;
      this.expoDt = 0;
    }
    // tone map, then smooth the edges onto the screen
    u.uColor.value = this.comp.texture; u.uBloom.value = upSrc; u.uExpo.value = this.expo[this.expoI].texture;
    // the day sky's brightening (FS_FINAL): full with the sun well up, none from late afternoon on, at night or in the other dimensions
    // (and none in rain or a storm, whose sky the game greys: sim/weather.js sets the renderer's weatherState)
    const sd = this.shared.uSunDir && this.shared.uSunDir.value, sy = sd ? sd.y : 0, k = Math.max(0, Math.min(1, (sy - 0.15) / 0.35));
    const wx = (this.owner && this.owner.weatherState) || {}, wet = Math.min(1, (wx.rain || 0) + (wx.thunder || 0));
    u.uSkyGain.value = other ? 0 : SKY_GAIN * k * k * (3 - 2 * k) * (1 - wet);
    // (and for the next frame's lava: water.js)
    if (this.shared.uExpoTex) this.shared.uExpoTex.value = this.expo[this.expoI].texture;
    this.run(this.mFinal, this.fxaa ? this.ldr : null);
    if (!this.fxaa) return;
    u.uSrc.value = this.ldr.texture; u.uTexel.value.set(1 / this.w, 1 / this.h);
    this.run(this.mFxaa, null);
  }
}
