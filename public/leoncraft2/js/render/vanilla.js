/* ---------------------------------------------------------------------------
   Leoncraft 2 - Fast graphics: the game as it looks with no shaders at all.

   Everything here follows how Minecraft itself draws a frame:

     blocks     texture x biome tint x face shade (top 1.0, north and south
                0.8, east and west 0.6, bottom 0.5) x smooth-lighting corner
                shade (0.2 for each solid neighbour), then the lightmap
     lightmap   a 16 x 16 table of sky light by block light, worked out each
                frame from the time of day the way the game does: sky light
                dims to a blue-grey at night, torch light is warm and flickers
                a little, and the Brightness option lifts the dark end
     fog        linear (smoothed) over the last tenth of the render distance,
                measured as a cylinder round the camera, towards the fog
                colour; under water a short blue fog that clears over the
                first half minute, in lava a deep orange one
     sky        the biome's sky colour overhead fading into the fog colour at
                the horizon (the game's sky plane, 16 blocks up), the orange
                fan at sunrise and sunset, a square sun and moon, stars
     clouds     blocks of cloud 12 x 4 x 12 at height 192, white with the same
                face shades, drifting west (our own cloud pattern)
     water      the water texture's grain in the biome's water colour, see-
                through, lit and fogged like the blocks; lava solid and bright

   No shadow map, no post-processing, drawn straight to the screen at full
   resolution with nearest-neighbour textures.
--------------------------------------------------------------------------- */
import { COMMON, FILTER } from './glsl.js?v=107';
import { FullScreen, VS_FULL } from './sky.js?v=107';
import { BlockClouds } from './clouds.js?v=107';
import { END_FLASH_GLSL, END_FLASH_COLOUR } from './endflash.js?v=107';
const THREE = window.THREE;

// the game's rain and thunder colour shift: towards a grey of the colour's own brightness times k
function greyTowards(c, f, k) {
  if (f <= 0) return;
  const g = (c.x * 0.3 + c.y * 0.59 + c.z * 0.11) * k, a = 1 - f;
  c.set(c.x * a + g * f, c.y * a + g * f, c.z * a + g * f);
}
const HEAD = `precision highp float; precision highp int; precision highp sampler2DArray;\n`;

/* ---- shared by every vanilla shader ---- */
export const VANILLA = /* glsl */`
uniform sampler2D uLightmap;
uniform vec3 uFogColor;
uniform vec3 uFog;              // start, end, shape (0 sphere, 1 cylinder)
uniform float uConstAmb;        // the Nether: top and bottom faces both 0.9 (js/dims.js constAmb)
vec3 lightmapAt(float sky, float block) {
  return texture(uLightmap, (vec2(block, sky) * 15.0 + 0.5) / 16.0).rgb;
}
float fogDistance(vec3 rel) { return uFog.z > 0.5 ? max(length(rel.xz), abs(rel.y)) : length(rel); }
vec3 linearFog(vec3 c, float d) {
  if (d <= uFog.x) return c;
  float f = d < uFog.y ? smoothstep(uFog.x, uFog.y, d) : 1.0;
  return mix(c, uFogColor, f);
}
// the face shades the game gives each side of a block (0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z)
float faceShade(int f) { return f == 2 ? mix(1.0, 0.9, uConstAmb) : f == 3 ? mix(0.5, 0.9, uConstAmb) : f >= 4 ? 0.8 : 0.6; }
// how the game lights a mob or an item: two fixed lights and 0.4 everywhere (in the Nether the second from below)
float entityShade(vec3 n) {
  vec3 l0 = normalize(vec3(0.2, 1.0, -0.7)), l1 = normalize(vec3(-0.2, uConstAmb > 0.5 ? -1.0 : 1.0, 0.7));
  return min(1.0, (max(0.0, dot(l0, n)) + max(0.0, dot(l1, n))) * 0.6 + 0.4);
}
`;

const TERRAIN_VS = /* glsl */`
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
uniform vec3 cameraPosition;
uniform vec2 uLightLv;
layout(location = 0) in uvec4 aPos; layout(location = 1) in uvec4 aA; layout(location = 2) in uvec4 aL; layout(location = 3) in uvec4 aC;
#define aPos vec4(aPos)
#define aA vec4(aA)
#define aL vec4(aL)
#define aC vec4(aC)
uniform vec3 uChunk;
out vec2 vUv; out vec3 vShade; out float vFogD; out vec3 vTint;
flat out float vLayer; flat out int vFlags;
void main() {
  vec4 world = modelMatrix * vec4(aPos.xyz / 32.0 - vec3(8.0, 0.0, 8.0) + uChunk, 1.0);
  int nw = int(aA.z + 0.5);
  int flags = int(aA.w + 0.5);
  vec4 L = aL / 255.0;
  bool plant = (flags & 32) != 0;
  // crossed plants have no face shade and no corner shade, as their models say
  float ao = plant ? 1.0 : 0.4 + 0.2 * float(flags & 3);
  float shade = plant ? 1.0 : faceShade(nw & 7);
#ifdef HAND
  vec3 light = lightmapAt(uLightLv.x, uLightLv.y);
#else
  vec3 light = lightmapAt(L.x, L.y);
#endif
  vShade = light * (shade * ao);
  vTint = aC.rgb / 255.0;
  vUv = aA.xy / 16.0;
  vLayer = aPos.w;
  vFlags = flags;
  vFogD = fogDistance(world.xyz - cameraPosition);
  /* the camera's turn on the point's place from the eye, never viewMatrix on the place in the world: far from
     the middle of the world (a few thousand blocks out) viewMatrix's big shift and the big place cancel, and what
     is left was rounded differently for every corner and every turn of the camera, so faces a sixteenth apart
     (a wall's arm in its post, a button on its block, a step's side) took turns in front as the view turned.
     The place from the eye is worked out exactly (both on the same 1/32 grid, near each other) */
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * (world.xyz - cameraPosition), 1.0);
}`;

const TERRAIN_FS = /* glsl */`
uniform sampler2DArray uAlbedo;
uniform sampler2D uLayerInfo;
uniform float uTime;
in vec2 vUv; in vec3 vShade; in float vFogD; in vec3 vTint;
flat in float vLayer; flat in int vFlags;
layout(location = 0) out vec4 outColor;
// an animated texture steps through its frames, as the game's do
float frameOf(float layer) {
  vec4 info = texelFetch(uLayerInfo, ivec2(int(layer + 0.5), 0), 0);
  if (info.x < 1.5) return layer;
  return layer + mod(floor(uTime * 20.0 / max(1.0, info.y)), info.x);
}
void main() {
  int rot = (vFlags >> 2) & 3;
  bool overlay = (vFlags & 16) != 0;
  bool plant = (vFlags & 32) != 0;
  bool tinted = (vFlags & 64) != 0;
  vec2 uv = vUv;
  if (rot == 1) uv = vec2(1.0 - vUv.y, vUv.x);
  else if (rot == 2) uv = vec2(1.0 - vUv.x, 1.0 - vUv.y);
  else if (rot == 3) uv = vec2(vUv.y, 1.0 - vUv.x);
  float layer = frameOf(vLayer);
  // every block is mipmapped now, plants too (Mipmap Levels), and filtered as Texture Filtering says
  vec4 alb = texFiltered(uAlbedo, vec3(uv, layer));
#ifdef CUTOUT
  if (alb.a < (plant ? 0.1 : 0.5)) discard;
#ifndef HAND
  // a box's face shows from its front only, as the game draws it: two faces back to back (a banner's, a lantern's, two
  // leaves side by side) lay in one place and flickered through each other; sheets and plants (flag 32) show both sides
  if (!gl_FrontFacing && (vFlags & 32) == 0) discard;
#endif
#endif
#ifdef DEPTH_ONLY
  outColor = vec4(0.0);
  return;
#endif
  vec3 c = alb.rgb;
  if (overlay) {
    vec4 ov = texture(uAlbedo, vec3(uv, vLayer + 1.0));
    c = mix(c, ov.rgb * vTint, ov.a);
  } else if (tinted) c *= vTint;
  // fast leaves: solid, the gaps a dark leafy shade
  if ((vFlags & 128) != 0 && alb.a < 0.5) c = vTint * 0.42;
  c *= vShade;
  c = linearFog(c, vFogD);
  // Chunk Fade: a column just come into the world fades in from the fog
  c = mix(uFogColor, c, uChunkFade);
#ifdef TRANSLUCENT
  outColor = vec4(c, alb.a);
#else
  outColor = vec4(c, 1.0);
#endif
}`;

const FLUID_VS = /* glsl */`
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
uniform vec3 cameraPosition;
uniform float uMeshTime, uClock;
layout(location = 0) in uvec4 aPos; layout(location = 1) in uvec4 aA; layout(location = 2) in ivec4 aF; layout(location = 3) in uvec4 aC;
#define aPos vec4(aPos)
#define aA vec4(aA)
#define aF vec4(aF)
#define aC vec4(aC)
uniform vec3 uChunk;
out vec3 vWorld; out vec3 vLight; out float vFogD; out vec3 vCol; out vec2 vFlow;
flat out int vNormal; flat out int vFlags; flat out float vLayer;
void main() {
  vec4 world = modelMatrix * vec4(aPos.xyz / 32.0 - vec3(8.0, 0.0, 8.0) + uChunk, 1.0);
  // from where the surface was before the flow last moved, to where it is now
  world.y += aF.z / 32.0 * (1.0 - smoothstep(0.0, 0.32, uClock - uMeshTime));
  vWorld = world.xyz;
  vNormal = int(aA.x + 0.5);
  vFlags = int(aA.y + 0.5);
  vLight = lightmapAt(aA.z / 255.0, aA.w / 255.0) * faceShade(vNormal);
  vCol = aC.rgb / 255.0;
  vFlow = aF.xy / 127.0;
  vLayer = aPos.w;
  vFogD = fogDistance(world.xyz - cameraPosition);
  // (from the eye, as the blocks: TERRAIN_VS)
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * (world.xyz - cameraPosition), 1.0);
}`;

const FLUID_FS = /* glsl */`
uniform sampler2DArray uAlbedo;
uniform sampler2D uLayerInfo;
uniform float uTime;
uniform vec2 uFlowLayers;       // water_flow, lava_flow
in vec3 vWorld; in vec3 vLight; in float vFogD; in vec3 vCol; in vec2 vFlow;
flat in int vNormal; flat in int vFlags; flat in float vLayer;
layout(location = 0) out vec4 outColor;
float frameOf(float layer) {
  vec4 info = texelFetch(uLayerInfo, ivec2(int(layer + 0.5), 0), 0);
  if (info.x < 1.5) return layer;
  return layer + mod(floor(uTime * 20.0 / max(1.0, info.y)), info.x);
}
void main() {
  bool lava = (vFlags & 2) != 0;
  bool top = vNormal == 2 || vNormal == 3;
  float flowL = lava ? uFlowLayers.y : uFlowLayers.x;
  vec2 p, dpx, dpy;
  float layer;
  if (top) {
    p = vWorld.xz; dpx = dFdx(p); dpy = dFdy(p);
    vec2 cell = fract(p);
    float fl = length(vFlow);
    if (fl > 0.05 && vNormal == 2) {
      // running water: the flowing texture, turned to run downhill, at half size (as the game samples it)
      vec2 d = vFlow / fl;
      vec2 q = cell - 0.5;
      q = vec2(q.x * d.y - q.y * d.x, q.x * d.x + q.y * d.y);
      p = 0.5 + q * 0.5;
      dpx *= 0.5; dpy *= 0.5;
      layer = frameOf(flowL);
    } else { p = cell; layer = frameOf(vLayer); }
  } else {
    // the sides: the flowing texture, half of it, running down
    float along = (vNormal == 0 || vNormal == 1) ? vWorld.z : vWorld.x;
    vec2 w = vec2(along, -vWorld.y);
    dpx = dFdx(w) * 0.5; dpy = dFdy(w) * 0.5;
    p = fract(w) * 0.5;
    layer = frameOf(flowL);
  }
  vec4 t = textureGrad(uAlbedo, vec3(p, layer), dpx, dpy);
  vec3 c;
  float a;
  if (lava) { c = t.rgb; a = 1.0; }
  else {
    /* the water texture's grain, in this biome's water colour: the texture is
       grey at the game's own mean (177 of 255), so it is multiplied as it is
       (it was 1.9 times brighter, from when the pack's water was darker) */
    c = vec3(dot(t.rgb, vec3(0.299, 0.587, 0.114))) * vCol;
    a = t.a;
  }
  c *= vLight;
  c = linearFog(c, vFogD);
  outColor = vec4(c, a);
}`;

/* ---- the sky: one pass over the whole screen, before the world ---- */
const SKY_FS = COMMON + END_FLASH_GLSL + /* glsl */`
uniform mat4 uInvViewProj;
uniform vec3 uCamPos, uSkyColor, uFogColor, uVSun;
uniform vec4 uSunrise;          // colour and strength of the sunrise fan
uniform vec3 uSky;              // fog end for the sky, star brightness, under a fluid
uniform float uMoonPhase, uRain, uSkyMode, uVoidDisc;
uniform sampler2D uSunTex, uVMoon, uEndSky;
in vec2 vUv; out vec4 o;
void main() {
  vec4 p = uInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 rd = normalize(p.xyz / p.w - uCamPos);
  vec3 col = uFogColor;
  if (uSky.z > 0.5 || uSkyMode > 0.5 && uSkyMode < 1.5) { o = vec4(col, 1.0); return; }
  if (uSkyMode > 1.5) {
    // the End: a box of our own dark speckled sky, sixteen tiles to a side, at 40/255 (js/dim/art.js)
    vec3 a = abs(rd);
    vec2 q = a.x > a.y && a.x > a.z ? rd.zy / a.x : a.y > a.z ? rd.xz / a.y : rd.xy / a.z;
    // and a flash's source when there is one (render/endflash.js)
    o = vec4(texture(uEndSky, (q * 0.5 + 0.5) * 16.0).rgb * (40.0 / 255.0) + endFlashSky(rd), 1.0);
    return;
  }
  // the sky plane 16 blocks up, fogged at its corners (the game fogs it per corner of a 512 block fan,
  // in a straight line from none at the eye to all of it at the render distance, its fog.glsl)
  if (rd.y > 0.0313) {
    float r = 16.0 / max(rd.y, 1e-4) * length(rd.xz);
    float d = 16.0 + min(r, 512.0) * (496.0 / 512.0);
    col = mix(uSkyColor, uFogColor, sat(d / uSky.x));
  }
  // the sunrise fan, low on the horizon on the sun's side
  if (uSunrise.a > 0.0) {
    vec3 c = normalize(vec3(sign(uVSun.x), 0.0, 0.0));
    float ang = acos(clamp(dot(rd, c), -1.0, 1.0));
    float w = 1.0 - smoothstep(0.0, 0.9, ang);
    w *= smoothstep(-0.25, 0.1, rd.y + 0.15) * (1.0 - smoothstep(0.0, 0.85, rd.y));
    col = mix(col, uSunrise.rgb, sat(w * uSunrise.a));
  }
  /* the sun and the moon: squares, added on, as big as the game's (its sun is
     a quad 30 across at 100 blocks, the moon 20, each picture 32 pixels with
     the lit part the middle 8: celestial() below) */
  vec3 s = uVSun;
  vec3 u = vec3(0.0, 0.0, 1.0), v = normalize(cross(s, u));
  float ds = dot(rd, s);
  if (ds > 0.0) {
    vec2 q = vec2(dot(rd, u), dot(rd, v)) / ds;
    if (abs(q.x) < 0.3 && abs(q.y) < 0.3) {
      vec4 t = texture(uSunTex, q / 0.6 + 0.5);
      col += t.rgb * (1.0 - uRain);
    }
  } else {
    vec2 q = vec2(dot(rd, u), dot(rd, v)) / -ds;
    if (abs(q.x) < 0.2 && abs(q.y) < 0.2) {
      vec2 cell = vec2(mod(uMoonPhase, 4.0), floor(uMoonPhase / 4.0));
      vec2 mp = q / 0.4 + 0.5;
      vec4 m = texture(uVMoon, vec2((cell.x + mp.x) / 4.0, (cell.y + mp.y) / 2.0));
      col += m.rgb * (1.0 - uRain);
    }
  }
  // stars, turning with the sky
  if (uSky.y > 0.0) {
    float a = atan(uVSun.x, uVSun.y);
    float ca = cos(a), sa = sin(a);
    vec3 sd = vec3(rd.x * ca - rd.y * sa, rd.x * sa + rd.y * ca, rd.z);
    vec3 g = sd * 90.0, i = floor(g);
    float h = hash13(i);
    if (h > 0.986) {
      vec3 c = i + 0.5 + (vec3(hash13(i + 3.1), hash13(i + 5.7), hash13(i + 9.3)) - 0.5) * 0.6;
      float sz = 0.12 + hash13(i + 1.7) * 0.08;
      vec3 dd = g - c; dd -= dot(dd, sd) * sd;
      if (max(abs(dd.x), max(abs(dd.y), abs(dd.z))) < sz) col += vec3(uSky.y);
    }
  }
  /* The eye below sea level: the game's dark disc under the horizon, 4 blocks
     below the eye and 512 across, black, fogged at its rim like the plane
     above, and drawn last, over the sun and the stars. So the horizon is a
     line of fog colour with the dark below it, as in a ravine or the void. */
  if (uVoidDisc > 0.5 && rd.y < 0.0) {
    float r = 4.0 / max(-rd.y, 1e-4) * length(rd.xz);
    if (r < 512.0) col = mix(vec3(0.0), uFogColor, sat((4.0 + r * (508.0 / 512.0)) / uSky.x));
  }
  o = vec4(col, 1.0);
}`;

/* ---- clouds ---- */
const CLOUD_VS = /* glsl */`
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
uniform vec3 cameraPosition;
in vec3 position; in float shade;
out float vShade; out float vFogD;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vShade = shade;
  vec3 rel = w.xyz - cameraPosition;
  vFogD = length(rel.xz);
  // (from the eye: TERRAIN_VS)
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * rel, 1.0);
}`;
const CLOUD_FS = /* glsl */`
uniform vec3 uCloudColor, uFogColor;
uniform vec2 uCloudFog;
in float vShade; in float vFogD;
out vec4 o;
void main() {
  vec3 c = uCloudColor * vShade;
  float f = smoothstep(uCloudFog.x, uCloudFog.y, vFogD);
  o = vec4(mix(c, uFogColor, f), 0.8 * (1.0 - f * f));
}`;

// the water fog colour of each biome that has its own (the rest: 0x050533)
const WATER_FOG = { warm_ocean: 0x041f33, lukewarm_ocean: 0x041633, deep_lukewarm_ocean: 0x041633, cold_ocean: 0x050533, deep_cold_ocean: 0x050533, frozen_ocean: 0x050533, deep_frozen_ocean: 0x050533, swamp: 0x232317, mangrove_swamp: 0x3a7a6a, meadow: 0x050533, cherry_grove: 0x5db7ef };
const rgb = (c, out) => out.set(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255);
const frac = x => x - Math.floor(x);
const clamp01 = x => Math.max(0, Math.min(1, x));

/* Our own sun and moon (no game files): the game's sizes, a 32 pixel picture
   whose lit part is the middle 8 by 8, added onto the sky, so black is
   nothing. The sun is a square going from a warm yellow rim to a near white
   middle; the moon a grey square with darker patches, in the game's eight
   phases (0 full, then waning to 4 new and waxing back), its 4 x 2 sheet laid
   out as the game's was. */
function celestial() {
  const tex = (data, w, h) => {
    const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
    return t;
  };
  /* round both, a faint glow fading out to the picture's edge, as the game's
     pictures have: about an eighth of full brightness next to the disc, half
     that 3 pixels out, nothing at the edge; warm round the sun, cool round
     the moon (our own curve) */
  const glow = (data, w, ox, oy, rgb) => {
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      if (x >= 12 && x < 20 && y >= 12 && y < 20) continue;
      const r = Math.hypot(x - 15.5, y - 15.5), g = 44 * Math.pow(Math.max(0, 1 - (r - 4) / 11.5), 1.35);
      const i = ((oy + y) * w + ox + x) * 4;
      data[i] = Math.round(rgb[0] * g); data[i + 1] = Math.round(rgb[1] * g); data[i + 2] = Math.round(rgb[2] * g); data[i + 3] = 255;
    }
  };
  const sun = new Uint8Array(32 * 32 * 4);
  glow(sun, 32, 0, 0, [1, 1, 0.37]);
  const SUN = [[250, 212, 88], [255, 236, 148], [255, 249, 204], [255, 255, 236]];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const ring = Math.min(x, y, 7 - x, 7 - y), c = SUN[ring], i = ((12 + y) * 32 + 12 + x) * 4;
    sun[i] = c[0]; sun[i + 1] = c[1]; sun[i + 2] = c[2]; sun[i + 3] = 255;
  }
  // the moon's face: L light, M a little darker, D the dark patches
  const FACE = ['LLMLLLML', 'LDDLLLLL', 'LDDLMLLL', 'LLLLLDLL', 'LMLLLLLL', 'LLLLDDLM', 'LLMLDDLL', 'MLLLLLLL'];
  const TONE = { L: [214, 218, 228], M: [190, 194, 208], D: [150, 154, 172] };
  // the columns lit in each phase, of the eight across: waning keeps the left side, waxing grows from the right
  const LIT = [[0, 8], [0, 6], [0, 4], [0, 2], [0, 0], [6, 8], [4, 8], [2, 8]];
  const moon = new Uint8Array(128 * 64 * 4);
  for (let p = 0; p < 8; p++) {
    glow(moon, 128, (p % 4) * 32, Math.floor(p / 4) * 32, [0.37, 0.55, 1]);
    const ox = (p % 4) * 32 + 12, oy = Math.floor(p / 4) * 32 + 12, [a, b] = LIT[p];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const i = ((oy + y) * 128 + ox + x) * 4;
      // the dark side is all but invisible, a new moon a faint square
      const c = x >= a && x < b ? TONE[FACE[y][x]] : [14, 14, 20];
      moon[i] = c[0]; moon[i + 1] = c[1]; moon[i + 2] = c[2]; moon[i + 3] = 255;
    }
  }
  return { sun: tex(sun, 32, 32), moon: tex(moon, 128, 64) };
}

/* The game's own clock: how far round the sky the sun is (0 noon, 0.5
   midnight), from the day time in ticks. It is not even: the sun hangs
   a little longer near the horizon. */
export function timeOfDay(dayTime) {
  const d0 = frac(dayTime / 24000 - 0.25);
  const d1 = 0.5 - Math.cos(d0 * Math.PI) / 2;
  return (d0 * 2 + d1) / 3;
}
// the biome's sky colour, from its temperature (the game's formula)
function skyColour(temp, out) {
  const f = Math.max(-1, Math.min(1, temp / 3));
  const h = 0.62222224 - f * 0.05, s = 0.5 + f * 0.1, v = 1;
  const i = Math.floor(h * 6) % 6, fr = h * 6 - Math.floor(h * 6);
  const p = v * (1 - s), q = v * (1 - fr * s), t = v * (1 - (1 - fr) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i];
  return out.set(r, g, b);
}

/* ---- the lightmap's numbers, from the game's own data ----
   The light everything gets at light level 0 in each dimension
   (minecraft:visual/ambient_light_color in its dimension types), the block
   light's tint (block_light_tint's default), and the Overworld's day timeline
   for the sky light: [tick, strength, r, g, b] (sky_light_factor and
   sky_light_color), straight lines between, round the day. */
const hex3 = c => [(c >> 16) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
const AMBIENT_LIGHT = { overworld: hex3(0x0a0a0a), the_nether: hex3(0x302821), the_end: hex3(0x3f473f) };
const BLOCK_TINT = hex3(0xffd88c);
const SKY_KEYS = [[730, 1, 0xffffff], [11270, 1, 0xffffff], [13140, 0.24, 0x7a7aff], [22860, 0.24, 0x7a7aff]].map(([t, f, c]) => [t, f, ...hex3(c)]);
/* Night Vision's strength (0..1) from the render state's effects, as the
   game has it: full, flickering for its last ten seconds (0.7 + 0.3 sin of
   the ticks left times 0.2 pi) */
export function nightVision(state) {
  const e = state && state.effects && state.effects.night_vision;
  if (!e || e.ticks === 0) return 0;
  if (e.ticks === -1 || e.ticks > 200) return 1;
  return 0.7 + Math.sin((e.ticks - (state.alpha || 0)) * Math.PI * 0.2) * 0.3;
}
// Blindness's strength (0..1): full but for its last second, as the game fades it
function blindness(state) {
  const e = state && state.effects && state.effects.blindness;
  if (!e || e.ticks === 0) return 0;
  return e.ticks === -1 ? 1 : Math.min(1, e.ticks / 20);
}
// Darkness's strength (0..1): it comes in over 22 ticks and goes over its last 22, as the game blends it
// (eased once a frame by whichever look is drawing: this file's update or dim/look.js)
let darkB = 0;
function darkness(state, dt) {
  const e = state && state.effects && state.effects.darkness;
  const want = !e || e.ticks === 0 ? 0 : e.ticks === -1 ? 1 : Math.min(1, e.ticks / 22);
  darkB = want > darkB ? Math.min(want, darkB + Math.min(0.25, dt) * 20 / 22) : want;
  return darkB;
}
/* The black fog of Blindness and Darkness for the shader looks (glsl.js uShut): where it starts, where it is
   whole, and how strong (0 none), out of a render distance of R blocks; as the Off look's fog above. */
export function shutFog(state, dt, R, out) {
  const bl = blindness(state), dk = darkness(state, dt);
  if (bl <= 0 && dk <= 0) return out.set(0, 1, 0);
  const f = bl > 0 ? R + (5 - R) * bl : R + (15 - R) * dk;
  return out.set(bl > 0 ? f * 0.25 : f * 0.75, f, Math.max(bl, dk));
}
const ZERO4 = [0, 0, 0, 0];
/* Fullbright (Video Settings, the game menu): what the Fullbright mods do, the
   game's gamma (Brightness) set to 1500% instead of 0..100%. Every cell of the
   lightmap comes out at or next to full white, so caves, the night, the Nether
   and the End are lit as at noon; the face shades and the textures' own
   colours are left as they are. */
export const FULLBRIGHT_GAMMA = 15;
// the End's sky light in a flash: its colour, and how strong at the flash's height
const END_SKY = [1, ...END_FLASH_COLOUR], END_FLASH_LIGHT = 0.6;
const skyOut = [0, 0, 0, 0];
function skyLightAt(dayTime) {
  let t = ((dayTime % 24000) + 24000) % 24000;
  if (t < SKY_KEYS[0][0]) t += 24000;
  let k = SKY_KEYS.length - 1;
  while (k > 0 && SKY_KEYS[k][0] > t) k--;
  const a = SKY_KEYS[k], b = k + 1 < SKY_KEYS.length ? SKY_KEYS[k + 1] : SKY_KEYS[0], tb = k + 1 < SKY_KEYS.length ? b[0] : b[0] + 24000;
  const f = (t - a[0]) / (tb - a[0]);
  for (let n = 0; n < 4; n++) skyOut[n] = a[n + 1] + (b[n + 1] - a[n + 1]) * f;
  return skyOut;
}
// the sky light's strength at a time of day (1 by day, 0.24 at night: the game's sky light factor; ui/minimap.js)
export const skyLightFactor = dayTime => skyLightAt(dayTime)[0];

export class Vanilla {
  constructor(renderer, textures) {
    this.R = renderer;
    const U = renderer.U;
    // the lightmap: block light across, sky light up
    this.lmData = new Uint8Array(16 * 16 * 4);
    const lm = this.lightmap = new THREE.DataTexture(this.lmData, 16, 16, THREE.RGBAFormat, THREE.UnsignedByteType);
    lm.magFilter = lm.minFilter = THREE.LinearFilter;
    lm.wrapS = lm.wrapT = THREE.ClampToEdgeWrapping;
    lm.generateMipmaps = false;
    lm.needsUpdate = true;
    const man = textures.manifest.textures;
    const sky = celestial();
    Object.assign(U, {
      uLightmap: { value: lm }, uFogColor: { value: new THREE.Vector3(0.75, 0.85, 1) }, uFog: { value: new THREE.Vector3(100, 128, 1) },
      uSkyColor: { value: new THREE.Vector3(0.47, 0.65, 1) }, uVSun: { value: new THREE.Vector3(0, 1, 0) },
      uSunrise: { value: new THREE.Vector4() }, uSky: { value: new THREE.Vector3(128, 0, 0) }, uRain: { value: 0 },
      uSunTex: { value: sky.sun }, uVMoon: { value: sky.moon }, uCloudColor: { value: new THREE.Vector3(1, 1, 1) }, uCloudFog: { value: new THREE.Vector2(128, 256) },
      uFlowLayers: { value: new THREE.Vector2(man.water_flow ? man.water_flow.layer : 0, man.lava_flow ? man.lava_flow.layer : 0) },
      uLightLv: renderer.uHandLight || (renderer.uHandLight = { value: new THREE.Vector2(1, 0) }),
      uConstAmb: { value: 0 }, uSkyMode: { value: 0 }, uEndSky: { value: textures.endSky || null }, uVoidDisc: { value: 0 },
    });
    this.skyFS = new FullScreen(new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: 'precision highp float;\n' + VS_FULL, fragmentShader: 'precision highp float; precision highp int;\n' + SKY_FS,
      uniforms: U, depthTest: false, depthWrite: false,
    }));
    this.flicker = 0;
    this.waterTime = 0;
    this.skyC = new THREE.Vector3(0.47, 0.65, 1); this.fogBase = new THREE.Vector3(0.75, 0.85, 1);
    this.tmp = new THREE.Vector3(); this.tmp2 = new THREE.Vector3();
    this.waterFog = new THREE.Vector3(); this.waterFogTarget = new THREE.Vector3(); this.waterFogSet = false;
    // clouds (render/clouds.js): white with the face shades, fogged like the blocks
    const cu = { uCloudColor: U.uCloudColor, uFogColor: U.uFogColor, uCloudFog: U.uCloudFog };
    this.cloudMesh = new BlockClouds(extra => new THREE.RawShaderMaterial(Object.assign({ glslVersion: THREE.GLSL3, vertexShader: 'precision highp float;\n' + CLOUD_VS, fragmentShader: 'precision highp float;\n' + CLOUD_FS, uniforms: cu, side: THREE.DoubleSide }, extra)));
  }

  /* ---- once a frame: the clock, the colours, the lightmap and the fog ---- */
  update(state, opts, dt) {
    const U = this.R.U;
    // the dimension (js/dims.js): a fixed clock, its ambient light, its kind of sky
    const D = state.dim || null, other = !!(D && D.id !== 'overworld');
    U.uConstAmb.value = D && D.constAmb ? 1 : 0;
    U.uSkyMode.value = !D || D.sky === 'normal' ? 0 : D.sky === 'none' ? 1 : 2;
    const dayTime = D && D.fixedTime !== null ? D.fixedTime : state.time * 20;
    const tod = timeOfDay(dayTime);
    const ang = tod * Math.PI * 2;
    const cosA = Math.cos(ang);
    // the sun's way across the sky: up from the east (+x), over the top, down in the west
    U.uVSun.value.set(-Math.sin(ang), cosA, 0);
    // rain and storms dim the sky and its light by the game's own factors (sim/weather.js sets weatherState)
    const wx = this.R.weatherState || {}, rain = wx.rain || 0, thunder = wx.thunder || 0;
    const daylight = clamp01(cosA * 2 + 0.5);
    this.flicker += (Math.random() - Math.random()) * Math.random() * Math.random() * 0.1 * Math.min(3, dt * 20);
    this.flicker *= Math.pow(0.9, Math.min(3, dt * 20));
    // the lightmap: the sky light's colour and strength by the time of day (none in the Nether and the End), rain and storms
    // taking it down as above, the dimension's ambient light, and Night Vision
    // (a lightning flash lights the sky light to its full strength for its two ticks, as the game's does)
    // (Darkness: the game's pulse, the light taken down by up to 0.45 every four seconds, and Brightness lowered by its strength)
    const sl = other ? null : skyLightAt(dayTime);
    const bl = blindness(state), dk = darkness(state, dt);
    const dkPulse = dk > 0 ? Math.max(0, Math.cos(state.time * 20 * Math.PI * 0.025) * 0.45 * dk) : 0;
    // (the End's sky light is off but for its flashes, when it comes up in its purple: render/endflash.js)
    const ef = D && D.sky === 'end' ? U.uEndFlash.value.w : 0;
    this.makeLightmap(sl ? (wx.flash > 0 ? 1 : sl[0] * (1 - rain * 5 / 16) * (1 - thunder * 5 / 16)) : ef * END_FLASH_LIGHT, sl || (ef > 0 ? END_SKY : ZERO4), AMBIENT_LIGHT[D ? D.id : 'overworld'] || AMBIENT_LIGHT.overworld,
      Math.max(0, (opts.fullbright ? FULLBRIGHT_GAMMA : opts.brightness === undefined ? 0.5 : opts.brightness) - dk), nightVision(state), dkPulse);
    // the sky and fog colours of the biome you are in, eased so a border does not snap
    const b = state.biome;
    if (b && b.sky !== undefined) rgb(b.sky, this.tmp); else skyColour(b ? b.temp : 0.8, this.tmp);
    const k = this.colorsSet ? Math.min(1, dt * 2) : 1;
    this.skyC.lerp(this.tmp, k);
    rgb(b && b.fog ? b.fog : 0xc0d8ff, this.tmp2);
    this.fogBase.lerp(this.tmp2, k);
    this.colorsSet = true;
    const sky = U.uSkyColor.value.copy(this.skyC).multiplyScalar(daylight);
    greyTowards(sky, rain * 0.75, 0.6); greyTowards(sky, thunder * 0.75, 0.2);
    if (wx.flash) { const f = Math.min(1, wx.flash) * 0.45; sky.set(sky.x * (1 - f) + 0.8 * f, sky.y * (1 - f) + 0.8 * f, sky.z * (1 - f) + f); }
    // the fog colour: the biome's, darkened by the time of day, pulled towards the sky the further you can see
    const fog = U.uFogColor.value.copy(this.fogBase);
    // the Nether keeps its biome's fog as it is; the End's is that times 0.15
    if (D && D.sky === 'end') fog.multiplyScalar(0.15);
    else if (!other) { fog.x *= daylight * 0.94 + 0.06; fog.y *= daylight * 0.94 + 0.06; fog.z *= daylight * 0.91 + 0.09; }
    const rdc = Math.max(2, opts.renderDist || 8);
    const f3 = 1 - Math.pow(0.25 + 0.75 * rdc / 32, 0.25);
    fog.lerp(sky, f3);
    // sunrise and sunset: the fan, and the fog towards it when you look that way
    const sr = other ? null : sunriseColour(tod);
    if (sr) {
      U.uSunrise.value.set(sr[0], sr[1], sr[2], sr[3]);
      const look = this.R.camera.getWorldDirection(this.tmp);
      const side = Math.sin(ang) > 0 ? -1 : 1;
      let f8 = Math.max(0, look.x * side) * sr[3];
      if (f8 > 0 && rdc >= 4) fog.set(fog.x * (1 - f8) + sr[0] * f8, fog.y * (1 - f8) + sr[1] * f8, fog.z * (1 - f8) + sr[2] * f8);
    } else U.uSunrise.value.set(0, 0, 0, 0);
    // stars come out as the sky darkens
    const sb = clamp01(1 - (cosA * 2 + 0.25));
    const R = rdc * 16;
    U.uSky.value.set(R, other ? 0 : sb * sb * 0.5, 0);
    U.uMoonPhase.value = state.moonPhase || 0;
    // rain greys the fog
    if (rain > 0) { fog.x *= 1 - rain * 0.5; fog.y *= 1 - rain * 0.5; fog.z *= 1 - rain * 0.4; }
    if (thunder > 0) fog.multiplyScalar(1 - thunder * 0.5);
    U.uRain.value = rain;
    U.uSky.value.y *= 1 - rain;
    // the fog itself
    if (state.eyeInLava) {
      fog.set(0.6, 0.1, 0); U.uFog.value.set(0.25, 1, 0); U.uSky.value.z = 1;
      this.waterTime = 0;
    } else if (state.eyeInSnow) {
      // your eyes in powder snow: the game's pale blue, closing in from nothing to 2 blocks
      fog.set(0.623, 0.734, 0.785); U.uFog.value.set(0, 2, 0); U.uSky.value.z = 1;
      this.waterTime = 0; this.waterFogSet = false;
    } else if (state.eyeInWater) {
      // under water: the biome's water fog colour, brightening and clearing over the first 30 seconds
      this.waterTime += dt * 20;
      const wt = this.waterTime;
      const vision = wt >= 600 ? 1 : clamp01(wt / 100) * 0.6 + (wt < 100 ? 0 : clamp01((wt - 100) / 500)) * 0.4;
      rgb(WATER_FOG[b && b.name] || 0x050533, this.waterFogTarget);
      if (!this.waterFogSet) { this.waterFog.copy(this.waterFogTarget); this.waterFogSet = true; }
      this.waterFog.lerp(this.waterFogTarget, Math.min(1, dt / 5));
      fog.copy(this.waterFog);
      const m = Math.min(1 / Math.max(fog.x, 1e-3), 1 / Math.max(fog.y, 1e-3), 1 / Math.max(fog.z, 1e-3));
      fog.multiplyScalar((1 - vision) + m * vision);
      let end = 96 * Math.max(0.25, vision);
      if (b && (b.name === 'swamp' || b.name === 'mangrove_swamp')) end *= 0.85;
      U.uFog.value.set(-8, Math.min(end, R), 0);
      U.uSky.value.z = 1;
    } else if ((D && D.foggy) || state.bossFog) {
      // the Nether, and a boss fight's thick fog: a sphere from a twentieth of the distance to half of it
      this.waterTime = 0; this.waterFogSet = false;
      U.uFog.value.set(R * 0.05, Math.min(R, 192) * 0.5, 0);
    } else {
      this.waterTime = 0; this.waterFogSet = false;
      U.uFog.value.set(R - Math.max(4, Math.min(64, R / 10)), R, 1);
    }
    /* Near the bottom of the world the fog fades to black: over the last 32
       blocks above the dimension's floor, squared, and black below it (the
       Overworld from y -32 to -64; heights here are y + 64). Not in the End,
       whose dark sky goes on below its islands as it is. A Superflat world
       (its horizon at the floor) darkens only in its last block, as the game's
       does (its clear colour scale is 1 there, 1/32 elsewhere). */
    const above = (state.eye.y - 64 - (D ? D.minY : -64)) / (state.horizon === 0 ? 1 : 32);
    if (above < 1 && !(D && D.sky === 'end')) fog.multiplyScalar(Math.max(0, above) * Math.max(0, above));
    /* Blindness and Darkness close the fog in, black, as the game's do: Blindness to 5 blocks (from the
       render distance over its last second), Darkness to 15 as it fades in and out (a second or so each
       way); the sky and the clouds go into the fog with them. */
    const shut = Math.max(bl, dk);
    if (shut > 0) {
      const f = bl > 0 ? R + (5 - R) * bl : R + (15 - R) * dk, f0 = bl > 0 ? f * 0.25 : f * 0.75;
      if (f < U.uFog.value.y) U.uFog.value.set(Math.min(f0, U.uFog.value.x), f, 0);
      fog.multiplyScalar(1 - shut);
      if (shut > 0.5) U.uSky.value.z = 1;
    }
    // the eye below sea level (y 63): the dark disc under the horizon (SKY_FS)
    U.uVoidDisc.value = U.uSkyMode.value === 0 && state.eye.y < (state.horizon !== undefined ? state.horizon : 127) ? 1 : 0;
    // clouds: white by day, grey at night
    U.uCloudColor.value.set(daylight * 0.9 + 0.1, daylight * 0.9 + 0.1, daylight * 0.85 + 0.15);
    greyTowards(U.uCloudColor.value, rain * 0.95, 0.6); greyTowards(U.uCloudColor.value, thunder * 0.95, 0.2);
    // and gone at Cloud Distance (Video Settings)
    const reach = (opts.cloudDist || rdc * 2) * 16;
    U.uCloudFog.value.set(Math.min(R, reach * 0.5), reach);
    // (in lava or powder snow the fog closes in within a block or two: no clouds through it)
    this.clouds = (D && !D.clouds) || state.eyeInLava || state.eyeInSnow || shut > 0.5 ? 'off' : opts.clouds || 'fancy';
  }
  /* The game's lightmap as 26.x makes it (its lightmap shader, with the
     numbers from its dimension types and day timeline): the dimension's
     ambient colour (Night Vision's grey if that is brighter), plus the sky
     light's colour times its brightness, plus the block light, dark grey low
     down, tinted the warm #FFD88C in the middle levels and white at the top,
     with the torches' flicker; then the Brightness setting lifts it towards
     notGamma, which keeps each colour's hue. (The old lightmap mixed a grey in
     twice and added the sky in the End, where the game adds none: the End was
     twice as bright as the game's.) */
  makeLightmap(skyF, skyC, amb, gamma, nv, dark = 0) {
    const d = this.lmData;
    const bf = this.flicker + 1.5;
    const bright = L => { const f = L / 15; return f / (4 - 3 * f); };
    const a0 = Math.max(amb[0], nv * 0.6), a1 = Math.max(amb[1], nv * 0.6), a2 = Math.max(amb[2], nv * 0.6);
    for (let i = 0; i < 16; i++) {          // sky
      const s = bright(i) * skyF;
      for (let j = 0; j < 16; j++) {        // block
        const b = bright(j) * bf, m = 0.9 * (2 * j / 15 - 1) ** 2;
        let r = a0 + skyC[1] * s + (BLOCK_TINT[0] + (1 - BLOCK_TINT[0]) * m) * b;
        let g = a1 + skyC[2] * s + (BLOCK_TINT[1] + (1 - BLOCK_TINT[1]) * m) * b;
        let bl = a2 + skyC[3] * s + (BLOCK_TINT[2] + (1 - BLOCK_TINT[2]) * m) * b;
        r = clamp01(r - dark); g = clamp01(g - dark); bl = clamp01(bl - dark);
        const mx = Math.max(r, g, bl);
        if (mx > 0 && gamma > 0) {
          const inv = 1 - mx, k = gamma * ((1 - inv * inv * inv * inv) / mx - 1);
          r += r * k; g += g * k; bl += bl * k;
        }
        const o = (i * 16 + j) * 4;
        d[o] = clamp01(r) * 255; d[o + 1] = clamp01(g) * 255; d[o + 2] = clamp01(bl) * 255; d[o + 3] = 255;
      }
    }
    this.lightmap.needsUpdate = true;
  }

  drawSky(r) { this.skyFS.render(r, null); }

  /* ---- clouds: rebuilt when you cross into another cloud cell (render/clouds.js) ---- */
  drawClouds(r, cam, time) {
    if (this.clouds === 'off') return;
    this.cloudMesh.draw(r, cam, time, this.clouds, this.R.U.uCloudFog.value.y);
  }
}

/* The sunrise and sunset colour and how strong it is, from the game's clock
   (null when the sun is well up or well down). */
function sunriseColour(tod) {
  const f1 = Math.cos(tod * Math.PI * 2);
  if (f1 < -0.4 || f1 > 0.4) return null;
  const f3 = f1 / 0.4 * 0.5 + 0.5;
  let f4 = 1 - (1 - Math.sin(f3 * Math.PI)) * 0.99;
  f4 *= f4;
  return [f3 * 0.3 + 0.7, f3 * f3 * 0.7 + 0.2, 0.2, f4];
}

/* ---- the materials ---- */
export function makeVanillaMaterials(U, o) {
  const base = o && o.rgss ? { RGSS: 1 } : {};
  const mk = (defines, transparent, extra) => new THREE.RawShaderMaterial(Object.assign({
    glslVersion: THREE.GLSL3,
    vertexShader: HEAD + VANILLA + TERRAIN_VS,
    fragmentShader: HEAD + VANILLA + FILTER + TERRAIN_FS,
    uniforms: U, defines: Object.assign({}, base, defines),
    side: defines.CUTOUT ? THREE.DoubleSide : THREE.FrontSide,      // see-through blocks show only their outsides, as the game draws them
    transparent: !!transparent, depthWrite: !transparent,
  }, extra || {}));
  const fluid = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: HEAD + VANILLA + FLUID_VS,
    fragmentShader: HEAD + VANILLA + FLUID_FS,
    uniforms: Object.assign({}, U, { uMeshTime: { value: 0 } }),
    side: THREE.DoubleSide, transparent: true, depthWrite: false,
  });
  return {
    opaque: mk({}), cutout: mk({ CUTOUT: 1 }), translucent: mk({ TRANSLUCENT: 1 }, true),
    handOpaque: mk({ HAND: 1 }, false, { depthFunc: THREE.AlwaysDepth }), handCutout: mk({ HAND: 1, CUTOUT: 1 }, false, { depthFunc: THREE.AlwaysDepth }),
    shadowOpaque: null, shadowCutout: null, fluid,
    // leaves and plants near you: their depth first, then lit only where in front (as Detailed's: materials.js cutoutDepthPass)
    cutoutDepth: mk({ CUTOUT: 1, DEPTH_ONLY: 1 }, false, { colorWrite: false, polygonOffset: true, polygonOffsetFactor: 0.5, polygonOffsetUnits: 2 }),
    cutoutNear: mk({ CUTOUT: 1 }, false, { depthWrite: false }),
  };
}

/* The player model in Fast graphics: its skin, the game's two fixed lights,
   the lightmap where it stands, and the fog. */
export const AVATAR_FS = /* glsl */`
uniform sampler2D uSkin;
uniform vec3 cameraPosition;
uniform vec2 uLightLv;
uniform float uHurt;
in vec3 vWorld; in vec3 vN; in vec2 vUv; flat in int vLayer;
layout(location = 0) out vec4 outColor;
void main() {
  vec4 t = texture(uSkin, vUv);
  if (vLayer == 0 ? !gl_FrontFacing : t.a < 0.1) discard;
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 c = mix(t.rgb, vec3(1.0, 0.0, 0.0), uHurt * 0.3) * entityShade(N) * lightmapAt(uLightLv.x, uLightLv.y);
  outColor = vec4(linearFog(c, fogDistance(vWorld - cameraPosition)), 1.0);
}`;
