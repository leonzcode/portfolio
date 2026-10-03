/* ---------------------------------------------------------------------------
   Leoncraft 2 - water and lava.

   Water, from above:
     waves       a sum of sharpened sine waves turned by the golden angle and
                 warped by noise; in flowing water they all run downstream
                 and the surface streams along with them
     ripples     from the interaction map: wading, swimming, splashing in
     reflection  screen-space: a ray marched through the depth of what is
                 already drawn; where it finds nothing, the real sky in that
                 direction (from the atmosphere), and the sun's glint
     refraction  what is under the surface, bent by the waves, fading into
                 the biome's water colour with depth (Beer-Lambert)
     foam        where it runs shallow onto the shore, and on falling water
   From below: Snell's window - the sky through a circle overhead, the
   underside of the surface mirroring the water around it.

   Lava: its own animated texture streaming along the flow, glowing.
--------------------------------------------------------------------------- */
import { COMMON, SHADOW, WIND, WAVES, TONEMAP, LDR, LIGHTS } from './glsl.js?v=7';
import { lightDefines } from './materials.js?v=7';
const THREE = window.THREE;
const HEAD = `precision highp float; precision highp int; precision highp sampler2DArray; precision highp sampler2DShadow;\n`;

const VS = /* glsl */`
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
uniform float uMeshTime, uClock;
in vec4 aPos; in vec4 aA; in vec4 aF; in vec4 aC;
out vec3 vWorld; out vec4 vLight; out vec2 vFlow; out vec4 vCol; out float vFoam;
flat out int vNormal; flat out int vFlags; flat out float vLayer;
void main() {
  vec4 world = modelMatrix * vec4(aPos.xyz / 32.0 - vec3(8.0, 0.0, 8.0), 1.0);
  // from where the surface was before the flow last moved, to where it is now
  world.y += aF.z / 32.0 * (1.0 - smoothstep(0.0, 0.32, uClock - uMeshTime));
  int flags = int(aA.y + 0.5);
  float sky = aA.z / 255.0;
  vFlow = aF.xy / 127.0;
  // the surface rises and falls a little with the swell, and with the ripples
  if ((flags & 4) != 0 && (flags & 2) == 0) {
    float sw = sin(world.x * 0.35 + uTime * 1.4) * cos(world.z * 0.31 - uTime * 1.1) * 0.025;
    vec2 iuv = (world.xz - uInteractRect.xy) / uInteractRect.zw;
    float rip = (iuv.x > 0.0 && iuv.y > 0.0 && iuv.x < 1.0 && iuv.y < 1.0) ? textureLod(uInteract, iuv, 0.0).r : 0.0;
    world.y += (sw * (0.3 + 0.7 * sky) + rip * 0.12) - 0.035;
  }
  vWorld = world.xyz;
  vNormal = int(aA.x + 0.5);
  vFlags = flags;
  vLight = vec4(sky, aA.w / 255.0, 0.0, 0.0);
  vCol = aC / 255.0;
  vLayer = aPos.w;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const FS = /* glsl */`
uniform sampler2DArray uAlbedo;
uniform sampler2D uSceneColor, uSceneDepth, uView, uAmbient, uNoise;
uniform vec3 cameraPosition, uLightDir, uSunDir;
uniform mat4 viewMatrix, projectionMatrix, uProjInv;
uniform vec2 uRes;
uniform float uFrame, uEyeInWater, uNear, uFar;
in vec3 vWorld; in vec4 vLight; in vec2 vFlow; in vec4 vCol; in float vFoam;
flat in int vNormal; flat in int vFlags; flat in float vLayer;
layout(location = 0) out vec4 outColor;

vec3 skyRadiance(vec3 d) {
  d.y = max(d.y, 0.0);
  float elev = asin(clamp(d.y, -1.0, 1.0));
  float v = 0.5 + 0.5 * sqrt(abs(elev) / (PI * 0.5));
  float az = atan(d.z, d.x); if (az < 0.0) az += TAU;
  return texture(uView, vec2(az / TAU, v)).rgb;
}
float linDepth(vec2 uv) { return textureLod(uSceneDepth, uv, 0.0).r; }
vec3 viewPos(vec2 uv, float d) {
  vec2 ndc = uv * 2.0 - 1.0;
  return vec3(ndc.x / projectionMatrix[0][0] * d, ndc.y / projectionMatrix[1][1] * d, -d);
}
vec2 project(vec3 vp) { vec4 c = projectionMatrix * vec4(vp, 1.0); return c.xy / c.w * 0.5 + 0.5; }

// screen-space reflection: march, then home in
vec4 ssr(vec3 vp, vec3 vn, float jitter) {
  vec3 rd = normalize(reflect(normalize(vp), vn));
  if (rd.z > 0.6) return vec4(0.0);
  float stepLen = 0.35 + (-vp.z) * 0.015;
  vec3 p = vp + vn * 0.05 + rd * stepLen * jitter;
  vec3 prev = p;
  for (int i = 0; i < SSR_STEPS; i++) {
    prev = p;
    p += rd * stepLen;
    stepLen *= 1.22;
    vec2 uv = project(p);
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 || p.z > -uNear) break;
    float d = linDepth(uv);
    float pz = -p.z;
    if (pz > d && pz - d < stepLen * 2.5 + 0.3) {
      // binary search back between the last two points
      vec3 a = prev, b = p;
      for (int j = 0; j < 6; j++) {
        vec3 m = (a + b) * 0.5;
        vec2 muv = project(m);
        if (-m.z > linDepth(muv)) b = m; else a = m;
      }
      vec2 huv = project(b);
      if (linDepth(huv) > uFar * 0.98) break;           // that was the sky
      vec2 e = abs(huv * 2.0 - 1.0);
      float fade = (1.0 - pow(max(e.x, e.y), 8.0)) * sat(1.0 - float(i) / float(SSR_STEPS) * 0.5);
      return vec4(textureLod(uSceneColor, huv, 0.0).rgb, fade);
    }
  }
  return vec4(0.0);
}

void main() {
  bool lava = (vFlags & 2) != 0;
  bool top = (vFlags & 4) != 0;
  bool falling = (vFlags & 1) != 0;
  vec3 Ng = faceN(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  float dist = length(cameraPosition - vWorld);
  float sky = vLight.x;

  if (lava) {
    // lava: its own texture, streaming along the flow, and bright
    vec2 uv = top ? vWorld.xz : (abs(Ng.x) > 0.5 ? vec2(vWorld.z, -vWorld.y) : vec2(vWorld.x, -vWorld.y));
    uv = uv / 1.0 - vFlow * uTime * 0.18 + (top ? vec2(0.0) : vec2(0.0, uTime * 0.25));
    float f = uTime * 20.0 / 3.0;
    float fa = mod(floor(f), 20.0), fb = mod(fa + 1.0, 20.0);
    vec3 l = mix(texture(uAlbedo, vec3(fract(uv), vLayer + fa)).rgb, texture(uAlbedo, vec3(fract(uv), vLayer + fb)).rgb, fract(f));
    l = toLinear(l);
    float glow = 1.0 + 0.4 * sin(uTime * 1.3 + vWorld.x * 0.7 + vWorld.z * 0.5);
#ifdef LDR
    outColor = vec4(finishLDR(l * (5.0 + 3.0 * lum(l)) * glow, vWorld), 1.0);
#else
    outColor = vec4(l * (5.0 + 3.0 * lum(l)) * glow, 1.0);
#endif
    return;
  }

  // ---- water ----
  vec3 tint = toLinear(vCol.rgb);
  vec3 absorb = -0.15 * log(max(tint, vec3(0.02))) + 0.03;
  vec3 N = Ng;
  if (top || abs(Ng.y) < 0.5) {
    vec2 flow = vFlow;
    float strength = mix(0.06, 0.18, sky) * (1.0 / (1.0 + dist * 0.02));
    vec2 wp = top ? vWorld.xz : vec2(dot(vWorld, vec3(Ng.z, 0.0, -Ng.x)), vWorld.y * 0.6);
    if (!top) flow = vec2(0.0, -1.0);            // a waterfall's face streams downward
    float t = uTime * (falling || !top ? 1.8 : 1.0);
    vec3 wn = waveNormal(wp * (dot(flow, flow) > 0.01 ? 1.4 : 1.0), t, flow * (top ? 1.0 : 3.0), strength * (top ? 1.0 : 2.5));
    // ripples from the interaction map
    vec2 iuv = (vWorld.xz - uInteractRect.xy) / uInteractRect.zw;
    if (top && iuv.x > 0.0 && iuv.y > 0.0 && iuv.x < 1.0 && iuv.y < 1.0) {
      vec2 px = 1.0 / vec2(textureSize(uInteract, 0));
      float hx = textureLod(uInteract, iuv + vec2(px.x, 0.0), 0.0).r - textureLod(uInteract, iuv - vec2(px.x, 0.0), 0.0).r;
      float hz = textureLod(uInteract, iuv + vec2(0.0, px.y), 0.0).r - textureLod(uInteract, iuv - vec2(0.0, px.y), 0.0).r;
      wn = normalize(wn + vec3(-hx, 0.0, -hz) * 2.2);
    }
    if (top) N = wn;
    else {
      vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), Ng));
      N = normalize(Ng * wn.y + T * wn.x + vec3(0.0, 1.0, 0.0) * wn.z);
    }
  }
  bool below = !gl_FrontFacing && top;           // looking up at the surface from under it
  if (below) N = -N;
#ifdef LDR
  {
    // the single-pass water: no screen copies, blended over what is behind it
    vec3 sunC = texelFetch(uAmbient, ivec2(3, 0), 0).rgb, ambUp = texelFetch(uAmbient, ivec2(0, 0), 0).rgb;
    float gate = smoothstep(0.03, 0.2, sky);
#if SHADOWS > 0
    float shadow = shadowHard(shadowCoord(vWorld, vec3(0.0, 1.0, 0.0), 1.0, dist)) * gate;
#else
    float shadow = smoothstep(0.8, 0.95, sky) * gate;
#endif
    if (shadow > 0.0) shadow *= cloudShade(vWorld, uLightDir);
    float block = max(vLight.y, heldLight(vWorld, N));
    vec3 blockL = block > 0.0 ? blockLight(block, sky * sky * sat(lum(sunC) * 0.3)) * (tint * 0.6 + 0.4) * 0.35 : vec3(0.0);
    vec3 body = (sunC * shadow * 0.55 + ambUp * sky * sky * 0.5) / PI * tint * 0.9 + blockL / PI;
    float NoV = sat(dot(N, V));
    float F = 0.02 + 0.98 * pow(1.0 - NoV, 5.0);
    bool pour = !top || falling;
    if (pour) F *= 0.35;
    vec3 col;
    float alpha;
    if (below) { col = body * 0.6; alpha = 0.85; }
    else {
      vec3 skyR = skyDir(reflect(-V, N)) * pow(sat(sky * 1.15), 6.0);
      vec3 H = normalize(V + uLightDir);
      float NoH = sat(dot(N, H)), NoL = sat(dot(N, uLightDir));
      float D = 0.0016 / (PI * sqr(NoH * NoH * (0.0016 - 1.0) + 1.0));
      col = mix(body, skyR, F) + sunC * shadow * min(D * 0.25, 60.0) * NoL * F * 4.0;
      alpha = mix(0.66, 0.97, F);
      if (pour) { float st = texture(uNoise, vec2((vWorld.x + vWorld.z) * 0.45, vWorld.y * 0.12 + uTime * 0.9)).g;
        float fo = sat(st * 1.6 - 0.6); col = mix(col, vec3(0.9) * (sunC * (shadow * 0.8 + 0.1) + ambUp * sky * sky) / PI, fo); alpha = max(alpha, 0.8); }
    }
    outColor = vec4(finishLDR(col, vWorld), alpha);
    return;
  }
#endif

  vec2 suv = gl_FragCoord.xy / uRes;
  vec3 vp = (viewMatrix * vec4(vWorld, 1.0)).xyz;
  float fragD = -vp.z;
  // what is under the surface, bent by the waves
  vec3 vn = normalize((viewMatrix * vec4(N, 0.0)).xyz);
  float behind = linDepth(suv);
  vec2 ruv = suv + vn.xy * 0.07 * sat((behind - fragD) * 0.5) / (1.0 + dist * 0.05);
  if (linDepth(ruv) < fragD) ruv = suv;          // never smear something in front of the water into it
  float thick = max(linDepth(ruv) - fragD, 0.0);
  if (linDepth(ruv) > uFar * 0.98) thick = 64.0;
  vec3 under = texture(uSceneColor, ruv).rgb;

  vec3 sunC = texelFetch(uAmbient, ivec2(3, 0), 0).rgb;
  vec3 ambUp = texelFetch(uAmbient, ivec2(0, 0), 0).rgb;
  // the light on and in the water here
  float gate = smoothstep(0.03, 0.2, sky);
  float shadow = 0.0;
  if (gate > 0.0) shadow = shadowSoft(shadowCoord(vWorld, vec3(0.0, 1.0, 0.0), 1.0, dist), ign(gl_FragCoord.xy, uFrame), 1.0) * gate;
  if (shadow > 0.0) shadow *= cloudShade(vWorld, uLightDir);
  // torches and the light in your hand, lighting up the water around them
  float block = max(vLight.y, heldLight(vWorld, N));
  vec3 blockL = block > 0.0 ? blockLight(block, sky * sky * sat(lum(sunC) * 0.3)) * (tint * 0.6 + 0.4) * 0.35 : vec3(0.0);
  vec3 scatterC = (sunC * shadow * 0.55 + ambUp * sky * sky * 0.5) / PI * tint * 0.9 + blockL / PI;
  vec3 ext = absorb + 0.02;
  vec3 Tr = exp(-ext * thick);
  vec3 refr = under * Tr + scatterC * (1.0 - Tr);

  if (below) {
    // from below: the sky through Snell's window, the rest a mirror of the deep
    float cosI = dot(V, -N);
    vec3 rt = refract(-V, N, 1.333);
    vec3 col;
    if (dot(rt, rt) > 0.0) {
      float F = 0.02 + 0.98 * pow(1.0 - abs(cosI), 5.0);
      col = mix(skyRadiance(rt) * gate + sunC * shadow * pow(sat(dot(rt, uLightDir)), 600.0) * 4.0, scatterC * 0.6, F);
    } else col = scatterC * 0.6;
    outColor = vec4(col, 1.0);
    return;
  }

  float NoV = sat(dot(N, V));
  float F = 0.02 + 0.98 * pow(1.0 - NoV, 5.0);
  // a pouring column is churned up: hardly a mirror, and full of air
  bool pour = !top || falling;
  if (pour) F *= 0.35;
  // the reflection: what is on screen, else the sky, darkened under cover
  vec4 r = ssr(vp, vn, ign(gl_FragCoord.xy, uFrame));
  vec3 R = reflect(-V, N);
  vec3 skyR = skyRadiance(R) * pow(sat(sky * 1.15), 6.0);
  vec3 refl = mix(skyR, r.rgb, r.a);
  // the sun's glint, through the same shadow
  vec3 H = normalize(V + uLightDir);
  float NoH = sat(dot(N, H)), NoL = sat(dot(N, uLightDir));
  float a2 = 0.0016;
  float D = a2 / (PI * sqr(NoH * NoH * (a2 - 1.0) + 1.0));
  vec3 glint = sunC * shadow * min(D * 0.25, 60.0) * NoL * F * 4.0;

  vec3 col = mix(refr, refl, F) + glint;
  // foam where it runs shallow, and on falling water
  float shore = 1.0 - sat(thick / 0.45);
  float fn = texture(uNoise, vWorld.xz * 0.21 + vFlow * uTime * 0.4 + uTime * 0.02).r;
  float foam = sat(shore * 1.4 - fn * 0.9) * 0.85;
  if (pour) {
    // white streaks racing down the face, and a haze of bubbles through it
    float st = texture(uNoise, vec2((vWorld.x + vWorld.z) * 0.45, vWorld.y * 0.12 + uTime * 0.9)).g;
    float st2 = texture(uNoise, vec2((vWorld.x - vWorld.z) * 0.9, vWorld.y * 0.25 + uTime * 1.7)).b;
    foam = max(foam, sat((st * 0.6 + st2 * 0.6) * 1.5 - 0.55));
    refr = mix(refr, scatterC * 2.0, 0.45);
  }
  if (top && dot(vFlow, vFlow) > 0.04) foam = max(foam, sat(texture(uNoise, vWorld.xz * 0.35 - vFlow * uTime * 0.9).b * 1.5 - 1.05) * 0.6);
  vec3 lit = (sunC * (shadow * 0.8 + 0.1) + ambUp * sky * sky + blockL) / PI;
  col = mix(col, vec3(0.9) * lit, foam);
  outColor = vec4(col, 1.0);
}`;

export function makeWaterMaterial(shared, opts) {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: HEAD + COMMON + WIND + VS,
    fragmentShader: HEAD + COMMON + SHADOW + WIND + WAVES + TONEMAP + FS.replace('void main() {', (opts && opts.ldr ? LDR : '') + LIGHTS + '\nvoid main() {'),
    uniforms: Object.assign({ uMeshTime: { value: 0 } }, shared),
    side: THREE.DoubleSide,
    defines: Object.assign({ SSR_STEPS: (opts && opts.ssrSteps) || 28, SHADOWS: opts && opts.shadows !== undefined ? opts.shadows : 2 }, lightDefines(opts), opts && opts.ldr ? { LDR: 1 } : {}),
    transparent: !!(opts && opts.ldr), depthWrite: true,
  });
}
