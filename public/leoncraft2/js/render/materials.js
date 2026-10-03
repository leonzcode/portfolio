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
   shadow    the same geometry and the same wind, from the sun, into the
             distorted shadow map (leaves alpha tested, so light shafts come
             through their gaps).
--------------------------------------------------------------------------- */
import { COMMON, SHADOW, WIND } from './glsl.js?v=1';
const THREE = window.THREE;

const HEAD = `precision highp float; precision highp int; precision highp sampler2DArray; precision highp sampler2DShadow;\n`;

const TERRAIN_VS = /* glsl */`
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
in vec4 aPos; in vec4 aA; in vec4 aL; in vec4 aC;
out vec3 vWorld; out vec2 vUv; out vec4 vLight; out vec3 vTint; out float vRnd;
flat out float vLayer; flat out int vNormal; flat out int vFlags;
void main() {
  vec3 local = aPos.xyz / 32.0 - vec3(8.0, 0.0, 8.0);
  vec4 world = modelMatrix * vec4(local, 1.0);
  int nw = int(aA.z + 0.5);
  int flags = int(aA.w + 0.5);
  int wave = nw >> 3;
  vec4 L = aL / 255.0;
  world.xyz += windOffset(world.xyz, wave, aA.y / 16.0, L.x, L.w);
  vWorld = world.xyz;
  vUv = aA.xy / 16.0;
  vLayer = aPos.w;
  vNormal = nw & 7;
  vFlags = flags;
  vLight = vec4(L.x, L.y, float(flags & 3) / 3.0, L.z * 15.0);
  vTint = aC.rgb / 255.0;
  vRnd = L.w;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const TERRAIN_FS = /* glsl */`
uniform sampler2DArray uAlbedo, uNormalMap, uSpecMap;
uniform sampler2D uLayerInfo, uAmbient, uNoise;
uniform vec3 cameraPosition;
uniform vec3 uLightDir;
uniform float uFrame, uWet;
uniform mat3 uFaceRot;
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
  if (info.x > 1.5) {
    float f = uTime * 20.0 / max(1.0, info.y);
    float a = mod(floor(f), info.x), b = mod(a + 1.0, info.x);
    return mix(texture(s, vec3(uv, layer + a)), texture(s, vec3(uv, layer + b)), fract(f));
  }
  return texture(s, vec3(uv, layer));
}
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
  float a = texture(uNoise, q * 0.045 + vec2(t * 0.3, t * 0.17)).r;
  float b = texture(uNoise, q * 0.071 - vec2(t * 0.21, -t * 0.26)).g;
  float c = 1.0 - abs(a - b) * 3.2;
  return pow(sat(c), 4.0) * 1.1 + 0.6;
}

void main() {
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
#endif
  vec3 albedo = alb.rgb;
  if (overlay) {
    vec4 ov = texture(uAlbedo, vec3(uv, vLayer + 1.0));
    albedo = mix(albedo, ov.rgb * vTint, ov.a);
  } else if (tinted) albedo *= vTint;
  albedo = toLinear(albedo);
  vec4 nm = tex(uNormalMap, uv, vLayer, info);
  vec4 sp = tex(uSpecMap, uv, vLayer, info);

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

  float sky = vLight.x, block = vLight.y, ao = 0.35 + 0.65 * vLight.z;
  float wd = vLight.w;
  float dist = length(cameraPosition - vWorld);
  vec3 L = uLightDir;
  float NoLg = dot(Ng, L);
  float NoL = dot(N, L);

  // the sun, through the shadow map; none at all deep under cover
  float gate = smoothstep(0.03, 0.2, sky);
  float shadow = 0.0;
  if (gate > 0.0 && (NoLg > 0.0 || plant || sp.b > 0.3)) {
    vec3 sc = shadowCoord(vWorld, Ng, plant ? 1.0 : NoLg, dist);
    shadow = shadowSoft(sc, ign(gl_FragCoord.xy, uFrame), 1.6);
    // past the map, fall back on the light level
    float edge = max(abs(sc.x - 0.5), abs(sc.y - 0.5)) * 2.0;
    shadow = mix(shadow, smoothstep(0.85, 0.95, sky), linstep(0.85, 1.0, edge));
  }
  shadow *= gate;
  vec3 sunC = texelFetch(uAmbient, ivec2(3, 0), 0).rgb;
  vec3 direct = sunC * shadow;

  // under water: light comes through rippling caustics and loses red first
  vec3 absorb = vec3(0.32, 0.12, 0.05);
  if (wd > 0.5) {
    vec3 tr = exp(-absorb * wd);
    direct *= tr * caustics(vWorld);
  }

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
  // block light: a bright core near the torch and a long warm tail
  vec3 torch = vec3(1.0, 0.58, 0.28);
  float bl = pow(block, 5.0) * 2.0 + block * block * 0.1;
  vec3 blockL = torch * bl * ao * 2.2;
  vec3 minimum = vec3(0.0035, 0.004, 0.006) * ao;
  vec3 col = albedo / PI * (diffuse * PI * (metal ? 0.25 : 1.0) + amb + blockL + minimum);

  // specular from the sun
  if (NoL > 0.0 && shadow > 0.0) {
    vec3 H = normalize(V + L);
    float NoV = max(dot(N, V), 1e-3), NoH = sat(dot(N, H)), VoH = sat(dot(V, H));
    vec3 F = F0 + (1.0 - F0) * pow(1.0 - VoH, 5.0);
    float spec = ggx(NoH, rough * rough) * smithV(NoV, NoL, rough * rough);
    col += direct * F * min(spec, 8.0) * NoL;
  }
  // a hint of the sky in shiny things
  if (smoothness > 0.6) {
    float NoV = sat(dot(N, V));
    vec3 F = F0 + (1.0 - F0) * pow(1.0 - NoV, 5.0);
    col += ambientAt(reflect(-V, N)) / PI * F * skyAmt * smoothness * 0.6;
  }
  // light of its own
  col += albedo * emit * 6.0;
#ifdef TRANSLUCENT
  float fres = pow(1.0 - sat(dot(N, V)), 5.0);
  outColor = vec4(col, mix(max(alb.a, 0.35), 1.0, fres * 0.6));
#else
  outColor = vec4(col, 1.0);
#endif
}`;

const SHADOW_VS = /* glsl */`
uniform mat4 modelMatrix, uShadowMat;
in vec4 aPos; in vec4 aA; in vec4 aL;
out vec2 vUv; flat out float vLayer;
const float SHADOW_B = 0.85;
void main() {
  vec4 world = modelMatrix * vec4(aPos.xyz / 32.0 - vec3(8.0, 0.0, 8.0), 1.0);
  int nw = int(aA.z + 0.5);
  vec4 L = aL / 255.0;
  world.xyz += windOffset(world.xyz, nw >> 3, aA.y / 16.0, L.x, L.w);
  vec4 c = uShadowMat * world;
  float f = length(c.xy) * SHADOW_B + (1.0 - SHADOW_B);
  c.xy /= f;
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
  // per layer: how many frames it runs through and how many ticks each
  const data = new Float32Array(256 * 4);
  for (const name in manifest.textures) {
    const t = manifest.textures[name];
    if (t.frames) for (let f = 0; f < t.frames; f++) {
      const i = t.layer + f;
      if (f === 0) { data[i * 4] = t.frames; data[i * 4 + 1] = t.frametime; }
    }
  }
  const tex = new THREE.DataTexture(data, 256, 1, THREE.RGBAFormat, THREE.FloatType);
  tex.needsUpdate = true;
  return tex;
}

export function makeMaterials(shared) {
  const mk = (defines, transparent, extra) => new THREE.RawShaderMaterial(Object.assign({
    glslVersion: THREE.GLSL3,
    vertexShader: HEAD + COMMON + WIND + TERRAIN_VS,
    fragmentShader: HEAD + COMMON + SHADOW + WIND + TERRAIN_FS,
    uniforms: shared, defines,
    side: defines.CUTOUT || defines.TRANSLUCENT ? THREE.DoubleSide : THREE.FrontSide,
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
    handOpaque: mk({}, false, { depthFunc: THREE.AlwaysDepth }), handCutout: mk({ CUTOUT: 1 }, false, { depthFunc: THREE.AlwaysDepth }),
    shadowOpaque: sh({}), shadowCutout: sh({ CUTOUT: 1 }),
  };
}
