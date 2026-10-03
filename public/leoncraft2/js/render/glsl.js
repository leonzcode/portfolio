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
`;

/* ---- the sun's shadow map ------------------------------------------------ */
export const SHADOW = /* glsl */`
uniform sampler2DShadow uShadow;
uniform mat4 uShadowMat;      // world -> shadow clip (orthographic, centred on the player)
uniform float uShadowRes;
const float SHADOW_B = 0.85;  // how hard the map is squeezed towards the player
vec2 distort(vec2 p) { float f = length(p) * SHADOW_B + (1.0 - SHADOW_B); return p / f; }
float distortFactor(vec2 p) { return length(p) * SHADOW_B + (1.0 - SHADOW_B); }
// where a world point lands in the shadow map, nudged off its own surface
vec3 shadowCoord(vec3 world, vec3 n, float NoL, float dist) {
  world += n * 0.25 * clamp(0.12 + 0.01 * dist, 0.0, 1.0) * (2.0 - sat(NoL));
  vec4 c = uShadowMat * vec4(world, 1.0);
  c.xy = distort(c.xy);
  c.z *= 0.2;
  return c.xyz * 0.5 + 0.5;
}
// soft shadows: a rotated Vogel disc of hardware-filtered taps
float shadowSoft(vec3 sc, float noise, float radius) {
  if (sc.x <= 0.0 || sc.x >= 1.0 || sc.y <= 0.0 || sc.y >= 1.0 || sc.z >= 1.0) return 1.0;
  float s = 0.0;
  float a0 = noise * TAU;
  float bias = 0.00004;
  for (int i = 0; i < 8; i++) {
    float r = sqrt((float(i) + 0.5) / 8.0) * radius;
    float a = float(i) * 2.39996 + a0;
    vec2 o = vec2(cos(a), sin(a)) * r / uShadowRes;
    s += texture(uShadow, vec3(sc.xy + o, sc.z - bias));
  }
  return s / 8.0;
}
float shadowHard(vec3 sc) {
  if (sc.x <= 0.0 || sc.x >= 1.0 || sc.y <= 0.0 || sc.y >= 1.0 || sc.z >= 1.0) return 1.0;
  return texture(uShadow, vec3(sc.xy, sc.z - 0.00004));
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
float trampleAt(vec2 xz) {
  vec2 uv = (xz - uInteractRect.xy) / uInteractRect.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  return textureLod(uInteract, uv, 0.0).b;
}
vec3 windOffset(vec3 p, int wave, float v, float sky, float rnd) {
  if (wave == 0) return vec3(0.0);
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
  return off;
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
vec3 toSRGB(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
`;
