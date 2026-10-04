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
import { COMMON } from './glsl.js?v=11';
import { FullScreen, VS_FULL } from './sky.js?v=11';
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
// how the game lights a mob or an item: two fixed lights and 0.4 everywhere
float entityShade(vec3 n) {
  vec3 l0 = normalize(vec3(0.2, 1.0, -0.7)), l1 = normalize(vec3(-0.2, 1.0, 0.7));
  return min(1.0, (max(0.0, dot(l0, n)) + max(0.0, dot(l1, n))) * 0.6 + 0.4);
}
`;

const TERRAIN_VS = /* glsl */`
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
uniform vec3 cameraPosition;
uniform vec2 uLightLv;
layout(location = 0) in vec4 aPos; layout(location = 1) in vec4 aA; layout(location = 2) in vec4 aL; layout(location = 3) in vec4 aC;
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
  gl_Position = projectionMatrix * viewMatrix * world;
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
  // grass and flowers use the full-size texture at any distance (the game's cutout layer has no mipmaps)
  vec4 alb = plant ? textureLod(uAlbedo, vec3(uv, layer), 0.0) : texture(uAlbedo, vec3(uv, layer));
#ifdef CUTOUT
  if (alb.a < (plant ? 0.1 : 0.5)) discard;
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
layout(location = 0) in vec4 aPos; layout(location = 1) in vec4 aA; layout(location = 2) in vec4 aF; layout(location = 3) in vec4 aC;
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
  gl_Position = projectionMatrix * viewMatrix * world;
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
    // the water texture's grain, in this biome's water colour
    c = vec3(dot(t.rgb, vec3(0.299, 0.587, 0.114)) * 1.9) * vCol;
    a = t.a;
  }
  c *= vLight;
  c = linearFog(c, vFogD);
  outColor = vec4(c, a);
}`;

/* ---- the sky: one pass over the whole screen, before the world ---- */
const SKY_FS = COMMON + /* glsl */`
uniform mat4 uInvViewProj;
uniform vec3 uCamPos, uSkyColor, uFogColor, uVSun;
uniform vec4 uSunrise;          // colour and strength of the sunrise fan
uniform vec3 uSky;              // fog end for the sky, star brightness, under a fluid
uniform float uMoonPhase, uRain, uSkyMode;
uniform sampler2D uSunTex, uMoon, uEndSky;
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
    o = vec4(texture(uEndSky, (q * 0.5 + 0.5) * 16.0).rgb * (40.0 / 255.0), 1.0);
    return;
  }
  // the sky plane 16 blocks up, fogged at its corners (the game fogs it per corner of a 512 block fan)
  if (rd.y > 0.0313) {
    float r = 16.0 / max(rd.y, 1e-4) * length(rd.xz);
    float d = 16.0 + min(r, 512.0) * (496.0 / 512.0);
    col = mix(uSkyColor, uFogColor, smoothstep(0.0, uSky.x, d));
  }
  // the sunrise fan, low on the horizon on the sun's side
  if (uSunrise.a > 0.0) {
    vec3 c = normalize(vec3(sign(uVSun.x), 0.0, 0.0));
    float ang = acos(clamp(dot(rd, c), -1.0, 1.0));
    float w = 1.0 - smoothstep(0.0, 0.9, ang);
    w *= smoothstep(-0.25, 0.1, rd.y + 0.15) * (1.0 - smoothstep(0.0, 0.85, rd.y));
    col = mix(col, uSunrise.rgb, sat(w * uSunrise.a));
  }
  // the sun and the moon: squares, added on
  vec3 s = uVSun;
  vec3 u = vec3(0.0, 0.0, 1.0), v = normalize(cross(s, u));
  float ds = dot(rd, s);
  if (ds > 0.0) {
    vec2 q = vec2(dot(rd, u), dot(rd, v)) / ds;
    if (abs(q.x) < 0.15 && abs(q.y) < 0.15) {
      vec4 t = texture(uSunTex, q / 0.3 + 0.5);
      col += t.rgb * t.a * (1.0 - uRain);
    }
  } else {
    vec2 q = vec2(dot(rd, u), dot(rd, v)) / -ds;
    if (abs(q.x) < 0.1 && abs(q.y) < 0.1) {
      vec2 cell = vec2(mod(uMoonPhase, 4.0), floor(uMoonPhase / 4.0));
      vec2 mp = q / 0.2 + 0.5;
      vec4 m = texture(uMoon, vec2((cell.x + mp.x) / 4.0, 1.0 - (cell.y + mp.y) / 2.0));
      col += m.rgb * m.a * (1.0 - uRain);
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
  gl_Position = projectionMatrix * viewMatrix * w;
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
    Object.assign(U, {
      uLightmap: { value: lm }, uFogColor: { value: new THREE.Vector3(0.75, 0.85, 1) }, uFog: { value: new THREE.Vector3(100, 128, 1) },
      uSkyColor: { value: new THREE.Vector3(0.47, 0.65, 1) }, uVSun: { value: new THREE.Vector3(0, 1, 0) },
      uSunrise: { value: new THREE.Vector4() }, uSky: { value: new THREE.Vector3(128, 0, 0) }, uRain: { value: 0 },
      uSunTex: { value: textures.sun || null }, uCloudColor: { value: new THREE.Vector3(1, 1, 1) }, uCloudFog: { value: new THREE.Vector2(128, 256) },
      uFlowLayers: { value: new THREE.Vector2(man.water_flow ? man.water_flow.layer : 0, man.lava_flow ? man.lava_flow.layer : 0) },
      uLightLv: renderer.uHandLight || (renderer.uHandLight = { value: new THREE.Vector2(1, 0) }),
      uConstAmb: { value: 0 }, uSkyMode: { value: 0 }, uEndSky: { value: textures.endSky || null },
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
    // clouds
    this.cloudCells = makeCloudPattern();
    this.cloudKey = '';
    this.cloudGeo = new THREE.BufferGeometry();
    const cu = { uCloudColor: U.uCloudColor, uFogColor: U.uFogColor, uCloudFog: U.uCloudFog };
    const cm = (extra) => new THREE.RawShaderMaterial(Object.assign({ glslVersion: THREE.GLSL3, vertexShader: 'precision highp float;\n' + CLOUD_VS, fragmentShader: 'precision highp float;\n' + CLOUD_FS, uniforms: cu, side: THREE.DoubleSide }, extra));
    // drawn twice: depth first, then colour where it is the nearest cloud, so they never show through each other
    this.cloudDepth = new THREE.Mesh(this.cloudGeo, cm({ colorWrite: false }));
    this.cloudColour = new THREE.Mesh(this.cloudGeo, cm({ transparent: true, depthWrite: false, depthFunc: THREE.LessEqualDepth }));
    this.cloudScene = new THREE.Scene();
    for (const m of [this.cloudDepth, this.cloudColour]) { m.frustumCulled = false; m.matrixAutoUpdate = false; this.cloudScene.add(m); }
    this.cloudColour.renderOrder = 1;
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
    // how bright the sky is, for the lightmap (0.2 at night, 1 by day)
    let dark = 1 - clamp01(cosA * 2 + 0.2);
    // rain and storms dim the sky and its light by the game's own factors (sim/weather.js sets weatherState)
    const wx = this.R.weatherState || {}, rain = wx.rain || 0, thunder = wx.thunder || 0;
    const skyDarken = (1 - dark) * (1 - rain * 5 / 16) * (1 - thunder * 5 / 16) * 0.8 + 0.2;
    const daylight = clamp01(cosA * 2 + 0.5);
    this.flicker += (Math.random() - Math.random()) * Math.random() * Math.random() * 0.1 * Math.min(3, dt * 20);
    this.flicker *= Math.pow(0.9, Math.min(3, dt * 20));
    this.makeLightmap(skyDarken, opts.brightness === undefined ? 0.5 : opts.brightness, D ? D.ambient : 0, !!(D && D.brightLightmap));
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
    // near the bottom of the world the fog fades to black (the other dimensions: within 32 blocks of their floor)
    const above = other ? (state.eye.y - 64 - D.minY) / 32 : (state.eye.y + 64 - 0) / 32;
    if (above < 1) fog.multiplyScalar(Math.max(0, above) * Math.max(0, above));
    // clouds: white by day, grey at night
    U.uCloudColor.value.set(daylight * 0.9 + 0.1, daylight * 0.9 + 0.1, daylight * 0.85 + 0.15);
    greyTowards(U.uCloudColor.value, rain * 0.95, 0.6); greyTowards(U.uCloudColor.value, thunder * 0.95, 0.2);
    U.uCloudFog.value.set(R * 1.0, R * 2.0);
    this.clouds = D && !D.clouds ? 'off' : opts.clouds || 'fancy';
  }
  makeLightmap(skyDarken, gamma, ambient, endBright) {
    const d = this.lmData;
    const f1 = skyDarken * 0.95 + 0.05;
    // sky light leans blue as it dims
    const tr = skyDarken + (1 - skyDarken) * 0.35, tb = 1;
    const f7 = this.flicker + 1.5;
    const bright = L => { const f = L / 15, g = f / (4 - 3 * f); return g + (1 - g) * ambient; };
    const notGamma = x => { const y = 1 - x; return 1 - y * y * y * y; };
    for (let i = 0; i < 16; i++) {          // sky
      const s = bright(i) * f1;
      for (let j = 0; j < 16; j++) {        // block
        const f9 = bright(j) * f7;
        let r = f9, g = f9 * ((f9 * 0.6 + 0.4) * 0.6 + 0.4), bl = f9 * (f9 * f9 * 0.6 + 0.4);
        r += tr * s; g += tr * s; bl += tb * s;
        r += (0.75 - r) * 0.04; g += (0.75 - g) * 0.04; bl += (0.75 - bl) * 0.04;
        // the End: pulled a quarter of the way to (0.99, 1.12, 1.0)
        if (endBright) { r += (0.99 - r) * 0.25; g += (1.12 - g) * 0.25; bl += (1.0 - bl) * 0.25; }
        r = clamp01(r); g = clamp01(g); bl = clamp01(bl);
        r += (notGamma(r) - r) * gamma; g += (notGamma(g) - g) * gamma; bl += (notGamma(bl) - bl) * gamma;
        r += (0.75 - r) * 0.04; g += (0.75 - g) * 0.04; bl += (0.75 - bl) * 0.04;
        const o = (i * 16 + j) * 4;
        d[o] = clamp01(r) * 255; d[o + 1] = clamp01(g) * 255; d[o + 2] = clamp01(bl) * 255; d[o + 3] = 255;
      }
    }
    this.lightmap.needsUpdate = true;
  }

  drawSky(r) { this.skyFS.render(r, null); }

  /* ---- clouds: rebuilt when you cross into another cloud cell ---- */
  drawClouds(r, cam, time) {
    if (this.clouds === 'off') return;
    const H = 192, S = 12;
    const scroll = time * 20 * 0.03;
    const fx = (cam.position.x + scroll) / S, fz = cam.position.z / S;
    const cx = Math.floor(fx), cz = Math.floor(fz);
    const flat = this.clouds === 'fast';
    const R = Math.max(16, Math.ceil(this.R.U.uCloudFog.value.y / S) + 1) + 8;
    const B = this.cloudAt;
    if (!B || B.flat !== flat || B.R !== R || Math.abs(cx - B.cx) > 8 || Math.abs(cz - B.cz) > 8) {
      this.cloudAt = { cx, cz, flat, R };
      this.buildClouds(cx, cz, R, flat);
    }
    // the mesh is laid out in cloud cells round where it was built; slide it with the wind
    const at = this.cloudAt;
    for (const m of [this.cloudDepth, this.cloudColour]) {
      m.position.set(at.cx * S - scroll, H, at.cz * S);
      m.updateMatrix(); m.matrixWorld.copy(m.matrix);
    }
    r.render(this.cloudScene, cam);
  }
  buildClouds(cx, cz, R, flat) {
    const cells = this.cloudCells, S = 12, T = flat ? 0 : 4;
    const on = (x, z) => cells[(((cz + z) & 255) << 8) | ((cx + x) & 255)];
    // counted first, then written straight into typed arrays
    let quads = 0;
    for (let z = -R; z <= R; z++) for (let x = -R; x <= R; x++) {
      if (!on(x, z)) continue;
      quads += flat ? 1 : 2 + !on(x - 1, z) + !on(x + 1, z) + !on(x, z - 1) + !on(x, z + 1);
    }
    const pos = new Float32Array(quads * 18), sh = new Float32Array(quads * 6);
    let n = 0, m = 0;
    const v = (x, y, z) => { pos[n++] = x; pos[n++] = y; pos[n++] = z; };
    const quad = (ax, ay, az, bx, by, bz, cx2, cy, cz2, dx, dy, dz, s) => {
      v(ax, ay, az); v(bx, by, bz); v(cx2, cy, cz2); v(ax, ay, az); v(cx2, cy, cz2); v(dx, dy, dz);
      for (let i = 0; i < 6; i++) sh[m++] = s;
    };
    for (let z = -R; z <= R; z++) for (let x = -R; x <= R; x++) {
      if (!on(x, z)) continue;
      const x0 = x * S, x1 = x0 + S, z0 = z * S, z1 = z0 + S;
      quad(x0, T, z0, x0, T, z1, x1, T, z1, x1, T, z0, 1.0);
      if (flat) continue;
      quad(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1, 0.7);
      if (!on(x - 1, z)) quad(x0, 0, z0, x0, 0, z1, x0, T, z1, x0, T, z0, 0.9);
      if (!on(x + 1, z)) quad(x1, 0, z1, x1, 0, z0, x1, T, z0, x1, T, z1, 0.9);
      if (!on(x, z - 1)) quad(x1, 0, z0, x0, 0, z0, x0, T, z0, x1, T, z0, 0.8);
      if (!on(x, z + 1)) quad(x0, 0, z1, x1, 0, z1, x1, T, z1, x0, T, z1, 0.8);
    }
    const g = this.cloudGeo;
    g.dispose();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('shade', new THREE.BufferAttribute(sh, 1));
    g.setDrawRange(0, quads * 6);
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

/* Our own cloud pattern, 256 x 256 cells that wrap round: soft noise cut at
   a level, so it comes out as the same kind of big blocky drifts with sky
   between them. */
function makeCloudPattern() {
  const N = 256, out = new Uint8Array(N * N);
  const rnd = (x, y, s) => { let h = (x * 374761393 + y * 668265263 + s * 2246822519) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const noise = (x, y, p, s) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const a = rnd(((xi % p) + p) % p, ((yi % p) + p) % p, s), b = rnd((((xi + 1) % p) + p) % p, ((yi % p) + p) % p, s);
    const c = rnd(((xi % p) + p) % p, (((yi + 1) % p) + p) % p, s), d = rnd((((xi + 1) % p) + p) % p, (((yi + 1) % p) + p) % p, s);
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const n = noise(x / 16, y / 16, 16, 1) * 0.55 + noise(x / 6, y / 6, 256 / 6 | 0, 2) * 0.3 + noise(x / 2.5, y / 2.5, 256 / 2.5 | 0, 3) * 0.15;
    out[y * N + x] = n > 0.56 ? 1 : 0;
  }
  return out;
}

/* ---- the materials ---- */
export function makeVanillaMaterials(U) {
  const mk = (defines, transparent, extra) => new THREE.RawShaderMaterial(Object.assign({
    glslVersion: THREE.GLSL3,
    vertexShader: HEAD + VANILLA + TERRAIN_VS,
    fragmentShader: HEAD + VANILLA + TERRAIN_FS,
    uniforms: U, defines: Object.assign({}, defines),
    side: defines.CUTOUT || defines.TRANSLUCENT ? THREE.DoubleSide : THREE.FrontSide,
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
