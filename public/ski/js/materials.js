// Materials. The snow is three's standard material with more in it: fine grain and wind-pressed relief, the
// groomer's corduroy on the run, the tracks from the track map (snow.js), glints where single crystals catch the sun,
// a cold tint in the shade, and rock on the steepest valley walls.
import * as THREE from 'three';
import { rng } from './noise.js?v=8';

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
  uSunDir: { value: new THREE.Vector3(0.4, 0.8, -0.4) },
  uSparkle: { value: 1 },
  uTime: { value: 0 },
};

export function makeSnowMaterial(q) {
  snowUniforms.uNoise.value = snowUniforms.uNoise.value || noiseTexture(256, 3);
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
uniform vec2 uTrackOrigin; uniform vec2 uTrackSize; uniform vec2 uTrackTexel;
uniform vec3 uSunDir; uniform float uSparkle; uniform float uTime;
float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3 hash33(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float gTrackDepth; float gRock; float gTrackShadow;`)
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
  vec2 tuv = (vWPos.xz - uTrackOrigin) / uTrackSize;
  gTrackDepth = 0.0; gTrackShadow = 0.0;
  if (tuv.x > 0.0 && tuv.x < 1.0 && tuv.y > 0.0 && tuv.y < 1.0) {
    vec4 tk = texture2D(uTrack, tuv);
    gTrackDepth = tk.r;
    // compressed snow in a groove is a little greyer and bluer; the berm a little brighter
    diffuseColor.rgb *= mix(1.0, 0.86, tk.r) * mix(1.0, 1.03, tk.g);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.93, 0.96, 1.03), tk.r);
    // the low sun's shadow inside the groove: march a few texels towards the sun over the track heights
    vec2 sd = normalize(uSunDir.xz + 1e-4) * uTrackTexel * 1.6;
    float h0 = tk.g * 0.6 - tk.r, sh = 0.0;
    float rise = 1.6 * length(uTrackSize * uTrackTexel) * uSunDir.y / max(0.2, length(uSunDir.xz)) / 0.12;
    for (int j = 1; j <= 4; j++) {
      vec4 t2 = texture2D(uTrack, tuv + sd * float(j));
      float hj = t2.g * 0.6 - t2.r;
      sh = max(sh, clamp((hj - h0 - rise * float(j) * 0.2) * 3.0, 0.0, 1.0));
    }
    gTrackShadow = sh;
  }
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.55, gTrackDepth * 0.7);
roughnessFactor = mix(roughnessFactor, 0.9, gRock);`)
      // the surface's relief, in world space
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec3 wn = normalize(vWNor);
  float camD = length(vWPos - cameraPosition);
  // grain: two scales from the noise picture, top-down plus a side projection on steep walls
  vec2 g1 = texture2D(uNoise, vWPos.xz * 0.9).rg * 2.0 - 1.0;
  vec2 g2 = texture2D(uNoise, vWPos.xz * 0.11 + 0.37).rg * 2.0 - 1.0;
  vec2 g3 = texture2D(uNoise, vWPos.xy * 0.45).rg * 2.0 - 1.0;
  float near = 1.0 - smoothstep(25.0, 120.0, camD);
  vec3 pn = wn;
  float side = 1.0 - abs(wn.y);
  pn.xz += (g1 * 0.10 * near + g2 * 0.16) * (1.0 - side * 0.6);
  pn.xy += g3 * 0.12 * side;
  // corduroy: ridges about 3 cm apart along the fall line on groomed snow, faded before they alias
  ${detail ? `float fw = fwidth(vWPos.x);
  float cord = (1.0 - smoothstep(0.004, 0.014, fw)) * vGroom * (1.0 - gTrackDepth);
  float band = step(0.5, fract(vWPos.x / 5.2 + 0.13)) * 0.35 + 0.65;
  pn.x += sin(vWPos.x * 6.2831 / 0.031) * 0.32 * cord * band;` : ''}
  // tracks: the groove and berm heights from the map, as slopes
  vec2 tuv = (vWPos.xz - uTrackOrigin) / uTrackSize;
  if (tuv.x > 0.0 && tuv.x < 1.0 && tuv.y > 0.0 && tuv.y < 1.0) {
    float hl = dot(texture2D(uTrack, tuv - vec2(uTrackTexel.x, 0.0)).rg, vec2(-1.0, 0.6));
    float hr = dot(texture2D(uTrack, tuv + vec2(uTrackTexel.x, 0.0)).rg, vec2(-1.0, 0.6));
    float hd = dot(texture2D(uTrack, tuv - vec2(0.0, uTrackTexel.y)).rg, vec2(-1.0, 0.6));
    float hu = dot(texture2D(uTrack, tuv + vec2(0.0, uTrackTexel.y)).rg, vec2(-1.0, 0.6));
    vec2 px = uTrackSize * uTrackTexel;
    pn.x -= (hr - hl) / (2.0 * px.x) * 0.2;
    pn.z -= (hu - hd) / (2.0 * px.y) * 0.2;
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
  outgoingLight += vec3(1.0, 0.97, 0.92) * gl * 7.0 * sunlit * fade * uSparkle * (1.0 - gRock);` : ''}
  float lit = dot(reflectedLight.directDiffuse, vec3(0.33));
  outgoingLight -= reflectedLight.directDiffuse * gTrackShadow * 0.7;
  outgoingLight *= mix(vec3(0.93, 0.97, 1.06), vec3(1.0), smoothstep(0.05, 0.4, lit) * (1.0 - gTrackShadow * 0.7));
}
#include <opaque_fragment>`);
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
