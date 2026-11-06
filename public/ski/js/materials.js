// Materials. The snow is three's standard material with more in it: the grain and the soft lumps of real snow (normal
// maps from ambientCG, CC0), the groomer's corduroy on the run, the tracks from the track map (snow.js), glints where
// single crystals catch the sun, a cold tint in the shade, rock on the steepest walls, the look of each kind of snow
// (env.js: groomed, powder, packed, spring slush, ice), the floodlights' pools by night, and fog the colour of the sky's
// own horizon in each direction.
import * as THREE from 'three';
import { rng } from './noise.js?v=16';

// a tileable height/normal picture: periodic value noise in a few octaves
function noiseTexture(size = 256, seed = 3) {
  const r = rng(seed), H = new Float32Array(size * size);
  for (const [cells, amp] of [[8, 1], [16, 0.55], [32, 0.3], [64, 0.16], [128, 0.08]]) {
    const L = new Float32Array(cells * cells); for (let i = 0; i < L.length; i++) L[i] = r() * 2 - 1;
    const at = (i, j) => L[((j % cells + cells) % cells) * cells + ((i % cells + cells) % cells)];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const fx = x / size * cells, fy = y / size * cells, ix = Math.floor(fx), iy = Math.floor(fy);
      let tx = fx - ix, ty = fy - iy; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
      H[y * size + x] += amp * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
    }
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const h = (i, j) => H[((j + size) % size) * size + ((i + size) % size)];
    const dx = (h(x + 1, y) - h(x - 1, y)) * 2.2, dy = (h(x, y + 1) - h(x, y - 1)) * 2.2;
    const l = Math.hypot(dx, dy, 1), k = (y * size + x) * 4;
    data[k] = (-dx / l * 0.5 + 0.5) * 255; data[k + 1] = (-dy / l * 0.5 + 0.5) * 255;
    data[k + 2] = (H[y * size + x] * 0.35 + 0.5) * 255; data[k + 3] = r() * 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}

export const snowUniforms = {
  uNoise: { value: null },
  uTrack: { value: null },
  uTrackOrigin: { value: new THREE.Vector2(-48, -96) },
  uTrackSize: { value: new THREE.Vector2(96, 384) },
  uTrackTexel: { value: new THREE.Vector2(1 / 1024, 1 / 4096) },
  // the coarse track map over the whole run (snow.js): every track, kept
  uTrack2: { value: null },
  uTrack2Origin: { value: new THREE.Vector2(-80, -100) },
  uTrack2Size: { value: new THREE.Vector2(160, 1620) },
  uTrack2Texel: { value: new THREE.Vector2(1 / 512, 1 / 4096) },
  uSunDir: { value: new THREE.Vector3(0.4, 0.8, -0.4) },
  uSparkle: { value: 1 },
  uTime: { value: 0 },
  // set by env.js: the horizon's colour round the compass (for the fog), the snow kind's look (groom, lumps, wet, ice),
  // its roughness, how dark it is (0 day, 1 night) and the floodlight towers (x of the two rows, first z, spacing; count)
  uHorizon: { value: null },
  uSnowLook: { value: new THREE.Vector4(1, 0.15, 0, 0) },
  uSnowRough: { value: 0.78 },
  uNight: { value: 0 },
  uLights: { value: new THREE.Vector4(-40, 40, 0, 45) },
  uLightsN: { value: 1 },
  uGrain: { value: null },
  uLumps: { value: null },
  uTrackDepth: { value: 0.06 },     // metres of depth for a full groove in the track map (the snow kind's, env.js)
  uSnowLit: { value: new THREE.Vector3(0.95, 0.96, 0.98) },
  uFarFade: { value: new THREE.Vector2(2300, 3200) },     // the snow is all horizon colour by .y m (the terrain's last patches)   // how lit snow looks on the screen, for the unlit spray (env.js)
};
// the snow's grain and lumps: tangent-space normals in red and green, height in blue (512 px, tiling)
function snowTexture(url, fallback) {
  const t = new THREE.TextureLoader().load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; t.colorSpace = THREE.NoColorSpace;
  return t;
}

export function makeSnowMaterial(q) {
  snowUniforms.uNoise.value = snowUniforms.uNoise.value || noiseTexture(256, 3);
  snowUniforms.uGrain.value = snowUniforms.uGrain.value || snowTexture('./tex/snow_grain.jpg');
  snowUniforms.uLumps.value = snowUniforms.uLumps.value || snowTexture('./tex/snow_lumps.jpg');
  if (!snowUniforms.uHorizon.value) { const h = new THREE.DataTexture(new Uint8Array([200, 215, 232, 255]), 1, 1); h.needsUpdate = true; snowUniforms.uHorizon.value = h; }
  const m = new THREE.MeshStandardMaterial({ color: 0xf3f6fa, roughness: 0.78, metalness: 0 });
  m.name = 'snow';
  const detail = q.tier !== 'low';
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, snowUniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aGroom; attribute float aDye;
varying vec3 vWPos; varying vec3 vWNor; varying float vGroom; varying float vDye;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNor = normalize(mat3(modelMatrix) * objectNormal);
vGroom = aGroom; vDye = aDye;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos; varying vec3 vWNor; varying float vGroom; varying float vDye;
uniform sampler2D uNoise; uniform sampler2D uTrack;
uniform sampler2D uTrack2; uniform vec2 uTrack2Origin; uniform vec2 uTrack2Size; uniform vec2 uTrack2Texel;
float trH(sampler2D t, vec2 uv) { return dot(texture2D(t, uv).rg, vec2(-1.0, 0.6)); }
uniform vec2 uTrackOrigin; uniform vec2 uTrackSize; uniform vec2 uTrackTexel;
uniform vec3 uSunDir; uniform float uSparkle; uniform float uTime;
uniform sampler2D uHorizon; uniform vec4 uSnowLook; uniform float uSnowRough; uniform float uNight;
uniform vec4 uLights; uniform float uLightsN; uniform vec2 uFarFade; uniform sampler2D uGrain; uniform sampler2D uLumps; uniform float uTrackDepth;
float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3 hash33(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float gTrackDepth; float gRock; float gTrackShadow; float gScrape; vec4 gLump;`)
      // albedo: rock on steep faces, compacted grey-blue in tracks
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 wn = normalize(vWNor);
  float camD = length(vWPos - cameraPosition);
  float steep = smoothstep(0.80, 0.62, wn.y);
  float rn = texture2D(uNoise, vWPos.xz * 0.013).b + texture2D(uNoise, vWPos.xz * 0.05 + vWPos.y * 0.02).b * 0.5;
  gRock = steep * smoothstep(0.45, 0.62, rn + (0.8 - wn.y) * 0.6) * (1.0 - vGroom);
  vec3 rock = mix(vec3(0.20, 0.19, 0.18), vec3(0.34, 0.32, 0.30), texture2D(uNoise, vWPos.xz * 0.2).b);
  diffuseColor.rgb = mix(diffuseColor.rgb, rock, gRock);
  // the crews' blue dye on lips and knuckles, soaked into the snow unevenly
  if (vDye > 0.01) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12, 0.3, 0.78), vDye * (0.65 + 0.3 * texture2D(uNoise, vWPos.xz * 1.7).b));
  // big soft variation so the snow is never one flat white
  float big = texture2D(uNoise, vWPos.xz * 0.004).b - 0.5;
  diffuseColor.rgb *= 1.0 + big * 0.05;
  // the kind of snow: powder's soft hollows a touch bluer, spring slush wet and grey with coarse grains, ice a blue-grey glaze
  // scraped along the fall line (packed snow sits between groomed and ice)
  // (each kind's extra lookups only when that kind is chosen: the branches are on uniforms, so they cost nothing)
  gLump = texture2D(uLumps, vWPos.xz * 0.19);
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.93, 0.96, 1.0), uSnowLook.y * (1.0 - gLump.b) * 0.8);
  if (uSnowLook.z > 0.001) {
    float corn = texture2D(uGrain, vWPos.xz * 0.55).b;
    float wetPatch = 0.7 + 0.6 * texture2D(uNoise, vWPos.xz * 0.035 + 0.5).b;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.74, 0.73, 0.70) * (0.85 + corn * 0.3), uSnowLook.z * clamp(wetPatch, 0.0, 1.0) * (1.0 - gRock));
  }
  if (uSnowLook.w > 0.001) {
    float scr = texture2D(uNoise, vec2(vWPos.x * 0.9, vWPos.z * 0.05)).b;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.71, 0.79) * (0.84 + scr * 0.32), uSnowLook.w * (1.0 - gRock) * (0.35 + 0.65 * smoothstep(0.3, 0.7, scr + big)));
  }
  vec2 tuv = (vWPos.xz - uTrackOrigin) / uTrackSize, tuv2 = (vWPos.xz - uTrack2Origin) / uTrack2Size;
  gTrackDepth = 0.0; gTrackShadow = 0.0; gScrape = 0.0;
  bool fineIn = tuv.x > 0.0 && tuv.x < 1.0 && tuv.y > 0.0 && tuv.y < 1.0;
  bool coarseIn = tuv2.x > 0.0 && tuv2.x < 1.0 && tuv2.y > 0.0 && tuv2.y < 1.0;
  if (fineIn || coarseIn) {
    vec4 tk = fineIn ? texture2D(uTrack, tuv) : texture2D(uTrack2, tuv2) * vec4(1.6, 1.0, 1.0, 1.0);   // (the coarse map's grooves are blurred wider and shallower)
    gTrackDepth = tk.r; gScrape = tk.b;
    // compressed snow in a groove is a little greyer and bluer; the berm a little brighter
    diffuseColor.rgb *= mix(1.0, fineIn ? 0.86 : 0.74, tk.r) * mix(1.0, 1.03, tk.g);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.93, 0.96, 1.03), tk.r);
    // the low sun's shadow inside the groove: march a few texels towards the sun over the track heights
    // (heights in the map's units; the sun ray climbs rise units a step)
    vec2 sd = normalize(uSunDir.xz + 1e-4) * uTrackTexel * 1.6;
    float h0 = tk.g * 0.6 - tk.r, sh = 0.0;
    if (fineIn) {
    float rise = 1.6 * length(uTrackSize * uTrackTexel) * 0.7071 * uSunDir.y / max(0.12, length(uSunDir.xz)) / uTrackDepth;
    for (int j = 1; j <= 4; j++) {
      vec4 t2 = texture2D(uTrack, tuv + sd * float(j));
      float hj = t2.g * 0.6 - t2.r;
      sh = max(sh, clamp((hj - h0 - rise * float(j)) * 4.0, 0.0, 1.0));
    }
    }
    gTrackShadow = sh;
  }
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = uSnowRough;
roughnessFactor = mix(roughnessFactor, min(roughnessFactor, 0.55), gTrackDepth * 0.7);
roughnessFactor = mix(roughnessFactor, min(roughnessFactor, 0.38), gScrape * 0.85);     // a skid scrapes the snow smooth and shiny
roughnessFactor = mix(roughnessFactor, 0.9, gRock);`)
      // the surface's relief, in world space
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec3 wn = normalize(vWNor);
  float camD = length(vWPos - cameraPosition);
  // grain: real snow's normal maps at two scales (fine grains near, the wind-pressed surface further), the soft lumps
  // of new snow, and a side projection on steep walls; each kind of snow weighs them its own way
  float near = 1.0 - smoothstep(25.0, 120.0, camD);
  vec2 g1 = near > 0.0 ? texture2D(uGrain, vWPos.xz * 1.15).rg * 2.0 - 1.0 : vec2(0.0);
  vec2 g2 = texture2D(uNoise, vWPos.xz * 0.11 + 0.37).rg * 2.0 - 1.0;
  vec2 gl = gLump.rg * 2.0 - 1.0;
  vec2 g3 = texture2D(uNoise, vWPos.xy * 0.45).rg * 2.0 - 1.0;
  vec3 pn = wn;
  float side = 1.0 - abs(wn.y);
  float fine = (0.32 + uSnowLook.z * 0.35) * (1.0 - uSnowLook.w * 0.75);
  fine *= 1.0 - gScrape * 0.7;
  pn.xz += (g1 * fine * near + g2 * 0.16 * (1.0 - uSnowLook.w * 0.6) + gl * (0.06 + max(uSnowLook.y, 0.55 * (1.0 - vGroom)) * 0.38) * (1.0 - vGroom * uSnowLook.x * 0.6)) * (1.0 - side * 0.6);
  pn.xy += g3 * 0.12 * side;
  // corduroy: ridges about 3 cm apart along the fall line on groomed snow, faded before they alias
  float fw = fwidth(vWPos.x);
  float cord = (1.0 - smoothstep(0.004, 0.014, fw)) * vGroom * uSnowLook.x * (1.0 - gTrackDepth);
  float band = step(0.5, fract(vWPos.x / 5.2 + 0.13)) * 0.35 + 0.65;
  pn.x += sin(vWPos.x * 6.2831 / 0.031) * 0.32 * cord * band;
  // tracks: the groove and berm heights from the map, as slopes
  vec2 tuv = (vWPos.xz - uTrackOrigin) / uTrackSize, tuv2 = (vWPos.xz - uTrack2Origin) / uTrack2Size;
  if (tuv.x > 0.0 && tuv.x < 1.0 && tuv.y > 0.0 && tuv.y < 1.0) {
    float hl = trH(uTrack, tuv - vec2(uTrackTexel.x, 0.0)), hr = trH(uTrack, tuv + vec2(uTrackTexel.x, 0.0));
    float hd = trH(uTrack, tuv - vec2(0.0, uTrackTexel.y)), hu = trH(uTrack, tuv + vec2(0.0, uTrackTexel.y));
    vec2 px = uTrackSize * uTrackTexel;
    pn.x -= (hr - hl) / (2.0 * px.x) * uTrackDepth;
    pn.z -= (hu - hd) / (2.0 * px.y) * uTrackDepth;
  } else if (tuv2.x > 0.0 && tuv2.x < 1.0 && tuv2.y > 0.0 && tuv2.y < 1.0) {
    // further off: the coarse map's broader relief
    float hl = trH(uTrack2, tuv2 - vec2(uTrack2Texel.x, 0.0)), hr = trH(uTrack2, tuv2 + vec2(uTrack2Texel.x, 0.0));
    float hd = trH(uTrack2, tuv2 - vec2(0.0, uTrack2Texel.y)), hu = trH(uTrack2, tuv2 + vec2(0.0, uTrack2Texel.y));
    vec2 px = uTrack2Size * uTrack2Texel;
    pn.x -= (hr - hl) / (2.0 * px.x) * uTrackDepth * 3.0;
    pn.z -= (hu - hd) / (2.0 * px.y) * uTrackDepth * 3.0;
  }
  pn = normalize(pn);
  normal = normalize((viewMatrix * vec4(pn, 0.0)).xyz);
}`)
      // glints and the cold shade
      .replace('#include <opaque_fragment>', `
{
  float camD = length(vWPos - cameraPosition);
  vec3 V = normalize(cameraPosition - vWPos);
  ${detail ? `vec3 cell = floor(vWPos * 70.0);
  float r = hash13(cell);
  vec3 fn = normalize(vec3(hash33(cell) * 2.0 - 1.0) + vec3(0.0, 1.2, 0.0));
  float gl = pow(max(0.0, dot(reflect(-uSunDir, fn), V)), 120.0) * step(0.84, r);
  float sunlit = smoothstep(0.08, 0.5, dot(reflectedLight.directDiffuse, vec3(0.33)));
  float fade = 1.0 - smoothstep(6.0, 40.0, camD);
  outgoingLight += vec3(1.0, 0.97, 0.92) * gl * 7.0 * sunlit * fade * uSparkle * (1.0 - gRock) * (1.0 - uNight);` : ''}   // (no glints on the low tier: they cost about 0.35 ms a frame up close on the test machine)
  float lit = dot(reflectedLight.directDiffuse, vec3(0.33));
  outgoingLight -= reflectedLight.directDiffuse * gTrackShadow * 0.7;
  // by night: pools of light under the park's floodlight towers (two rows, evenly spaced; lamps aimed at the run)
  if (uNight > 0.001) {
    vec3 wn = normalize(vWNor);
    float pool = 0.0;
    float fz = (vWPos.z - uLights.z) / uLights.w, k = floor(fz + 0.5);
    for (int s = 0; s < 2; s++) {
      float lx = s == 0 ? uLights.x : uLights.y, inward = s == 0 ? 1.0 : -1.0;
      for (int j = -1; j <= 1; j++) {
        float kz = k + float(j);
        if (kz < 0.0 || kz > uLightsN - 1.0) continue;     // (past the last tower: none, not the end one again)
        vec3 d = vec3(vWPos.x - lx, 11.0, vWPos.z - uLights.z - kz * uLights.w);
        float r2 = dot(d, d);
        float aim = 0.25 + 0.75 * smoothstep(-6.0, 18.0, d.x * inward);
        // (the three nearest towers each side, the outer ones faded out before they drop from the three, so no seam)
        pool += aim * max(0.0, dot(wn, normalize(vec3(-d.x, d.y, -d.z)))) / r2 * (1.0 - smoothstep(1.0, 1.5, abs(fz - kz)));
      }
    }
    pool *= 150.0;
    // the light that follows the rider is the floodlight by night: the snow keeps only a little of it (enough for the
    // rider's shadow) and is lit by the pools instead
    outgoingLight -= (reflectedLight.directDiffuse + reflectedLight.directSpecular) * uNight * 0.85;
    outgoingLight += diffuseColor.rgb * vec3(1.0, 0.9, 0.76) * pool * uNight * (1.0 - gTrackShadow * 0.5);
  }
  outgoingLight *= mix(vec3(0.93, 0.97, 1.06), vec3(1.0), smoothstep(0.05, 0.4, lit) * (1.0 - gTrackShadow * 0.7));
}
#include <opaque_fragment>`)
      .replace('#include <fog_fragment>', `
#ifdef USE_FOG
  // (all the way to the horizon's colour by uFarFade.y, past which no terrain is drawn)
  float fogFactor = max(1.0 - exp(- fogDensity * fogDensity * vFogDepth * vFogDepth), smoothstep(uFarFade.x, uFarFade.y, length(vWPos.xz - cameraPosition.xz)));
  vec3 fdir = normalize(vWPos - cameraPosition);
  vec3 fcol = texture2D(uHorizon, vec2(atan(fdir.z, fdir.x) * 0.1591549 + 0.5, 0.5)).rgb;
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fcol, fogFactor);
#endif`);
  };
  m.customProgramCacheKey = () => 'snow' + (detail ? 'D' : 'L');
  return m;
}

export function makeMaterials(q) {
  return {
    snow: makeSnowMaterial(q),
    steel: new THREE.MeshStandardMaterial({ color: 0xb8bdc2, metalness: 0.9, roughness: 0.32 }),
    boxTop: new THREE.MeshStandardMaterial({ color: 0x1d2128, metalness: 0.0, roughness: 0.38 }),
    frame: new THREE.MeshStandardMaterial({ color: 0x2c3036, metalness: 0.6, roughness: 0.5 }),
  };
}
