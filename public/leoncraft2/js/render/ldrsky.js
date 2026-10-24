/* ---------------------------------------------------------------------------
   Leoncraft 2 - the sky for Detailed graphics.

   One full-screen pass, drawn first, straight to the screen: the atmosphere
   (one look-up in the sky table), the sun's disc, the moon in its phase and
   the stars. The clouds are the game's own blocks of cloud, drawn after the
   world (render/clouds.js). In the Nether the sky is its fog colour, in the
   End a dark speckled box. Exposure and tone mapping happen here too, so
   nothing runs after it.
--------------------------------------------------------------------------- */
import { COMMON, TONEMAP, EXPOSURE } from './glsl.js?v=107';
import { rawMat } from './sky.js?v=107';
import { END_FLASH_GLSL } from './endflash.js?v=107';
const THREE = window.THREE;

const FS = COMMON + TONEMAP + /* glsl */`
uniform sampler2D uView, uAmbient, uMoon, uEndSky;
uniform mat4 uInvViewProj;
uniform vec3 uCamPos, uSunDir, uMoonDir;
uniform float uTime, uMoonPhase, uExposure, uEyeInWater;
uniform vec3 uWaterTint;
uniform float uDim;
uniform vec3 uDimFog;
uniform vec3 uShut;
` + EXPOSURE + END_FLASH_GLSL + /* glsl */`
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
  if (uDim > 0.5) {
    // no atmosphere: the Nether's sky is its fog, the End's a dark speckled box (js/dim/look.js sets the colour)
    if (uDim > 1.5) {
      vec3 a = abs(rd);
      vec2 q = a.x > a.y && a.x > a.z ? rd.zy / a.x : a.y > a.z ? rd.xz / a.y : rd.xy / a.z;
      // straight to the screen in the game's colours (its picture times 40 of 255), as at High and RIP (post.js):
      // through the eye and the tone curve it came out a third as bright as the game's, and bluer
      o = vec4(min(texture(uEndSky, (q * 0.5 + 0.5) * 16.0).rgb * (40.0 / 255.0) + endFlashSky(rd), 1.0) * (1.0 - uShut.z), 1.0);
      return;
    } else col = uDimFog;
  } else if (uEyeInWater > 0.5) {
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
      vec2 muv = (cell + (mp * 0.5 + 0.5)) / vec2(4.0, 2.0);
      vec4 m = texture(uMoon, vec2(muv.x, 1.0 - muv.y));
      col += toLinear(m.rgb) * m.a * 2.2 * smoothstep(-0.05, 0.08, md.y);
    }
    col += stars(rd) * (1.0 - smoothstep(-0.12, 0.02, uSunDir.y)) * sat(rd.y * 4.0);
    col = voidSky(col, rd);
  }
  // (Blindness and Darkness: the sky goes into their black fog)
  o = vec4(toneLDR(col * exposureNow() * (1.0 - uShut.z)), 1.0);
}`;

/* Drawn after the blocks, at the far plane and depth tested, so only the
   pixels where the sky really shows run this shader (most of a frame is
   ground and trees). */
const VS_FAR = /* glsl */`
in vec3 position;
out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }
`;
export function makeLdrSky(U) {
  const m = rawMat(FS, U, { depthTest: true, depthWrite: false, depthFunc: THREE.LessEqualDepth, defines: { TONE_LUT: 1 } });
  m.vertexShader = 'precision highp float; precision highp int;\n' + VS_FAR;
  return m;
}
