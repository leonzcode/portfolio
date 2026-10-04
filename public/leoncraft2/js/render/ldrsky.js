/* ---------------------------------------------------------------------------
   Leoncraft 2 - the sky for the single-pass (low and potato) tiers.

   One full-screen pass, drawn first, straight to the screen: the same
   atmosphere as the full tiers (one look-up in the sky table), the sun's disc,
   the moon in its phase, stars, and a flat layer of clouds (two noise taps,
   lit from the sun's side) instead of the marched volumetric ones. Exposure
   and tone mapping happen here too, so nothing runs after it.
--------------------------------------------------------------------------- */
import { COMMON, TONEMAP } from './glsl.js?v=12';
import { rawMat } from './sky.js?v=12';
const THREE = window.THREE;

const FS = COMMON + TONEMAP + /* glsl */`
uniform sampler2D uView, uAmbient, uNoise, uMoon;
uniform mat4 uInvViewProj;
uniform vec3 uCamPos, uSunDir, uMoonDir, uLightDir;
uniform float uTime, uMoonPhase, uExposure, uCover, uEyeInWater;
uniform vec3 uWaterTint;
in vec2 vUv; out vec4 o;
vec3 skyRadiance(vec3 d) {
  float elev = asin(clamp(d.y, -1.0, 1.0));
  float v = 0.5 + 0.5 * sign(elev) * sqrt(abs(elev) / (PI * 0.5));
  float az = atan(d.z, d.x); if (az < 0.0) az += TAU;
  return texture(uView, vec2(az / TAU, v)).rgb;
}
vec3 stars(vec3 d) {
  vec3 p = d * 220.0, i = floor(p), f = fract(p);
  float h = hash13(i);
  if (h < 0.9935) return vec3(0.0);
  float b = hash13(i + 7.1);
  float tw = 0.7 + 0.3 * sin(uTime * (2.0 + b * 4.0) + h * 100.0);
  return mix(vec3(1.0, 0.82, 0.62), vec3(0.75, 0.85, 1.0), b) * smoothstep(0.35, 0.0, length(f - 0.5)) * (0.004 + 0.02 * b * b) * tw;
}
void main() {
  vec4 p = uInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 rd = normalize(p.xyz / p.w - uCamPos);
  vec3 col;
  if (uEyeInWater > 0.5) {
    vec3 amb = texelFetch(uAmbient, ivec2(0, 0), 0).rgb / PI;
    col = amb * uWaterTint * 0.6;
  } else {
    col = skyRadiance(vec3(rd.x, max(rd.y, 0.0), rd.z));
    vec3 sunC = texelFetch(uAmbient, ivec2(4, 0), 0).rgb;
    float cs = dot(rd, uSunDir);
    float r = acos(clamp(cs, -1.0, 1.0)) / radians(0.75);
    if (r < 1.0) col += sunC * 260.0 * pow(1.0 - r * r, 0.25);
    col += sunC * 0.6 * pow(sat(cs), 900.0);
    vec3 md = uMoonDir;
    vec3 mu = normalize(cross(md, vec3(0.0, 0.0, 1.0))), mv = cross(mu, md);
    vec2 mp = vec2(dot(rd, mu), dot(rd, mv)) / radians(1.6);
    if (dot(rd, md) > 0.0 && abs(mp.x) < 1.0 && abs(mp.y) < 1.0) {
      vec2 cell = vec2(mod(uMoonPhase, 4.0), floor(uMoonPhase / 4.0));
      vec4 m = texture(uMoon, vec2(((cell + (mp * 0.5 + 0.5)) / vec2(4.0, 2.0)).x, 1.0 - ((cell + (mp * 0.5 + 0.5)) / vec2(4.0, 2.0)).y));
      col += toLinear(m.rgb) * m.a * 2.2 * smoothstep(-0.05, 0.08, md.y);
    }
    col += stars(rd) * (1.0 - smoothstep(-0.12, 0.02, uSunDir.y)) * sat(rd.y * 4.0);
    // a flat layer of clouds at the height of the full tiers' ones
    if (rd.y > 0.01) {
      float t = (250.0 - uCamPos.y) / rd.y;
      if (t > 0.0) {
        // the same coverage as the full tiers' clouds, and as the shadows they cast (glsl.js cloudShade)
        vec2 xz = uCamPos.xz + rd.xz * t, wind = vec2(uTime * 2.2, uTime * 0.9);
        float c = texture(uNoise, (xz + wind) * 0.00018).a * 0.65 + texture(uNoise, (xz + wind * 1.3) * 0.0007).r * 0.35;
        c = sat((c - (1.0 - uCover)) * 2.6);
        vec3 lightC = texelFetch(uAmbient, ivec2(3, 0), 0).rgb, ambC = texelFetch(uAmbient, ivec2(0, 0), 0).rgb / PI;
        vec3 cloud = lightC * (0.04 + 0.06 * pow(sat(dot(rd, uLightDir)), 4.0)) + ambC * 0.9;
        col = mix(col, cloud, c * exp(-t * 0.00022) * 0.92);
      }
    }
  }
  o = vec4(toSRGB(agx(col * uExposure)), 1.0);
}`;

export function makeLdrSky(U) {
  return rawMat(FS, U, {});
}
