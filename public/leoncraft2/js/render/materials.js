/* ---------------------------------------------------------------------------
   Leoncraft 2 - the materials the world is drawn with.

   terrain   every block face: albedo, a normal map and a material map from
             the texture arrays; sun (or moon) light through the soft shadow
             map; sky light from the atmosphere, darkened by Minecraft's light
             levels and ambient occlusion; warm block light from torches and
             lava with a steep core and a long tail; light through leaves and
             grass; GGX specular (metals use their albedo); emission for
             glowstone, lava and ore glints; caustics and absorption under
             water; plants and leaves moved by the wind and by you.
   shadow    the same geometry, standing still, from the sun, into the
             distorted shadow map (leaves alpha tested, so light shafts come
             through their gaps).

   Detailed draws the terrain with lighter shaders that light per vertex
   (LEAN_VS / LEAN_FS below); the rest is the full chain's.
--------------------------------------------------------------------------- */
import { COMMON, SHADOW, WIND, TONEMAP, LDR, LIGHTS, FILTER } from './glsl.js?v=107';
const THREE = window.THREE;

const HEAD = `precision highp float; precision highp int; precision highp sampler2DArray; precision highp sampler2DShadow;\n`;

const TERRAIN_VS = /* glsl */`
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
uniform vec3 cameraPosition;
layout(location = 0) in uvec4 aPos; layout(location = 1) in uvec4 aA; layout(location = 2) in uvec4 aL; layout(location = 3) in uvec4 aC;
#define aPos vec4(aPos)
#define aA vec4(aA)
#define aL vec4(aL)
#define aC vec4(aC)
uniform vec3 uChunk;
out vec3 vWorld; out vec2 vUv; out vec4 vLight; out vec3 vTint; out float vRnd;
flat out float vLayer; flat out int vNormal; flat out int vFlags;
void main() {
  vec3 local = aPos.xyz / 32.0 - vec3(8.0, 0.0, 8.0);
  vec4 world = modelMatrix * vec4(local + uChunk, 1.0);
  int nw = int(aA.z + 0.5);
  int flags = int(aA.w + 0.5);
  int wave = nw >> 3;
  vec4 L = aL / 255.0;
  world.xyz += windOffset(world.xyz, wave, aA.y / 16.0, L.x, L.w, aC.w);
  vWorld = world.xyz;
  vUv = aA.xy / 16.0;
  vLayer = aPos.w;
  vNormal = nw & 7;
  vFlags = flags;
  vLight = vec4(L.x, L.y, float(flags & 3) / 3.0, L.z * 15.0);
  vTint = aC.rgb / 255.0;
  vRnd = L.w;
  // (from the eye, never viewMatrix on the place in the world: vanilla.js TERRAIN_VS)
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * (world.xyz - cameraPosition), 1.0);
}`;

const LDR_FN = /* glsl */`
#ifdef LDR
uniform sampler2D uView;
uniform float uEyeInWater;
` + LDR + `
#endif
`;
const TERRAIN_FS = /* glsl */`
uniform sampler2DArray uAlbedo, uNormalMap, uSpecMap;
uniform sampler2D uLayerInfo, uAmbient, uNoise;
uniform vec3 cameraPosition;
uniform vec3 uLightDir;
uniform float uFrame, uWet;
uniform float uAO;              // the corners' shade (Shader Options: Ambient Occlusion)
uniform float uChunkFade;       // a column fading in (Chunk Fade): here a few more of its pixels each frame, the sky behind the rest
uniform mat3 uFaceRot;
uniform float uDim;             // 0 the Overworld, 1 the Nether, 2 the End (js/dims.js)
#define HAS_DIM
uniform vec3 uDimAmb;           // the light everything gets there instead of the sky's
#if defined(REALISM) && !defined(HAND) && !defined(CUTOUT) && !defined(TRANSLUCENT)
#define PUDDLES
/* RIP Computer: wet ground and puddles in the rain, after Photon Shaders' include/surface/rain_puddles.glsl
   (Photon Shaders by SixthSurge, under the Photon Shaders License: shaders/PHOTON-LICENSE.txt): puddles where a
   noise is high on flat open ground, mirror smooth, rippled while it rains (the world and the sky in them are put in
   by the composite, post.js puddleLook, from the mark left in the alpha); everything the rain falls on darker and shinier */
uniform float uRain;            // how hard it is raining here (realism.js)
float rippleHeight(vec2 c) {
  const vec2 d0 = vec2(3.0, 4.0) / 5.0, d1 = vec2(-5.0, -12.0) / 13.0;
  float a = textureLod(uNoise, c * 0.3 + uTime * 0.1 * d0, 0.0).y;
  float b = textureLod(uNoise, c * 0.3 + uTime * 0.1 * d1, 0.0).y;
  return mix(a, b, 0.5);
}
// (ours) raindrops landing in a puddle: a ring spreading from each, in two layers of cells, one drop a cell at a time
vec2 cellRand(vec2 c) { return fract(sin(vec2(dot(c, vec2(127.1, 311.7)), dot(c, vec2(269.5, 183.3)))) * 43758.5453); }
vec2 dropRings(vec2 p) {
  vec2 n = vec2(0.0);
  for (int k = 0; k < 2; k++) {
    vec2 q = p * (k == 0 ? 1.6 : 2.35) + float(k) * 17.3;
    vec2 cell = floor(q), f = fract(q), h = cellRand(cell);
    float t = fract(uTime * (0.8 + h.x * 0.7) + h.y);
    vec2 d = f - (0.3 + 0.4 * cellRand(cell + 5.17));
    float r = length(d), w = (r - t * 0.3) * 22.0;
    if (abs(w) < 3.14159) n += d / max(r, 1e-3) * sin(w) * (1.0 - t) * (1.0 - t);
  }
  return n;
}
#endif
in vec3 vWorld; in vec2 vUv; in vec4 vLight; in vec3 vTint; in float vRnd;
flat in float vLayer; flat in int vNormal; flat in int vFlags;
layout(location = 0) out vec4 outColor;

vec3 ambientAt(vec3 n) {
  vec3 up = texelFetch(uAmbient, ivec2(0, 0), 0).rgb;
  vec3 side = texelFetch(uAmbient, ivec2(1, 0), 0).rgb;
  vec3 down = texelFetch(uAmbient, ivec2(2, 0), 0).rgb;
  return n.y > 0.0 ? mix(side, up, n.y) : mix(side, down, -n.y);
}
// an animated texture moves through its frames, blended so it never jumps
vec4 tex(sampler2DArray s, vec2 uv, float layer, vec4 info) {
  float la = layer, lb = layer, t = 0.0;
  if (info.x > 1.5) {
    float f = uTime * 20.0 / max(1.0, info.y);
    float a = mod(floor(f), info.x);
    la = layer + a; lb = layer + mod(a + 1.0, info.x); t = fract(f);
  }
  vec4 c = texture(s, vec3(uv, la));
  if (t > 0.0) c = mix(c, texture(s, vec3(uv, lb)), t);
  return c;
}
#ifdef PUDDLES
#define puddleK() puddle
#else
#define puddleK() 0.0
#endif
float ggx(float NoH, float a) { float a2 = a * a; float d = NoH * NoH * (a2 - 1.0) + 1.0; return a2 / (PI * d * d); }
float smithV(float NoV, float NoL, float a) {
  float a2 = a * a;
  float gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2), gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
  return 0.5 / max(gv + gl, 1e-5);
}
// caustics: two scrolling layers of light netting, sharpened
float caustics(vec3 p) {
  vec2 q = p.xz - uLightDir.xz / max(uLightDir.y, 0.2) * p.y * 0.2;
  float t = uTime * 0.35;
  float a = textureLod(uNoise, q * 0.045 + vec2(t * 0.3, t * 0.17), 0.0).r;
  float b = textureLod(uNoise, q * 0.071 - vec2(t * 0.21, -t * 0.26), 0.0).g;
  float c = 1.0 - abs(a - b) * 3.2;
  return pow(sat(c), 4.0) * 1.1 + 0.6;
}

void main() {
  if (uChunkFade < 1.0 && ign(gl_FragCoord.xy, uFrame) > uChunkFade) discard;
#ifdef NORMALMAP
  // which way the block light grows across the screen, taken while every pixel still runs together
  vec2 dBlock = vec2(dFdx(vLight.y), dFdy(vLight.y));
  vec3 dWx = dFdx(vWorld), dWy = dFdy(vWorld);
#endif
  int rot = (vFlags >> 2) & 3;
  bool overlay = (vFlags & 16) != 0;
  bool plant = (vFlags & 32) != 0;
  bool tinted = (vFlags & 64) != 0;
  vec4 info = texelFetch(uLayerInfo, ivec2(int(vLayer + 0.5), 0), 0);
  // a texture turned by its variant
  vec2 uv = vUv;
  if (rot == 1) uv = vec2(1.0 - vUv.y, vUv.x);
  else if (rot == 2) uv = vec2(1.0 - vUv.x, 1.0 - vUv.y);
  else if (rot == 3) uv = vec2(vUv.y, 1.0 - vUv.x);
  vec4 alb = tex(uAlbedo, uv, vLayer, info);
#ifdef CUTOUT
  // keep thin leaves and grass blades from vanishing in the distance
  float a = (alb.a - 0.5) / max(fwidth(alb.a), 1e-4) + 0.5;
  if (a < 0.5) discard;
#ifndef HAND
  // a box's face shows from its front only, as the game draws it: two faces back to back (a banner's, a lantern's, two
  // leaves side by side) lay in one place and flickered through each other; sheets and plants (flag 32) show both sides
  if (!gl_FrontFacing && (vFlags & 32) == 0) discard;
#endif
#endif
  vec3 albedo = alb.rgb;
  if (overlay) {
    vec4 ov = texture(uAlbedo, vec3(uv, vLayer + 1.0));
    albedo = mix(albedo, ov.rgb * vTint, ov.a);
  } else if (tinted) albedo *= vTint;
  albedo = toLinear(albedo);
#ifdef NORMALMAP
  vec4 nm = tex(uNormalMap, uv, vLayer, info);
  // the biome's grass, leaves and plants: their bumps kept soft and their hollows not shaded (their
  // normal maps are mostly the texture's noise: at full strength they speckled every lawn a dark olive
  // that matched neither the plants on it nor the grass of Low and Medium)
  if (tinted || overlay || plant) nm = mix(nm, vec4(0.5, 0.5, 1.0, nm.a), 0.75);
#else
  vec4 nm = vec4(0.5, 0.5, 1.0, 0.5);
#endif
  vec4 sp = tex(uSpecMap, uv, vLayer, info);
  // Minecraft's fast leaves: solid blocks, the gaps a dark leafy shade
  if ((vFlags & 128) != 0 && alb.a < 0.5) albedo = toLinear(vTint * 0.42);

  // the face's frame, turned with its texture
  vec3 Ng = uFaceRot * faceN(vNormal), T = uFaceRot * faceT(vNormal), Bt = uFaceRot * faceB(vNormal);
  if (rot == 1) { vec3 t = T; T = -Bt; Bt = t; }
  else if (rot == 2) { T = -T; Bt = -Bt; }
  else if (rot == 3) { vec3 t = T; T = Bt; Bt = -t; }
  vec2 nxy = nm.rg * 2.0 - 1.0;
  vec3 N = normalize(T * nxy.x + Bt * nxy.y + Ng * sqrt(sat(1.0 - dot(nxy, nxy))));
  vec3 V = normalize(cameraPosition - vWorld);
  if (plant) {
    // a blade of grass is lit like the ground it grows from, from either side
    Ng = vec3(0.0, 1.0, 0.0);
    N = normalize(vec3(nxy.x * 0.3, 1.0, nxy.y * 0.3));
  } else if (!gl_FrontFacing) { N = -N; Ng = -Ng; }
#ifdef HAND
  /* what you hold is lit as the game lights it: by the light where you stand, as the top of a block
     there is, times its face's own shade (handShade), never by the sun's angle to it or the shadow
     map. A flat item faces you, side on to a noon sun: it came out half as bright as with the shaders
     off, lit by the sky's blue alone (a golden apple's pale gold went a grey green) */
  float hShade = handShade(vNormal);
  N = Ng = vec3(0.0, 1.0, 0.0);
#endif

  float sky = vLight.x, block = vLight.y, ao = mix(1.0, 0.35 + 0.65 * vLight.z, uAO);
  float wd = vLight.w;
  float dist = length(cameraPosition - vWorld);
  vec3 L = uLightDir;
  float NoLg = dot(Ng, L);
  float NoL = dot(N, L);

  // the sun, through the shadow map; none at all deep under cover
  float gate = smoothstep(0.03, 0.2, sky);
  float shadow = 0.0;
#if SHADOWS > 0 && !defined(HAND)
  if (gate > 0.0 && (NoLg > 0.0 || plant || sp.b > 0.3)) {
    vec3 sc = shadowCoord(vWorld, Ng, plant ? 1.0 : NoLg, dist);
#if SHADOWS > 1
    shadow = shadowSoft(sc, ign(gl_FragCoord.xy, uFrame), uShadowSoft);
#else
    shadow = shadowHard(sc);
#endif
    // past the shadows' reach, fall back on the light level
    shadow = mix(shadow, smoothstep(0.85, 0.95, sky), shadowFade(sc));
  }
#else
  // no shadow map: open sky is sunlit, anything under cover is not (vanilla's way)
  shadow = smoothstep(0.8, 0.95, sky) * (plant ? 1.0 : step(0.0, NoLg));
#endif
  shadow *= gate;
  // and under the clouds as they drift over
  if (shadow > 0.0) shadow *= cloudShade(vWorld, L);
  vec3 sunC = texelFetch(uAmbient, ivec2(3, 0), 0).rgb;
  vec3 direct = sunC * shadow;

  // under water: light comes through rippling caustics and loses red first
  vec3 absorb = vec3(0.32, 0.12, 0.05);
  if (wd > 0.5) {
    vec3 tr = exp(-absorb * wd);
    direct *= tr * caustics(vWorld);
  }

#ifdef PUDDLES
  float puddle = 0.0;
  if (uWet > 0.0 && !plant && uDim < 0.5 && wd < 0.5) {
    // only under the open sky (and not by a torch: under a roof, as Photon tells)
    float open = smoothstep(14.0 / 15.0, 1.0, sky) * (1.0 - block * block * block);
    float wetK = uWet * open * (Ng.y > 0.5 ? 1.0 : 0.45);
    // (fewer on grass, whose blades stand up through the water)
    if (Ng.y > 0.99) puddle = smoothstep(0.56, 0.64, textureLod(uNoise, vWorld.xz * 0.025, 0.0).a) * uWet * open * (tinted ? 0.55 : 1.0);
    albedo *= 1.0 - 0.42 * wetK;
    albedo *= 1.0 - 0.55 * puddle;
    sp.r = mix(sp.r, max(sp.r, 0.74), wetK);
    if (puddle > 0.0) {
      sp.r = mix(sp.r, 0.995, puddle); sp.g = max(sp.g, 0.02);
      // the rain's ripples on them (Photon's three taps of a scrolling noise)
      const float h = 0.1;
      float r0 = rippleHeight(vWorld.xz), r1 = rippleHeight(vWorld.xz + vec2(h, 0.0)), r2 = rippleHeight(vWorld.xz + vec2(0.0, h));
      vec3 rn = vec3(r1 - r0, r2 - r0, h);
      rn.xy *= 0.05 * smoothstep(0.0, 0.1, abs(dot(Ng, -V)));
      rn = normalize(rn).xzy;
      vec2 ring = dropRings(vWorld.xz) * uRain;
      rn = normalize(rn + vec3(ring.x, 0.0, ring.y) * 0.45);
      N = normalize(mix(N, Ng, puddle));
      N = normalize(mix(N, rn, puddle * max(uRain, 0.15)));
      NoL = dot(N, L);
    }
  }
#endif
  float smoothness = sp.r, f0r = sp.g, sss = sp.b, emit = sp.a;
  float rough = max(0.03, sqr(1.0 - smoothness));
  bool metal = f0r > 0.89;
  vec3 F0 = metal ? albedo : vec3(f0r);

  // diffuse: sun, the leaves' glow when the sun is behind them, sky, block light
  float wrap = plant ? sat(NoL * 0.5 + 0.5) : sat(NoL);
  vec3 diffuse = direct * wrap;
  if (sss > 0.0) {
    float back = pow(sat(dot(-V, L)), 6.0) * 2.4 + 0.35;
    diffuse += direct * sss * back * 0.6;
  }
  float skyAmt = sky * sky;
  vec3 amb = ambientAt(N);
  amb = mix(amb, vec3(lum(amb)), 0.22);
  // light bounced off sunlit ground into the shade: warm, from every side
  amb += sunC * 0.03;
  amb *= skyAmt * ao * (0.6 + 0.4 * nm.b);
  if (wd > 0.5) amb *= exp(-absorb * wd * 0.7);
  // block light: a bright core near the torch and a long warm tail, and the
  // light in your hand on top (the brighter of the two, as Dynamic Lights does)
  block = max(block, heldLight(vWorld, N));
#ifdef NORMALMAP
  // the directional lightmap (Glimmer, MIT, Copyright (c) 2024 Josh Britain,
  // after a snippet by NinjaMike): bumps turned towards where the light grows
  // catch a little more of it, bumps turned away a little less
  if (dot(dBlock, dBlock) > 1e-8 && block > 0.0) {
    vec3 bdir = normalize(dWx * dBlock.x + dWy * dBlock.y);
    block = sat(block + clamp((dot(bdir, N) - dot(bdir, Ng)) * block, -1.0, 1.0) * 0.25);
  }
#endif
  if (uDim > 0.5) {
    // no sun or moon in the other dimensions: the Nether's even ambient light, the End's dim sky light
    diffuse = vec3(0.0); shadow = 0.0;
    amb = uDimAmb * ao * (uDim < 1.5 ? 1.0 : 0.3 + 0.7 * skyAmt);
  }
  vec3 blockL = block > 0.0 ? blockLight(block, uDim > 0.5 ? 0.0 : skyAmt * sat(lum(sunC) * 0.3)) * ao : vec3(0.0);
  vec3 minimum = (lightFloor() + fullbrightFill(diffuse * PI * (metal ? 0.25 : 1.0) + amb + blockL)) * ao;
#ifdef HAND
  // (and no shine: the game's held things have none, so a gold or iron block is as bright as its picture)
  vec3 col = albedo / PI * (diffuse * PI + amb + blockL + minimum) * hShade;
#else
  vec3 col = albedo / PI * (diffuse * PI * (metal ? 0.25 : 1.0) + amb + blockL + minimum);

  // specular from the sun
  if (NoL > 0.0 && shadow > 0.0) {
    vec3 H = normalize(V + L);
    float NoV = max(dot(N, V), 1e-3), NoH = sat(dot(N, H)), VoH = sat(dot(V, H));
    vec3 F = F0 + (1.0 - F0) * pow(1.0 - VoH, 5.0);
    float spec = ggx(NoH, rough * rough) * smithV(NoV, NoL, rough * rough);
    col += direct * F * min(spec, 8.0) * NoL;
  }
  // a hint of the sky in shiny things (not in the Nether or the End: the table is the Overworld's sky, and
  // the End's obsidian pillars came out sky blue, then ruled with bright lines down their edges)
  if (smoothness > 0.6 && uDim < 0.5) {
    float NoV = sat(dot(N, V));
    vec3 F = F0 + (1.0 - F0) * pow(1.0 - NoV, 5.0);
    col += ambientAt(reflect(-V, N)) / PI * F * skyAmt * smoothness * 0.6 * (1.0 - puddleK());
  }
#endif
  // light of its own
  col += albedo * emit * 6.0;
#ifdef LDR
  col = finishLDR(col, vWorld);
#endif
#ifdef TRANSLUCENT
  float fres = pow(1.0 - sat(dot(N, V)), 5.0);
  outColor = vec4(col, mix(max(alb.a, 0.35), 1.0, fres * 0.6));
#elif defined(PUDDLES)
  // (a puddle is marked in the alpha, 1 to 1.45: the composite puts the world and the sky in it, post.js puddleLook)
  outColor = vec4(col, 1.0 + 0.45 * puddle);
#else
  outColor = vec4(col, 1.0);
#endif
}`;

/* a held thing's face shade, the game's for each side of a block (as Fast's faceShade, render/vanilla.js):
   the top full, the bottom half, north and south 0.8, east and west 0.6, by the face in the item's own space */
const HAND_SHADE = /* glsl */`
#ifdef HAND
float handShade(int f) { return f == 2 ? 1.0 : f == 3 ? 0.5 : f >= 4 ? 0.8 : 0.6; }
#endif
`;

/* ---- Detailed's terrain: the light worked out per vertex ----
   Everything that is the same across a block face (or changes smoothly over
   it) is worked out at its corners, as Minecraft itself lights a block: the
   sky's light and the torches' by their levels and the corner shade, the
   sun or moon on that side (and the glow through leaves and grass with the
   sun behind them), the exposure and the fog. A pixel then only reads its
   texture, looks up the shadow map and runs the tone curve, so Detailed
   costs little more than Fast. No shine on blocks (the water has its own);
   what glows (torch flames, glowstone, lanterns) reads the material map, and
   only on those textures (uLayerMat, worked out once from the map itself). */
const LEAN_VS = /* glsl */`
uniform mat4 modelMatrix, viewMatrix, projectionMatrix, uShadowMat;
uniform mat3 uFaceRot;
uniform vec3 cameraPosition, uLightDir, uDimAmb;
uniform sampler2D uAmbient, uLayerMat, uView, uNoise;
uniform float uEyeInWater;
// the light table's values for this frame, from the CPU (sky.js readLight, renderer.js):
// sky light from above, the side and below (greyed a little, the sun's bounce in), the sun or moon,
// and how much daylight washes out torch light
uniform vec3 uAmbUp, uAmbSide, uAmbDown, uSunC;
uniform float uDayK;
uniform float uAO;          // the corners' shade (Shader Options: Ambient Occlusion)
uniform float uChunkFade;   // a column fading in (Chunk Fade)
uniform vec4 uShadowEye;    // the shadow map's texel size in blocks (w; glsl.js SHADOW)
layout(location = 0) in uvec4 aPos; layout(location = 1) in uvec4 aA; layout(location = 2) in uvec4 aL; layout(location = 3) in uvec4 aC;
#define aPos vec4(aPos)
#define aA vec4(aA)
#define aL vec4(aL)
#define aC vec4(aC)
uniform vec3 uChunk;
` + LDR + LIGHTS + HAND_SHADE + /* glsl */`
out vec2 vUv; out vec3 vTint;
out vec3 vAmb;       // sky, torch and held light (exposure and fog in)
out vec3 vSun;       // the sun or moon on the face, its angle and the glow through leaves in (a two-sided face: before its side's share)
out vec4 vShadowP;   // the point in the light's view, nudged off the face (xyz), and the light level's guess past the map (w; 2 more under water)
out vec4 vFog;       // the fog's own light (rgb), and how bright what glows is (a, 0 for most textures)
#if defined(CUTOUT) || defined(TRANSLUCENT)
// a face seen from both sides: the sun's share on the front and on the back, and the nudge (the back is nudged the other way)
out vec2 vK; out vec3 vShadowO;
#endif
#ifdef TRANSLUCENT
out float vFres;
#endif
flat out vec3 vLayers; flat out int vFlags;
vec3 ambientAt(vec3 n) { return n.y > 0.0 ? mix(uAmbSide, uAmbUp, n.y) : mix(uAmbSide, uAmbDown, -n.y); }
void main() {
  vec4 world = modelMatrix * vec4(aPos.xyz / 32.0 - vec3(8.0, 0.0, 8.0) + uChunk, 1.0);
  int nw = int(aA.z + 0.5);
  int flags = int(aA.w + 0.5);
  vec4 L = aL / 255.0;
  world.xyz += windOffset(world.xyz, nw >> 3, aA.y / 16.0, L.x, L.w, aC.w);
  // (from the eye, never viewMatrix on the place in the world: vanilla.js TERRAIN_VS)
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * (world.xyz - cameraPosition), 1.0);
  vUv = aA.xy / 16.0;
  vFlags = flags;
  vTint = aC.rgb / 255.0;
  // what the texture is made of (uLayerMat: see LAYER_MAT_FS), and its frames: an animated one blends from one into the next
  int il = int(aPos.w + 0.5);
  vec4 mat = texelFetch(uLayerMat, ivec2(il & 255, il >> 8), 0);
  float frames = floor(mat.b * 255.0 + 0.5);
  vLayers = vec3(aPos.w, aPos.w, 0.0);
  if (frames > 1.5) {
    float f = uTime * 20.0 / max(1.0, floor(mat.a * 255.0 + 0.5));
    float a = mod(floor(f), frames);
    vLayers = vec3(aPos.w + a, aPos.w + mod(a + 1.0, frames), fract(f));
  }
#ifdef DEPTH_ONLY
  // the cut-out blocks' depth pass (cutoutDepthPass below): where the face is and its texture, nothing else
  return;
#endif

  bool plant = (flags & 32) != 0;
  vec3 Ng = plant ? vec3(0.0, 1.0, 0.0) : uFaceRot * faceN(nw & 7);
#ifdef HAND
  // what you hold: lit as the top of a block where you stand, times its face's own shade (as TERRAIN_FS)
  float hShade = handShade(nw & 7);
  Ng = vec3(0.0, 1.0, 0.0);
#endif
  float sky = L.x, block = L.y, ao = mix(1.0, 0.35 + 0.65 * float(flags & 3) / 3.0, uAO), wd = L.z * 15.0;
  vec3 toEye = cameraPosition - world.xyz;
  float dist = length(toEye);
  vec3 V = toEye / max(dist, 1e-4);
  vec3 Lt = uLightDir;
  vec3 sun = uSunC * smoothstep(0.03, 0.2, sky);
  // the glow through leaves and grass, strongest looking into the sun
  float sss = mat.r, glow = 0.0;
  if (sss > 0.0) { float b = sat(dot(-V, Lt)), b2 = b * b; glow = (b2 * b2 * b2 * 2.4 + 0.35) * sss * 0.6; }
  float skyAmt = sky * sky;
  vec3 amb = ambientAt(Ng) * (skyAmt * ao);
  // under water: light loses red first on its way down
  bool wet = wd > 0.5;
  if (wet) {
    vec3 absorb = vec3(0.32, 0.12, 0.05);
    sun *= exp(-absorb * wd);
    amb *= exp(-absorb * wd * 0.7);
  }
  // block light, and the light in your hand on top (the brighter of the two)
  block = max(block, heldLight(world.xyz, Ng));
  if (uDim > 0.5) {
    // no sun or moon in the other dimensions: the Nether's even light, the End's dim sky light
    sun = vec3(0.0);
    amb = uDimAmb * ao * (uDim < 1.5 ? 1.0 : 0.3 + 0.7 * skyAmt);
  }
  vec3 blockL = block > 0.0 ? blockLight(block, uDim > 0.5 ? 0.0 : skyAmt * uDayK) * ao : vec3(0.0);
  vec3 keep, add;
  fogTerms(world.xyz, keep, add);
  // Chunk Fade: a column just come into the world fades in from the fog's colour
  // (in the Nether and the End from their own fog colour: the sky's fog table is left as the Overworld had it)
  if (uChunkFade < 1.0) { keep *= uChunkFade; add = mix((uDim > 0.5 ? uDimFog : fogColour(normalize(world.xyz - cameraPosition))) * uExpo, add, uChunkFade); }
  // (Fullbright fills up to its light what the sun or moon, unshadowed, the sky and torches leave: glsl.js)
  vAmb = (amb + blockL + (lightFloor() + fullbrightFill(sun * PI * (plant ? 1.0 : sat(dot(Ng, Lt))) + amb + blockL)) * ao) / PI * keep;
  vFog = vec4(add, mat.g > 0.0 ? 6.0 * dot(keep, vec3(1.0 / 3.0)) : 0.0);
  // how much of the sun the face takes: its angle to the light (a plant's from straight up, softened,
  // the same from either side) and the glow. A face is flat, so this is the same all over it
  // and never needs working out per pixel.
  float NoL = plant ? 1.0 : dot(Ng, Lt);
  float kF = (plant ? sat(Lt.y * 0.5 + 0.5) : sat(NoL)) + glow;
  // the shadow map's view of this point, nudged off the face (straight, so it is the same at every pixel between the corners)
  vec4 c = uShadowMat * world;
  // (glsl.js shadowNudge: a texel or two, more the more the face turns from the light)
  vec3 off = mat3(uShadowMat) * (Ng * uShadowEye.w * (0.6 + 1.4 * (1.0 - sat(plant ? 1.0 : NoL))));
  vShadowP = vec4(c.xyz + off, smoothstep(0.85, 0.95, sky) + (wet ? 2.0 : 0.0));
#if defined(CUTOUT) || defined(TRANSLUCENT)
  vSun = sun * keep;
  vK = vec2(kF, plant ? kF : sat(-NoL) + glow);
  vShadowO = plant ? vec3(0.0) : off;
#else
  vSun = sun * keep * kF;
#endif
#ifdef TRANSLUCENT
  vFres = pow(1.0 - abs(dot(Ng, V)), 5.0);
#endif
#ifdef HAND
  vAmb *= hShade; vSun *= hShade;
#endif
}`;
const LEAN_FS = /* glsl */`
uniform sampler2DArray uAlbedo, uSpecMap;
uniform sampler2DShadow uBodyShadow;
uniform sampler2D uNoise;
uniform vec4 uBody;
uniform vec3 uLightDir;
uniform mat3 uFaceRot;
uniform mat4 uShadowInv;     // back from the shadow map's view to the world
uniform float uTime;
in vec2 vUv; in vec3 vTint; in vec3 vAmb; in vec3 vSun; in vec4 vShadowP; in vec4 vFog;
#if defined(CUTOUT) || defined(TRANSLUCENT)
in vec2 vK; in vec3 vShadowO;
#endif
#ifdef TRANSLUCENT
in float vFres;
#endif
flat in vec3 vLayers; flat in int vFlags;
layout(location = 0) out vec4 outColor;
// caustics under water: two scrolling layers of light netting, sharpened
float caustics(vec3 p) {
  vec2 q = p.xz - uLightDir.xz / max(uLightDir.y, 0.2) * p.y * 0.2;
  float t = uTime * 0.35;
  float a = textureLod(uNoise, q * 0.045 + vec2(t * 0.3, t * 0.17), 0.0).r;
  float b = textureLod(uNoise, q * 0.071 - vec2(t * 0.21, -t * 0.26), 0.0).g;
  float c = 1.0 - abs(a - b) * 3.2;
  return pow(sat(c), 4.0) * 1.1 + 0.6;
}
void main() {
  int rot = (vFlags >> 2) & 3;
  bool overlay = (vFlags & 16) != 0;
  bool plant = (vFlags & 32) != 0;
  bool tinted = (vFlags & 64) != 0;
  // a texture turned by its variant
  vec2 uv = vUv;
  if (rot == 1) uv = vec2(1.0 - vUv.y, vUv.x);
  else if (rot == 2) uv = vec2(1.0 - vUv.x, 1.0 - vUv.y);
  else if (rot == 3) uv = vec2(vUv.y, 1.0 - vUv.x);
  vec4 alb = texFiltered(uAlbedo, vec3(uv, vLayers.x));
  if (vLayers.z > 0.0) alb = mix(alb, texFiltered(uAlbedo, vec3(uv, vLayers.y)), vLayers.z);
#ifdef CUTOUT
  // keep thin leaves and grass blades from vanishing in the distance
  float a = (alb.a - 0.5) / max(fwidth(alb.a), 1e-4) + 0.5;
  if (a < 0.5) discard;
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
  vec3 albedo = alb.rgb;
  if (overlay) {
    vec4 ov = texture(uAlbedo, vec3(uv, vLayers.x + 1.0));
    albedo = mix(albedo, ov.rgb * vTint, ov.a);
  } else if (tinted) albedo *= vTint;
  // Minecraft's fast leaves: solid blocks, the gaps a dark leafy shade
  if ((vFlags & 128) != 0 && alb.a < 0.5) albedo = vTint * 0.42;
  albedo = toLinear(albedo);

  vec3 light = vAmb;
  // the sun, through the shadow map, on the side of the face that is showing
  // (its angle and the glow were worked out at the corners: LEAN_VS)
#if defined(CUTOUT) || defined(TRANSLUCENT)
  bool front = plant || gl_FrontFacing;
  vec3 sun = vSun * (front ? vK.x : vK.y);
#else
  vec3 sun = vSun;
#endif
  if (sun.r + sun.g + sun.b > 0.0) {
    vec3 raw = vShadowP.xyz;
#if defined(CUTOUT) || defined(TRANSLUCENT)
    if (!front) raw -= 2.0 * vShadowO;
#endif
    vec3 sc = vec3(raw.xy, raw.z * 0.2) * 0.5 + 0.5;
    bool wet = vShadowP.w > 1.5;
    float guess = wet ? vShadowP.w - 2.0 : vShadowP.w;
    float reach = shadowReach(raw.xy);
#ifdef HAND
    // (what you hold goes by the light level: it is in neither the world's shadow map nor your body's)
    float shadow = guess;
#elif SHADOWS > 1
    // the soft taps within a quarter of the shadow distance of you, where a shadow's edge is big
    // enough to see how soft it is; one further out (it blends four texels by itself)
    float shadow = reach < 0.25 ? shadowSoft(sc, 0.0, uShadowSoft) : shadowHard(sc);
#elif SHADOWS > 0
    float shadow = shadowHard(sc);
#else
    float shadow = guess;
#endif
#ifndef HAND
    // past the shadows' reach, the light level's guess
    shadow = mix(shadow, guess, linstep(0.82, 1.0, reach));
    // your own body, from its small map round where you stand (render/shadows.js)
    if (uBody.w > 0.0) {
      vec2 b = raw.xy * uBody.x + uBody.yz;
      if (abs(b.x) < 1.0 && abs(b.y) < 1.0) shadow = min(shadow, textureLod(uBodyShadow, vec3(b * 0.5 + 0.5, raw.z * 0.1 + 0.5), 0.0));
    }
#endif
    if (wet && shadow > 0.0) shadow *= caustics((uShadowInv * vec4(raw, 1.0)).xyz);
    light += sun * shadow;
  }
  vec3 col = albedo * light;
  // light of its own: torch flames, glowstone, lanterns (the material map's emission)
  if (vFog.a > 0.0) col += albedo * texture(uSpecMap, vec3(uv, vLayers.x)).a * vFog.a;
  col = toneLDR(col + vFog.rgb);
#ifdef TRANSLUCENT
  outColor = vec4(col, mix(max(alb.a, 0.35), 1.0, vFres * 0.6));
#else
  outColor = vec4(col, 1.0);
#endif
}`;

/* What each texture layer is made of, from the material map itself: how
   much light comes through it (r, its subsurface value) and whether any of
   it glows (g); and with it, from the layer table, how many frames it runs
   through (b) and how many ticks each (a), so a vertex reads one pixel. One
   pixel a layer, 256 to a row, worked out once on the graphics card after
   the textures are in. */
const LAYER_MAT_FS = /* glsl */`
uniform sampler2DArray uSpecMap;
uniform sampler2D uLayerInfo;
uniform float uLayers;
out vec4 o;
void main() {
  int layer = int(gl_FragCoord.y) * 256 + int(gl_FragCoord.x);
  if (float(layer) >= uLayers) { o = vec4(0.0); return; }
  float sss = 0.0, emit = 0.0;
  for (int y = 0; y < 16; y++) for (int x = 0; x < 16; x++) {
    vec4 s = texelFetch(uSpecMap, ivec3(x, y, layer), 0);
    sss = max(sss, s.b); emit = max(emit, s.a);
  }
  vec4 info = layer < textureSize(uLayerInfo, 0).x ? texelFetch(uLayerInfo, ivec2(layer, 0), 0) : vec4(0.0);
  o = vec4(sss, emit > 0.02 ? 1.0 : 0.0, min(info.x, 255.0) / 255.0, min(info.y, 255.0) / 255.0);
}`;
// its shader, made apart so it can be built in the background before it is first wanted (render/looks.js)
export function layerMatMaterial(specTex, layerInfo) {
  const layers = specTex && specTex.image ? specTex.image.depth : 0;
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: 'precision highp float;\nin vec3 position;\nvoid main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'precision highp float; precision highp int; precision highp sampler2DArray;\n' + LAYER_MAT_FS,
    uniforms: { uSpecMap: { value: specTex }, uLayerInfo: { value: layerInfo }, uLayers: { value: layers } }, depthTest: false, depthWrite: false,
  });
}
export function bakeLayerMaterials(r, specTex, layerInfo, built) {
  const layers = specTex && specTex.image ? specTex.image.depth : 0;
  const rows = Math.max(1, Math.ceil(layers / 256));
  const rt = new THREE.WebGLRenderTarget(256, rows, { type: THREE.UnsignedByteType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
  const mat = built || layerMatMaterial(specTex, layerInfo);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const prev = r.getRenderTarget();
  r.setRenderTarget(rt);
  r.render(scene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
  r.setRenderTarget(prev);
  geo.dispose(); mat.dispose();
  return rt.texture;
}

const SHADOW_VS = /* glsl */`
// (uShadowDraw: the view of the map being drawn, which is not the one the shaders read until it is done)
uniform mat4 modelMatrix, uShadowDraw;
layout(location = 0) in uvec4 aPos; layout(location = 1) in uvec4 aA; layout(location = 2) in uvec4 aL;
#define aPos vec4(aPos)
#define aA vec4(aA)
#define aL vec4(aL)
uniform vec3 uChunk;
out vec2 vUv; flat out float vLayer;
void main() {
  // still: the map is kept for many frames, so leaves caught mid-sway would jump each time it is drawn again
  vec4 world = modelMatrix * vec4(aPos.xyz / 32.0 - vec3(8.0, 0.0, 8.0) + uChunk, 1.0);
  vec4 c = uShadowDraw * world;
  c.z *= 0.2;
  vUv = aA.xy / 16.0;
  vLayer = aPos.w;
  gl_Position = c;
}`;
const SHADOW_FS = /* glsl */`
uniform sampler2DArray uAlbedo;
in vec2 vUv; flat in float vLayer;
out vec4 o;
void main() {
#ifdef CUTOUT
  if (texture(uAlbedo, vec3(vUv, vLayer)).a < 0.5) discard;
#endif
  o = vec4(1.0);
}`;

export function makeLayerInfo(manifest) {
  // per layer: how many frames it runs through and how many ticks each (one texel a layer, however many there are)
  const W = Math.max(256, manifest.layers || 0);
  const data = new Float32Array(W * 4);
  for (const name in manifest.textures) {
    const t = manifest.textures[name];
    if (t.frames && t.layer < W) { data[t.layer * 4] = t.frames; data[t.layer * 4 + 1] = t.frametime || 1; }
  }
  const tex = new THREE.DataTexture(data, W, 1, THREE.RGBAFormat, THREE.FloatType);
  tex.needsUpdate = true;
  return tex;
}

// cloud shadows: one noise tap on the cheapest tier, two elsewhere, at the
// height of the clouds that tier draws (the flat layer, or the middle of the marched one)
export function lightDefines(q) {
  q = q || {};
  const cheap = q.ldr && !q.shadows;
  // (and how many taps a soft shadow takes: glsl.js shadowSoft)
  return { CLOUD_SHADOW: q.cloudShadow !== undefined ? q.cloudShadow : cheap ? 1 : 2, CLOUD_Y: q.ldr ? '250.0' : '265.0', SHADOW_TAPS: q.shadowTaps || 4 };
}

export function makeMaterials(shared, q) {
  q = q || {};
  const base = { SHADOWS: q.shadows === undefined ? 2 : q.shadows };
  if (q.normals !== false) base.NORMALMAP = 1;
  // no plants or leaves moving: the wind is left out of the shaders altogether; Texture Filtering: RGSS
  if (q.wind === false) base.NO_WIND = 1;
  if (q.rgss) base.RGSS = 1;
  if (q.ldr) { base.LDR = 1; base.TONE_LUT = 1; }
  // RIP Computer's puddles and wet ground (the full chain only)
  if (q.realism && !q.ldr) base.REALISM = 1;
  Object.assign(base, lightDefines(q));
  // Detailed (one pass to the screen) lights per vertex; the full chain per pixel
  const vs = q.ldr ? HEAD + COMMON + WIND + TONEMAP + LEAN_VS : HEAD + COMMON + WIND + TERRAIN_VS;
  const fs = q.ldr ? HEAD + COMMON + SHADOW + TONEMAP + FILTER + LEAN_FS : HEAD + COMMON + SHADOW + WIND + TONEMAP + TERRAIN_FS.replace('void main() {', LDR_FN + LIGHTS + HAND_SHADE + '\nvoid main() {');
  const mk = (defines, transparent, extra) => new THREE.RawShaderMaterial(Object.assign({
    glslVersion: THREE.GLSL3,
    vertexShader: vs,
    fragmentShader: fs,
    uniforms: shared, defines: Object.assign({}, base, defines),
    side: defines.CUTOUT ? THREE.DoubleSide : THREE.FrontSide,      // see-through blocks show only their outsides, as the game draws them
    transparent: !!transparent, depthWrite: !transparent,
  }, extra || {}));
  const sh = defines => new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: HEAD + COMMON + WIND + SHADOW_VS,
    fragmentShader: HEAD + SHADOW_FS,
    uniforms: shared, defines, side: THREE.DoubleSide,
  });
  return {
    opaque: mk({}), cutout: mk({ CUTOUT: 1 }), translucent: mk({ TRANSLUCENT: 1 }, true),
    // the held block: drawn over whatever it is pushed into, keeping its own depth
    handOpaque: mk({ HAND: 1 }, false, { depthFunc: THREE.AlwaysDepth }), handCutout: mk({ HAND: 1, CUTOUT: 1 }, false, { depthFunc: THREE.AlwaysDepth }),
    shadowOpaque: sh({}), shadowCutout: sh({ CUTOUT: 1 }),
    // Detailed: cut-out blocks near you, their depth drawn first and then lit where in front (see cutoutDepthPass)
    cutoutDepth: q.ldr ? cutoutDepthPass(mk) : null,
    cutoutNear: q.ldr ? mk({ CUTOUT: 1 }, false, { depthWrite: false }) : null,
  };
}

/* Leaves, grass and the like are cut out of their textures (a pixel is kept or
   thrown away), and a shader that can throw a pixel away stops the graphics
   card skipping pixels hidden behind ones already drawn: every layer of a
   canopy was lit in full, shadows and all, and then mostly covered (in a
   forest that was two thirds of the frame). So they are drawn twice: first
   only their depth, with a shader that does nothing but the cut, then with the
   full shader against that depth, testing it but not writing it, so only the
   face in front at each pixel is lit. The first pass sits a hair further back
   (polygon offset), so the second always finds its own face there. */
function cutoutDepthPass(mk) {
  return mk({ CUTOUT: 1, DEPTH_ONLY: 1 }, false, { colorWrite: false, polygonOffset: true, polygonOffsetFactor: 0.5, polygonOffsetUnits: 2 });
}
