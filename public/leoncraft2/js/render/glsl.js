/* ---------------------------------------------------------------------------
   Leoncraft 2 - shared GLSL.

   The pieces every shader leans on: noise, the shadow map lookup (with the
   same "fisheye" distortion the shadow pass uses, as in the BSL / Photon
   shader packs), the atmosphere model (Hillaire 2020: Rayleigh, Mie and
   ozone, with transmittance and multiple-scattering lookup tables), wind,
   water waves and tone mapping.
--------------------------------------------------------------------------- */

export const COMMON = /* glsl */`
#define PI 3.14159265
#define TAU 6.2831853
float sat(float x) { return clamp(x, 0.0, 1.0); }
vec3 sat3(vec3 x) { return clamp(x, 0.0, 1.0); }
float sqr(float x) { return x * x; }
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 toLinear(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
float linstep(float a, float b, float x) { return sat((x - a) / (b - a)); }
// interleaved gradient noise (Jimenez 2014): a cheap, even per-pixel dither
float ign(vec2 p, float frame) {
  p += 5.588238 * mod(frame, 64.0);
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
// the face normals and texture axes the mesher uses (0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z)
vec3 faceN(int i) {
  if (i == 0) return vec3(1, 0, 0); if (i == 1) return vec3(-1, 0, 0);
  if (i == 2) return vec3(0, 1, 0); if (i == 3) return vec3(0, -1, 0);
  if (i == 4) return vec3(0, 0, 1); return vec3(0, 0, -1);
}
vec3 faceT(int i) {
  if (i == 0) return vec3(0, 0, -1); if (i == 1) return vec3(0, 0, 1);
  if (i == 5) return vec3(-1, 0, 0); return vec3(1, 0, 0);
}
vec3 faceB(int i) {
  if (i == 2) return vec3(0, 0, 1); if (i == 3) return vec3(0, 0, -1);
  return vec3(0, -1, 0);
}
// Brightness (Video Settings) less its default, 0.5: the least light anything gets, lowered towards
// none (Moody) or raised so the darkest caves can be made out (Bright), as the game's own setting does
#ifndef NV_LIGHT
#define NV_LIGHT 0.6
#endif
uniform float uBrightD;
// Night Vision (0..1, flickering at its end): everything lit at least as a dull day lights it (Off's lightmap takes #999999)
uniform float uNightVision;
vec3 lightFloor() { return vec3(0.0035, 0.004, 0.006) * (1.0 + 2.0 * min(uBrightD, 0.0)) + vec3(0.03, 0.032, 0.036) * 2.0 * max(uBrightD, 0.0) + vec3(NV_LIGHT) * uNightVision; }
`;

/* ---- Texture Filtering (Video Settings) ----------------------------------
   RGSS: four samples on a rotated grid across the part of the texture the
   pixel covers, each at the level of detail of a quarter of it, averaged.
   Without RGSS defined it is the one ordinary sample. */
export const FILTER = /* glsl */`
uniform float uChunkFade;      // a column fading in: 0 just arrived, 1 there (Chunk Fade)
vec4 texFiltered(sampler2DArray s, vec3 p) {
#ifdef RGSS
  vec2 dx = dFdx(p.xy), dy = dFdy(p.xy), hx = dx * 0.5, hy = dy * 0.5;
  return (textureGrad(s, vec3(p.xy + dx * 0.125 + dy * 0.375, p.z), hx, hy)
        + textureGrad(s, vec3(p.xy + dx * 0.375 - dy * 0.125, p.z), hx, hy)
        + textureGrad(s, vec3(p.xy - dx * 0.125 - dy * 0.375, p.z), hx, hy)
        + textureGrad(s, vec3(p.xy - dx * 0.375 + dy * 0.125, p.z), hx, hy)) * 0.25;
#else
  return texture(s, p);
#endif
}
`;

/* ---- the sun's shadow map ------------------------------------------------ */
export const SHADOW = /* glsl */`
uniform sampler2DShadow uShadow;
uniform mat4 uShadowMat;      // world -> shadow clip (orthographic, an even grid pinned to the world: render/shadows.js)
uniform float uShadowRes;
uniform float uShadowSoft;    // how far apart the soft shadow's taps are, in texels
// where you stand in the map (xy, its clip space), the map's reach over the shadow distance (z)
// and a texel's size in blocks (w)
uniform vec4 uShadowEye;
// how far a texel of the map is nudged off its own surface: a texel or two, more the more
// the face turns from the light (the map's texels are the same size everywhere)
vec3 shadowNudge(vec3 n, float NoL) { return n * uShadowEye.w * (0.6 + 1.4 * (1.0 - sat(NoL))); }
// where a world point lands in the shadow map, nudged off its own surface
vec3 shadowCoord(vec3 world, vec3 n, float NoL, float dist) {
  world += shadowNudge(n, NoL);
  vec4 c = uShadowMat * vec4(world, 1.0);
  c.z *= 0.2;
  return c.xyz * 0.5 + 0.5;
}
// how far a point is from you in the map, in shadow distances (1 is as far as the shadows reach)
float shadowReach(vec2 clipXY) { return length(clipXY - uShadowEye.xy) * uShadowEye.z; }
// past the shadow distance, the light level's guess takes over: by distance from you, so the
// fade moves with you and never jumps when the map moves on
float shadowFade(vec3 sc) { return linstep(0.82, 1.0, shadowReach(sc.xy * 2.0 - 1.0)); }
// soft shadows from hardware-filtered taps (each blends four texels) in a fixed pattern, so the
// edge is soft and never shimmers from frame to frame: four in a square, or (SHADOW_TAPS 8 or
// 16, the full looks) a Vogel disc. The noise argument is no longer used.
#ifndef SHADOW_TAPS
#define SHADOW_TAPS 4
#endif
float shadowSoft(vec3 sc, float noise, float radius) {
  if (sc.x <= 0.0 || sc.x >= 1.0 || sc.y <= 0.0 || sc.y >= 1.0 || sc.z >= 1.0) return 1.0;
  float bias = 0.00004, z = sc.z - bias;
#if SHADOW_TAPS > 4
  float s = 0.0;
  for (int i = 0; i < SHADOW_TAPS; i++) {
    float r = sqrt((float(i) + 0.5) / float(SHADOW_TAPS)) * radius * 0.9;
    float a = float(i) * 2.39996;
    s += textureLod(uShadow, vec3(sc.xy + vec2(cos(a), sin(a)) * r / uShadowRes, z), 0.0);
  }
  return s / float(SHADOW_TAPS);
#else
  vec2 o = vec2(0.5 * radius / uShadowRes);
  float s = textureLod(uShadow, vec3(sc.xy + vec2(-o.x, -o.y), z), 0.0)
          + textureLod(uShadow, vec3(sc.xy + vec2(o.x, -o.y), z), 0.0)
          + textureLod(uShadow, vec3(sc.xy + vec2(-o.x, o.y), z), 0.0)
          + textureLod(uShadow, vec3(sc.xy + vec2(o.x, o.y), z), 0.0);
  return s * 0.25;
#endif
}
float shadowHard(vec3 sc) {
  if (sc.x <= 0.0 || sc.x >= 1.0 || sc.y <= 0.0 || sc.y >= 1.0 || sc.z >= 1.0) return 1.0;
  return textureLod(uShadow, vec3(sc.xy, sc.z - 0.00004), 0.0);
}
`;

/* ---- the atmosphere ------------------------------------------------------ */
export const ATMOS = /* glsl */`
// kilometres; the player stands about 200 m up
const float RG = 6360.0, RT = 6460.0;
const vec3 RAY_S = vec3(5.802, 13.558, 33.1) * 1e-3;
const float MIE_S = 3.996e-3, MIE_E = 4.40e-3;
const vec3 OZONE_A = vec3(0.650, 1.881, 0.085) * 1e-3;
const float MIE_G = 0.8;
struct Medium { vec3 scatR; float scatM; vec3 ext; };
Medium medium(float h) {
  float r = exp(-h / 8.0), m = exp(-h / 1.2), o = max(0.0, 1.0 - abs(h - 25.0) / 15.0);
  Medium M;
  M.scatR = RAY_S * r; M.scatM = MIE_S * m;
  M.ext = M.scatR + MIE_E * m + OZONE_A * o;
  return M;
}
float raySphere(vec3 ro, vec3 rd, float R) {
  float b = dot(ro, rd), c = dot(ro, ro) - R * R, d = b * b - c;
  if (d < 0.0) return -1.0;
  d = sqrt(d);
  float t0 = -b - d, t1 = -b + d;
  return t0 > 0.0 ? t0 : t1;
}
float phaseRay(float c) { return 3.0 / (16.0 * PI) * (1.0 + c * c); }
float phaseHG(float c, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
// the transmittance table: height across, sun angle (cos) down
vec2 transUV(float h, float mu) { return vec2(mu * 0.5 + 0.5, sqrt(sat(h / (RT - RG)))); }
`;

/* ---- wind, and plants leaning away from where you walked ------------------ */
export const WIND = /* glsl */`
uniform float uTime;
uniform sampler2D uInteract;   // r: water height, g: previous, b: trampled grass
uniform vec4 uInteractRect;    // world xz of the map's corner, and its size
uniform vec3 uPlayer;          // the player's feet
uniform vec2 uWave;            // how far plants (x) and leaves (y) move (Shader Options: Waving Plants, Waving Leaves)
float trampleAt(vec2 xz) {
  vec2 uv = (xz - uInteractRect.xy) / uInteractRect.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  return textureLod(uInteract, uv, 0.0).b;
}
vec3 windOffset(vec3 p, int wave, float v, float sky, float rnd) {
#ifdef NO_WIND
  return vec3(0.0);
#else
  if (wave == 0) return vec3(0.0);
  float amp = wave == 2 ? uWave.y : uWave.x;
  if (amp <= 0.0) return vec3(0.0);
  float w;
  if (wave == 1 || wave == 4) w = 1.0 - v;
  else if (wave == 6) w = (1.0 - v) * 0.45;
  else if (wave == 3) w = 0.45 + 0.55 * (1.0 - v);
  else w = 1.0;
  float t = uTime;
  vec2 wd = vec2(0.866, 0.5);
  float strength = sky * sky;
  // a slow gust rolling across the land, and a quick flutter of each plant
  float g = sin(dot(p.xz, wd) * 0.09 - t * 1.3 + sin(p.x * 0.05 + t * 0.3) * 2.0) * 0.5 + 0.5;
  g = g * g * (0.6 + 0.4 * sin(t * 0.4 + p.z * 0.02));
  vec3 q = p * 1.3 + t * vec3(2.1, 2.7, 1.9) + rnd * TAU;
  vec3 flutter = vec3(sin(q.x) + 0.5 * sin(2.1 * q.z + 1.0), sin(q.y * 1.3) * 0.5, sin(q.z) + 0.5 * sin(1.9 * q.x));
  vec3 off;
  if (wave == 2) {
    off = (vec3(wd.x, 0.0, wd.y) * g * 0.07 + flutter * 0.035) * strength;
  } else if (wave == 4) {
    // kelp and seagrass: a slow swell, whatever the sky
    off = vec3(sin(t * 1.1 + p.x * 0.4 + rnd * 6.0), 0.0, cos(t * 0.9 + p.z * 0.4 + rnd * 5.0)) * 0.13 * w;
  } else if (wave == 5) {
    off = vec3(0.0, sin(t * 1.6 + p.x * 0.7 + p.z * 0.9) * 0.012, 0.0);
  } else {
    off = vec3(wd.x, 0.0, wd.y) * g * 0.22 * w * strength + vec3(flutter.x, 0.0, flutter.z) * 0.045 * w * strength;
    // pushed aside where you walk, and slow to stand back up
    float tr = trampleAt(p.xz);
    if (tr > 0.01) {
      float e = 0.35;
      vec2 grad = vec2(trampleAt(p.xz + vec2(e, 0.0)) - trampleAt(p.xz - vec2(e, 0.0)),
                       trampleAt(p.xz + vec2(0.0, e)) - trampleAt(p.xz - vec2(0.0, e)));
      vec2 away = -grad / max(length(grad), 0.05);
      off.xz += away * tr * 0.42 * w;
      off.y -= tr * 0.35 * w;
    }
    // and right where you stand, pushed hard away from your legs
    vec3 tp = p - uPlayer;
    float d = length(tp.xz);
    if (d < 1.0 && tp.y > -0.5 && tp.y < 2.0) off.xz += normalize(tp.xz + 1e-4) * (1.0 - d) * 0.5 * w;
  }
  return off * amp;
#endif
}
`;

/* ---- water waves --------------------------------------------------------- */
export const WAVES = /* glsl */`
// sum of sharpened sine waves, each turned by the golden angle and warped by
// noise so the crests are never ruler straight (after Photon's water)
float waveH(vec2 p, float t, vec2 flow) {
  float h = 0.0, amp = 1.0, wl = 7.0, tot = 0.0;
  float a = 0.52;
  float warp = vnoise(p * 0.18 + t * 0.05) * 2.0;
  bool flowing = dot(flow, flow) > 0.01;
  for (int i = 0; i < 5; i++) {
    vec2 dir = flowing ? normalize(flow) : vec2(cos(a), sin(a));
    float k = TAU / wl;
    float w = sqrt(9.8 * k) * (flowing ? 0.7 : 1.0);
    float x = w * t - k * (dot(dir, p) + warp);
    h += amp * sqr(sin(x) * 0.5 + 0.5);
    tot += amp;
    amp *= 0.55; wl *= 0.62; a += 2.39996;
  }
  return h / tot;
}
vec3 waveNormal(vec2 p, float t, vec2 flow, float strength) {
  float e = 0.05;
  float h0 = waveH(p, t, flow);
  float hx = waveH(p + vec2(e, 0.0), t, flow), hz = waveH(p + vec2(0.0, e), t, flow);
  return normalize(vec3(-(hx - h0) / e * strength, 1.0, -(hz - h0) / e * strength));
}
// value noise and its slope
vec3 vnoiseD(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
  float a = hash12(i), b = hash12(i + vec2(1, 0)), c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
  float k = a - b - c + d;
  return vec3(a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y, du * vec2((b - a) + k * u.y, (c - a) + k * u.x));
}
/* The same waves as waveNormal, their slope worked out with them rather than
   by sampling the sum three times: one pass of five waves instead of
   fifteen. The noise that bends the crests is taken into the slope too.
   Far off only the first few (n): the finest are smaller than a pixel there. */
vec3 waveNormalD(vec2 p, float t, vec2 flow, float strength, int n) {
  float amp = 1.0, wl = 7.0;
  float a = 0.52;
  vec3 wn = vnoiseD(p * 0.18 + t * 0.05);
  float warp = wn.x * 2.0;
  vec2 dwarp = wn.yz * 0.36;
  bool flowing = dot(flow, flow) > 0.01;
  vec2 g = vec2(0.0);
  for (int i = 0; i < 5; i++) {
    if (i >= n) break;
    vec2 dir = flowing ? normalize(flow) : vec2(cos(a), sin(a));
    float k = TAU / wl;
    float w = sqrt(9.8 * k) * (flowing ? 0.7 : 1.0);
    float x = w * t - k * (dot(dir, p) + warp);
    float s = sin(x);
    // the slope of amp * sqr(sin(x) * 0.5 + 0.5)
    g += amp * (s * 0.5 + 0.5) * cos(x) * -k * (dir + dwarp);
    amp *= 0.55; wl *= 0.62; a += 2.39996;
  }
  // over all five waves' heights (1 + 0.55 + 0.55^2 + ...), however many were summed
  g /= 2.1109;
  return normalize(vec3(-g.x * strength, 1.0, -g.y * strength));
}
`;

/* ---- block light, the light in your hand, and the clouds' shadows ---------
   needs uTime (from WIND) and uNoise declared by the host.

   The torch ramp follows Miniature Shader (MIT, Copyright (c) 2022 Mateus A.
   Kreuch, github.com/mateuskreuch/minecraft-miniature-shader): three colours,
   outer to middle with the light level, then a quick turn to the inner one in
   the last light levels. Its colours are taken here into linear light. */
export const LIGHTS = /* glsl */`
#ifndef CLOUD_SHADOW
#define CLOUD_SHADOW 2
#endif
#ifndef CLOUD_Y
#define CLOUD_Y 265.0
#endif
uniform float uHeldLight, uFlicker, uCloudShadow, uCover;
uniform vec3 uHeldPos;
// the light in your hand at p (0..1, like the vertex block light): one less a
// block, as the game spreads it, and a little brighter on what faces it
float heldLight(vec3 p, vec3 n) {
  if (uHeldLight <= 0.0) return 0.0;
  vec3 d = uHeldPos - p;
  float l = length(d);
  return sat((uHeldLight - l) / 15.0) * (0.8 + 0.2 * dot(n, d / max(l, 1e-3)));
}
// block light at level s (0..1): dim and deep orange far out, pale yellow at the
// source, a slow flicker, and washed out by full daylight on open ground
vec3 blockLight(float s, float day) {
  vec3 c = mix(mix(vec3(1.0, 0.27, 0.035), vec3(1.0, 0.6, 0.32), s), vec3(1.0, 0.7, 0.46), max(0.0, s * 8.0 - 7.0));
  float b = pow(s, 5.0) * 2.0 + s * s * 0.1;
  return c * b * 2.2 * uFlicker * (1.0 - 0.6 * day);
}
// how much of the sun gets through the clouds overhead: the same coverage the
// clouds are drawn from (post.js density(), ldrsky.js), one tap or two
float cloudShade(vec3 p, vec3 L) {
#if CLOUD_SHADOW == 0
  return 1.0;
#else
  if (uCloudShadow <= 0.0 || L.y < 0.04) return 1.0;
  vec2 xz = p.xz + L.xz * ((CLOUD_Y - p.y) / L.y);
  vec2 wind = vec2(uTime * 2.2, uTime * 0.9);
#if CLOUD_SHADOW > 1
  float c = textureLod(uNoise, (xz + wind) * 0.00018, 0.0).a * 0.65 + textureLod(uNoise, (xz + wind * 1.3) * 0.0007, 0.0).r * 0.35;
#else
  float c = textureLod(uNoise, (xz + wind) * 0.00018, 0.0).a * 0.65 + 0.17;
#endif
  c = sat((c - (1.0 - uCover)) * 2.6);
#ifndef LDR
  // the marched clouds are eaten away at their thin edges, so their shadows start further in
  c = smoothstep(0.15, 0.6, c);
#endif
  return 1.0 - c * uCloudShadow * smoothstep(0.04, 0.2, L.y);
#endif
}
`;

/* ---- tone mapping -------------------------------------------------------- */
export const TONEMAP = /* glsl */`
// AgX (Troy Sobotka), the base curve fitted by Benjamin Wrensch; keeps hue in bright light
vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x, x4 = x2 * x2;
  return + 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 c) {
  const mat3 inM = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                        0.0784335999999992, 0.878468636469772, 0.0784336,
                        0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const mat3 outM = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                         -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                         -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  const float minEv = -12.47393, maxEv = 4.026069;
  c = inM * c;
  c = clamp(log2(max(c, 1e-10)), minEv, maxEv);
  c = (c - minEv) / (maxEv - minEv);
  c = agxContrast(c);
  // a little punch, the way the shader packs grade
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = l + 1.12 * (c - l);
  c = pow(max(c, 0.0), vec3(1.06));
  c = outM * c;
  return pow(max(c, 0.0), vec3(2.2));   // back to linear for the sRGB step after
}
/* AgX worked backwards: the light agx() turns into this (linear) colour, for
   what must come out of the tone curve as a set colour (lava: water.js). The
   contrast curve rises all the way from 0 to 1, so Newton's method undoes it;
   a colour AgX cannot reach (lava's deepest orange) comes out as near as it gets. */
vec3 agxInverse(vec3 y) {
  const mat3 inM = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                        0.0784335999999992, 0.878468636469772, 0.0784336,
                        0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const mat3 outM = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                         -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                         -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  const float minEv = -12.47393, maxEv = 4.026069;
  vec3 c = inverse(outM) * pow(max(y, 0.0), vec3(1.0 / 2.2));
  c = pow(max(c, 0.0), vec3(1.0 / 1.06));
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = l + (c - l) / 1.12;
  vec3 x = vec3(0.6);
  for (int i = 0; i < 8; i++) {
    vec3 x2 = x * x, x4 = x2 * x2;
    vec3 d = 93.0 * x4 * x - 200.7 * x4 + 127.84 * x2 * x - 20.604 * x2 + 0.8596 * x + 0.1191;
    x = clamp(x - (agxContrast(x) - c) / d, 0.0, 1.0);
  }
  return max(inverse(inM) * exp2(x * (maxEv - minEv) + minEv), 0.0);
}
vec3 toSRGB(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
// Detailed's whole tone curve, exposure already applied: linear light in, the screen's colour out.
// With TONE_LUT, everything after AgX's log step comes from a small table (makeToneLut below):
// one look-up instead of a dozen powers a pixel, never more than two steps of 255 from the curve itself
#ifdef TONE_LUT
uniform highp sampler3D uToneLut;
vec3 toneLDR(vec3 c) {
  const mat3 inM = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                        0.0784335999999992, 0.878468636469772, 0.0784336,
                        0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  vec3 x = (clamp(log2(max(inM * c, 1e-10)), -12.47393, 4.026069) + 12.47393) / 16.499999;
  return textureLod(uToneLut, x * (31.0 / 32.0) + 0.5 / 32.0, 0.0).rgb;
}
#else
vec3 toneLDR(vec3 c) { return toSRGB(agx(c)); }
#endif
`;

/* The table for TONE_LUT: AgX from its log step on (the contrast curve, the
   punch, the way out) and the sRGB step, 32 to a side, filtered. Indexed by
   the log of the colour, as AgX itself works, so the dark end gets as many
   entries as the bright.
   The curve's own output is worked out once per curve and kept: Contrast and
   Saturation (dragged a step at a time in Shader Options) only redo the last
   step, into the same texture when one is given (a few milliseconds, where
   the whole table each step was forty). */
const TONE_N = 32, toneLinear = {};
// the sRGB step as a table, read between its entries (never as much as a two-hundredth of a step of 255 out)
const SRGB_STEPS = 8192;
let srgbT = null;
function srgbTable() {
  if (srgbT) return srgbT;
  srgbT = new Float32Array(SRGB_STEPS + 2);
  for (let n = 0; n <= SRGB_STEPS + 1; n++) { const c = Math.min(1, n / SRGB_STEPS); srgbT[n] = c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }
  return srgbT;
}
function toneCurveTable(curve) {
  const N = TONE_N, out = new Float32Array(N * N * N * 3);
  // the other curves (Shader Options: Tone Mapping) take the colour back out of AgX's log and its inset first
  const minEv = -12.47393, span = 4.026069 + 12.47393;
  const M = [1.19687900512017, -0.0528968517574562, -0.0529716355144438, -0.0980208811401368, 1.15190312990417, -0.0980434501171241, -0.0990297440797205, -0.0989611768448433, 1.15107367264116];
  const contrast = x => { const x2 = x * x, x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; };
  const step = new Float32Array(N), ev = new Float32Array(N);
  for (let n = 0; n < N; n++) { step[n] = contrast(n / (N - 1)); ev[n] = Math.pow(2, n / (N - 1) * span + minEv); }
  let j = 0;
  for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++, j += 3) {
    let x, y, z;
    if (curve === 'agx') {
      const c0 = step[r], c1 = step[g], c2 = step[b];
      const l = 0.2126 * c0 + 0.7152 * c1 + 0.0722 * c2;
      const p0 = Math.pow(Math.max(l + 1.12 * (c0 - l), 0), 1.06), p1 = Math.pow(Math.max(l + 1.12 * (c1 - l), 0), 1.06), p2 = Math.pow(Math.max(l + 1.12 * (c2 - l), 0), 1.06);
      // outM * c, the matrix by columns as GLSL has it
      x = Math.pow(Math.max(M[0] * p0 + M[3] * p1 + M[6] * p2, 0), 2.2);
      y = Math.pow(Math.max(M[1] * p0 + M[4] * p1 + M[7] * p2, 0), 2.2);
      z = Math.pow(Math.max(M[2] * p0 + M[5] * p1 + M[8] * p2, 0), 2.2);
    } else {
      // the scene's own colour: out of the log, then the inset undone (AgX's way out, outM, is exactly the inverse of its way in)
      const v0 = ev[r], v1 = ev[g], v2 = ev[b];
      x = toneCurve(curve, Math.max(0, M[0] * v0 + M[3] * v1 + M[6] * v2));
      y = toneCurve(curve, Math.max(0, M[1] * v0 + M[4] * v1 + M[7] * v2));
      z = toneCurve(curve, Math.max(0, M[2] * v0 + M[5] * v1 + M[8] * v2));
    }
    out[j] = x; out[j + 1] = y; out[j + 2] = z;
  }
  return out;
}
export function makeToneLut(contrastK = 1, saturation = 1, curve = 'agx', into = null) {
  const THREE = window.THREE, N = TONE_N;
  const lin = toneLinear[curve] || (toneLinear[curve] = toneCurveTable(curve));
  const data = into ? into.image.data : new Uint8Array(N * N * N * 4);
  // the Shader Options' saturation (round the colour's own brightness) and contrast (round the middle of the screen's range)
  const S = srgbTable(), K = SRGB_STEPS;
  const put = c => {
    if (c <= 0) c = 0;
    else if (c >= 1) c = 1.055 * Math.pow(c, 1 / 2.4) - 0.055;     // (brighter than white still counts with Contrast under 1)
    else { const f = c * K, n = f | 0; c = S[n] + (S[n + 1] - S[n]) * (f - n); }
    return Math.round(Math.min(1, Math.max(0, (c - 0.5) * contrastK + 0.5)) * 255);
  };
  for (let j = 0, i = 0; j < lin.length; j += 3, i += 4) {
    const r = lin[j], g = lin[j + 1], b = lin[j + 2], ll = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    data[i] = put(ll + (r - ll) * saturation);
    data[i + 1] = put(ll + (g - ll) * saturation);
    data[i + 2] = put(ll + (b - ll) * saturation);
    data[i + 3] = 255;
  }
  if (into) { into.needsUpdate = true; return into; }
  const t = new THREE.Data3DTexture(data, N, N, N);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false; t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

/* The other tone curves, one colour channel at a time, each scaled so a mid
   grey comes out as bright as AgX's (the same exposure suits all three):
   ACES (Narkowicz's fit of the film curve: deeper shadows, richer colour)
   and Reinhard (extended, white at 8: soft, flat and pale in bright light).
   The full chain has the same in GLSL (post.js). */
function toneCurve(curve, x) {
  if (curve === 'aces') { x *= 0.78; return Math.min(1, Math.max(0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14))); }
  x *= 1.35;
  return Math.min(1, x * (1 + x / 64) / (1 + x));
}
export const TONE_CURVES = { agx: 0, aces: 1, reinhard: 2 };

/* ---- Detailed's exposure ----
   In the Overworld the sky table works out how much light there is and so
   how open the eye should be (render/sky.js, its seventh texel); in a cave
   or under a roof the eye eases over (uCave, 0 to 1) to the renderer's
   uExposure, the same at any time of day. The Nether and the End have no
   sky, and uExposure is their whole exposure. Needs uDim, uExposure and
   uAmbient declared by the host. */
/* The void (renderer.js sets uVoid each frame; x and y both 0 leave
   everything as it was, so a shader without it is unchanged): x, the eye
   below sea level, the game's dark disc under the horizon; y, the eye near or
   below the bottom of the world, the fog going to black. The game's sky is a
   plane 16 blocks up and the disc one 4 blocks down, both 512 across, and
   both are fogged out to the render distance (z, in blocks): so overhead the
   sky stays blue to the very bottom of the void, and only towards the
   horizon does it go to the fog's black, and the disc is black straight down
   and the fog's colour at its rim, a line at the horizon. */
export const VOID = /* glsl */`
uniform vec3 uVoid;
float voidFog(vec3 rd, float h) {
  float r = h / max(abs(rd.y), 1e-4) * length(rd.xz);
  return clamp((h + min(r, 512.0) * (1.0 - h / 512.0)) / uVoid.z, 0.0, 1.0);    // (in a straight line, as the game's fog.glsl)
}
vec3 voidSky(vec3 col, vec3 rd) {
  float disc = rd.y < 0.0 && 4.0 / max(-rd.y, 1e-4) * length(rd.xz) < 512.0 ? 1.0 - voidFog(rd, 4.0) : 0.0;
  float fog = rd.y > 0.0313 ? voidFog(rd, 16.0) : 1.0;
  return col * (1.0 - uVoid.x * disc) * (1.0 - uVoid.y * fog);
}
`;
export const EXPOSURE = VOID + /* glsl */`
uniform float uCave;
float exposureNow() {
  if (uDim > 0.5) return uExposure;
  float e = texelFetch(uAmbient, ivec2(6, 0), 0).r;
  return uCave > 0.0 ? exp(mix(log(e), log(uExposure), uCave)) : e;
}
`;

/* ---- the single-pass finish, for Detailed: fog, exposure, tone map ----
   needs uView, uAmbient, uEyeInWater and cameraPosition declared by the host
   (and HAS_DIM defined if it declares uDim itself) */
export const LDR = /* glsl */`
uniform float uExposure, uRender, uSkyAtEye;
uniform float uFogMul;          // the fog's thickness (Shader Options: Fog)
uniform vec3 uWaterTint;
#ifndef HAS_DIM
uniform float uDim;
#endif
uniform vec3 uDimFog;           // the Nether's and the End's fog colour and range (js/dim/look.js)
uniform vec2 uDimFogRange;
uniform vec3 uShut;             // Blindness and Darkness: a black fog from x to y blocks, z its strength (vanilla.js shutFog)
float shutAt(float dist) { return uShut.z > 0.0 ? uShut.z * smoothstep(uShut.x, uShut.y, dist) : 0.0; }
` + EXPOSURE + /* glsl */`
vec3 skyDir(vec3 d) {
  float elev = asin(clamp(d.y, -1.0, 1.0));
  float v = 0.5 + 0.5 * sign(elev) * sqrt(abs(elev) / (PI * 0.5));
  float az = atan(d.z, d.x); if (az < 0.0) az += TAU;
  return texture(uView, vec2(az / TAU, v)).rgb;
}
vec3 finishLDR(vec3 col, vec3 world) {
  vec3 rd = world - cameraPosition;
  float dist = length(rd); rd /= max(dist, 1e-4);
  if (uDim > 0.5) {
    // no sky to fog towards: the fog closes in on its own colour
    col = mix(col, uDimFog, sat((dist - uDimFogRange.x) / max(1.0, uDimFogRange.y - uDimFogRange.x)));
  } else if (uEyeInWater > 0.5) {
    vec3 absorb = -0.15 * log(max(uWaterTint, vec3(0.02))) + 0.03;
    vec3 Tr = exp(-(absorb + 0.025) * min(dist, 96.0));
    vec3 amb = texelFetch(uAmbient, ivec2(0, 0), 0).rgb / PI;
    col = col * Tr + amb * uWaterTint * 0.6 * uSkyAtEye * (1.0 - Tr);
  } else {
    float h0 = cameraPosition.y - 63.0, k = 1.0 / 60.0, dy = rd.y * dist;
    float od = 0.0019 * uFogMul * exp(-h0 * k) * (abs(dy) > 0.01 ? (1.0 - exp(-dy * k)) / (dy * k) : 1.0) * dist;
    vec3 fogC = skyDir(normalize(vec3(rd.x, max(rd.y, 0.02), rd.z))) * (1.0 - uVoid.y);
    float T = exp(-od);
    col = col * T + fogC * (1.0 - T) * uSkyAtEye;
    float hd = length((world - cameraPosition).xz);
    col = mix(col, skyDir(normalize(vec3(rd.x, max(rd.y, 0.0), rd.z))) * (1.0 - uVoid.y), smoothstep(uRender * 0.72, uRender, hd));
  }
  col *= 1.0 - shutAt(dist);
  return toSRGB(agx(col * exposureNow()));
}
/* The same fog worked out once per vertex (as the game does its fog), for
   the shaders that light per vertex: what is left of the surface (keep, a
   colour, since water takes red first) and the light the fog adds in front
   of it. finishLDR(col) is then toneLDR(col * keep + add), with the exposure
   already in both. The renderer hands in what is the same for the whole
   frame: the exposure (uExpo) and the fog's thickness at the eye's height
   (uFogK); the fog's colour comes from a small table (sky.js FS_FOGTAB). */
uniform float uExpo, uFogK;
uniform sampler2D uFogTab;
vec3 fogColour(vec3 rd) {
  vec3 d = vec3(rd.x, max(rd.y, 0.02), rd.z);
  vec2 uv = vec2(d.x + d.z, d.x - d.z) / (abs(d.x) + d.y + abs(d.z));
  return textureLod(uFogTab, uv * 0.5 + 0.5, 0.0).rgb;
}
void fogTerms(vec3 world, out vec3 keep, out vec3 add) {
  vec3 rd = world - cameraPosition;
  float dist = length(rd); rd /= max(dist, 1e-4);
  float E = uExpo;
  if (uDim > 0.5) {
    float f = sat((dist - uDimFogRange.x) / max(1.0, uDimFogRange.y - uDimFogRange.x));
    keep = vec3((1.0 - f) * E); add = uDimFog * f * E;
  } else if (uEyeInWater > 0.5) {
    vec3 absorb = -0.15 * log(max(uWaterTint, vec3(0.02))) + 0.03;
    vec3 Tr = exp(-(absorb + 0.025) * min(dist, 96.0));
    vec3 amb = texelFetch(uAmbient, ivec2(0, 0), 0).rgb / PI;
    keep = Tr * E; add = amb * uWaterTint * 0.6 * uSkyAtEye * (1.0 - Tr) * E;
  } else {
    float k = 1.0 / 60.0, dy = rd.y * dist;
    float od = uFogK * (abs(dy) > 0.01 ? (1.0 - exp(-dy * k)) / (dy * k) : 1.0) * dist;
    float T = exp(-od);
    float fade = smoothstep(uRender * 0.72, uRender, length(rd.xz) * dist);
    keep = vec3(T * (1.0 - fade) * E);
    add = fogColour(rd) * ((1.0 - T) * uSkyAtEye * (1.0 - fade) + fade) * (1.0 - uVoid.y) * E;
  }
  float shut = 1.0 - shutAt(dist);
  keep *= shut; add *= shut;
}
`;
