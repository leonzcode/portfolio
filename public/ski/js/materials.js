// Materials. The snow is three's standard material with more in it: the grain and the soft lumps of real snow (normal
// maps from ambientCG, CC0), the groomer's corduroy on the run, the tracks from the track map (snow.js), glints where
// single crystals catch the sun, a cold tint in the shade, rock on the steepest walls, the look of each kind of snow
// (env.js: groomed, powder, packed, spring slush, ice), the floodlights' pools by night, and fog the colour of the sky's
// own horizon in each direction.
import * as THREE from 'three';
import { rng } from './noise.js?v=22';
import { ground, onMountain } from './terrain.js?v=22';

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
  // the fine track map round the rider (snow.js): it wraps round (a place's texel is the place modulo its size, from
  // uTrackBase.xy, its texel uTrackBase.z m); uTrackWin is the window it holds now (origin x, z and size); uTrackK: the
  // edge field's slope per metre in the fine map and the coarse map, and 1 / the fine map's size
  uTrack: { value: null },
  uTrackWin: { value: new THREE.Vector4(-1e5, -1e5, 64, 128) },
  uTrackBase: { value: new THREE.Vector4(-32, 0, 0.0625, 0) },
  uTrackK: { value: new THREE.Vector4(2.67, 1, 1 / 64, 1 / 128) },
  // how the snow kind takes a track (env.js): the walls' softness (m), how much a skid polishes, scratches (ice: white,
  // not dark), how lumpy heaped snow is
  uTrackLook: { value: new THREE.Vector4(0.003, 0.6, 0, 0.5) },
  // the coarse track map over the whole park (snow.js): every track, kept
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
  // the park's lamps (env.js makeLightTowers): how far on they are, and up to six rows of them: (first lamp x, z, step to
  // the next x, z), (count, the way they point x, z, height over the snow), (how bright, -, -, -)
  uLamps: { value: 0 },
  uLRowA: { value: Array.from({ length: 6 }, () => new THREE.Vector4()) },
  uLRowB: { value: Array.from({ length: 6 }, () => new THREE.Vector4()) },
  uLRowC: { value: Array.from({ length: 6 }, () => new THREE.Vector4()) },
  uLRowN: { value: 0 },
  uGrain: { value: null },
  uLumps: { value: null },
  uTrackDepth: { value: 0.06 },     // metres of depth for a full groove in the track map (the snow kind's, env.js)
  uSnowLit: { value: new THREE.Vector3(0.95, 0.96, 0.98) },
  uFarFade: { value: new THREE.Vector2(2300, 3200) },     // the snow is all horizon colour by .y m (the terrain's last patches)   // how lit snow looks on the screen, for the unlit spray (env.js)
  // the rock field (below): how steep the snow is, as a map over the world, a fine one round the map's middle and a coarse
  // one round that; each window (x0, z0, 1 / size, 1 when it is ready)
  uRockMap: { value: null },
  uRockMap2: { value: null },
  uRockWin: { value: new THREE.Vector4(0, 0, 1, 0) },
  uRockWin2: { value: new THREE.Vector4(0, 0, 1, 0) },
};

/* ---- the rock field (2026-11-07, for "rock on steep snow blend naturally, with no patch-shaped edges"). Rock showed
   through the snow where the terrain's own normals were steep, and those normals depend on the size of the patch they
   are in (a coarse patch's are smoothed over its wider cells), so across a slope near the threshold whole patches came
   out rocky or white beside each other, edges and all. The snow's steepness for the rock is now read from a map of the
   world instead, worked out once from the height function itself at a fixed spacing: the same value at a place whatever
   patch draws it. Two windows: 4 m a texel over 1.3 km round the map's middle, 32 m over 8 km round that (each slope over
   two texels either way, so smooth at that scale; the rock's detail is the shader's own noise, as before). Baked a row
   at a time in idle moments (4 ms at most a slice) from the first time the snow is compiled (the heights are all known
   by then), or as soon as a map gives its own source, or in a module worker (Freeride: frfield.js, ready before a run
   starts and never on the page's thread); until a window is ready the snow uses its normals as before. A
   map's own source (freeride.js: its snow without its rock faces, which draw their own rock, so no grey halo round every
   cliff) comes with its own middle and a say in how rocky each place is. Meshes with their own fine normals that are
   not terrain patches (the kickers, vGroom 0.65) keep using those. */
export const rockField = { height: null, center: null, adjust: null, state: 0 };
// the two windows round a middle: texels a side, metres a texel, the corner
const ROCK_LEVELS = [{ N: 320, r: 4 }, { N: 256, r: 32 }];
export function rockLevels(c) { return ROCK_LEVELS.map(L => ({ N: L.N, r: L.r, x0: c[0] - L.N * L.r / 2, z0: c[1] - L.N * L.r / 2 })); }
function setRockLevel(i, data, c) {
  const L = rockLevels(c)[i], u = i ? snowUniforms.uRockWin2 : snowUniforms.uRockWin, m = i ? snowUniforms.uRockMap2 : snowUniforms.uRockMap;
  m.value = rockTexture(data, L.N); u.value.set(L.x0, L.z0, 1 / (L.N * L.r), 1);
}
// (a map with its own source can start the bake at once: its heights do not wait for the rest of the world)
export function setRockSource(height, center, adjust) { rockField.height = height; rockField.center = center; rockField.adjust = adjust || null; bakeRockField(); }
/* (or have a module worker work it out, off the page's own thread: Freeride's land is plain JS a worker can load. The
   worker is sent the windows and posts back each one's texels; if it cannot start, the page bakes it itself) */
export function rockFieldWorker(url, center, fallback) {
  let w = null;
  try { w = new Worker(url, { type: 'module' }); } catch (e) { w = null; }
  if (!w) { fallback(); return; }
  rockField.state = 1; rockField.center = center;
  w.onmessage = e => { setRockLevel(e.data.i, e.data.data, center); if (e.data.i === ROCK_LEVELS.length - 1) { rockField.state = 2; w.terminate(); } };
  w.onerror = () => { w.terminate(); if (rockField.state < 2) { rockField.state = 0; fallback(); } };
  w.postMessage({ levels: rockLevels(center) });
}
function rockTexture(data, N) {
  const t = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}
function bakeRockField() {
  if (rockField.state) return;
  rockField.state = 1;
  const H = rockField.height || ground;
  const c = rockField.center || (onMountain() ? [0, 0] : [0, 620]);
  const levels = rockLevels(c);
  let li = 0, j = -1, hs = null, data = null;
  const later = typeof requestIdleCallback === 'function' ? f => requestIdleCallback(f, { timeout: 120 }) : f => setTimeout(f, 0);
  const slice = () => {
    const t0 = performance.now(), A = rockField.adjust;
    while (li < levels.length && performance.now() - t0 < 4) {
      const L = levels[li], N = L.N, M = N + 2, x0 = L.x0, z0 = L.z0;
      if (!hs) { hs = new Float32Array(M * M); data = new Uint8Array(N * N); j = 0; }
      // the heights at the texels' middles and one ring round them, a row at a time
      if (j < M) {
        const z = z0 + (j - 0.5) * L.r;
        for (let i = 0; i < M; i++) hs[j * M + i] = H(x0 + (i - 0.5) * L.r, z);
        j++; continue;
      }
      // then the normal's y from the slope across two texels either way, a row at a time
      if (j < M + N) {
        const jj = j - M;
        for (let i = 0; i < N; i++) {
          const k = (jj + 1) * M + i + 1, gx = (hs[k + 1] - hs[k - 1]) / (2 * L.r), gz = (hs[k + M] - hs[k - M]) / (2 * L.r);
          let ny = 1 / Math.sqrt(1 + gx * gx + gz * gz);
          if (A) ny = A(x0 + (i + 0.5) * L.r, z0 + (jj + 0.5) * L.r, ny);      // (a map's own: more rock here, less there)
          data[jj * N + i] = Math.round(255 * Math.max(0, Math.min(1, ny)));
        }
        j++; continue;
      }
      setRockLevel(li, data, c);
      hs = null; li++;
    }
    if (li < levels.length) later(slice); else rockField.state = 2;
  };
  later(slice);
}
if (typeof window !== 'undefined') window.__snowU = snowUniforms;     // (a test handle)
// the snow's grain and lumps: tangent-space normals in red and green, height in blue (512 px, tiling)
function snowTexture(url, fallback) {
  const t = new THREE.TextureLoader().load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; t.colorSpace = THREE.NoColorSpace;
  return t;
}

/* (2026-11-06, the lag pass) three's PCF shadow reads the shadow map 17 times for every pixel of snow in the shadow
   box round the rider, about half the picture; on the low tier the snow reads it 4 times instead and blends between
   them (the same soft edge, a texel narrower). The other materials keep three's own. */
function lowShadowChunk() {
  const src = THREE.ShaderChunk.shadowmap_pars_fragment, a = src.indexOf('#if defined( SHADOWMAP_TYPE_PCF )'), b = src.indexOf('( 1.0 / 17.0 );', a);
  if (a < 0 || b < 0) return null;
  return src.slice(0, a) + `#if defined( SHADOWMAP_TYPE_PCF )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			vec2 st = shadowCoord.xy * shadowMapSize - 0.5, f = fract( st );
			vec2 uv = ( floor( st ) + 0.5 ) * texelSize;
			shadow = mix( mix( texture2DCompare( shadowMap, uv, shadowCoord.z ), texture2DCompare( shadowMap, uv + vec2( texelSize.x, 0.0 ), shadowCoord.z ), f.x ),
				mix( texture2DCompare( shadowMap, uv + vec2( 0.0, texelSize.y ), shadowCoord.z ), texture2DCompare( shadowMap, uv + texelSize, shadowCoord.z ), f.x ), f.y );` + src.slice(b + '( 1.0 / 17.0 );'.length);
}
let LOW_SHADOW;
/* (and on the low tier the sky's reflection off the snow is the sky's light on it, not a second look into the sky's
   picture: snow is so rough that its blurred reflection is nearly the same colour, and it saves about a tenth of the
   snow's cost on the graphics card) */
const LOW_IBL = () => {
  const src = THREE.ShaderChunk.lights_fragment_maps, a = 'radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );';
  return src.includes(a) ? src.replace(a, 'radiance += iblIrradiance * RECIPROCAL_PI;') : null;
};

export function makeSnowMaterial(q) {
  snowUniforms.uNoise.value = snowUniforms.uNoise.value || noiseTexture(256, 3);
  snowUniforms.uGrain.value = snowUniforms.uGrain.value || snowTexture('./tex/snow_grain.jpg');
  snowUniforms.uLumps.value = snowUniforms.uLumps.value || snowTexture('./tex/snow_lumps.jpg');
  if (!snowUniforms.uRockMap.value) { const one = rockTexture(new Uint8Array([255]), 1); one.generateMipmaps = false; one.minFilter = THREE.LinearFilter; snowUniforms.uRockMap.value = one; snowUniforms.uRockMap2.value = one; }
  if (!snowUniforms.uHorizon.value) { const h = new THREE.DataTexture(new Uint8Array([200, 215, 232, 255]), 1, 1); h.needsUpdate = true; snowUniforms.uHorizon.value = h; }
  const m = new THREE.MeshStandardMaterial({ color: 0xf3f6fa, roughness: 0.78, metalness: 0 });
  m.name = 'snow';
  const detail = q.tier !== 'low';
  if (!detail && LOW_SHADOW === undefined) LOW_SHADOW = lowShadowChunk();
  m.onBeforeCompile = (s) => {
    bakeRockField();          // (the first compile: every height is known by now)
    Object.assign(s.uniforms, snowUniforms);
    if (!detail && LOW_SHADOW) s.fragmentShader = s.fragmentShader.replace('#include <shadowmap_pars_fragment>', LOW_SHADOW);
    const ibl = !detail && LOW_IBL(); if (ibl) s.fragmentShader = s.fragmentShader.replace('#include <lights_fragment_maps>', ibl);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aGroom; attribute float aDye;
varying vec3 vWPos; varying vec3 vWNor; varying float vGroom; varying float vDye;
uniform float uLamps; uniform vec4 uLRowA[6]; uniform vec4 uLRowB[6]; uniform vec4 uLRowC[6]; uniform float uLRowN;
varying vec4 vLamp;     // the lamps' pool here (w) and the way their light comes from (xyz, weighted)`)
      .replace('#include <project_vertex>', `#include <project_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNor = normalize(mat3(modelMatrix) * objectNormal);
vGroom = aGroom; vDye = aDye;
// the park's lamps (env.js makeLightTowers, 2026-11-06): pools of light from rows of evenly spaced lamps, each lamp
// aimed one way across its row; on from a little before sunset (uLamps). Each row lights a point from its two nearest
// lamps, so a row costs the same however long it is. Worked out at the corners (the pools are metres across) and only
// scaled at each pixel by the snow's own relief: per pixel it cost a third of the snow's drawing.
vLamp = vec4(0.0);
if (uLamps > 0.001) {
  for (int r = 0; r < 6; r++) {
    if (float(r) >= uLRowN) break;
    vec4 A = uLRowA[r], B = uLRowB[r];
    float dl2 = dot(A.zw, A.zw), fz = dl2 > 1e-6 ? dot(vWPos.xz - A.xy, A.zw) / dl2 : 0.0, k = floor(fz);
    for (int j = 0; j <= 1; j++) {
      float kz = k + float(j);
      if (kz < 0.0 || kz > B.x - 1.0) continue;     // (past the last lamp: none, not the end one again)
      vec2 lp = A.xy + A.zw * kz;
      vec3 d = vec3(lp.x - vWPos.x, B.w, lp.y - vWPos.z);
      float r2 = dot(d, d);
      if (r2 > 6400.0) continue;                    // (80 m off a lamp's light is a few thousandths)
      vec3 l = d * inversesqrt(r2);
      float aim = 0.25 + 0.75 * smoothstep(-6.0, 18.0, -dot(d.xz, B.yz));
      // (the two lamps either side, the further one fading out as it gets a whole step away, so there is no seam
      // where the pair changes, and the pools stand out between the towers)
      float w = uLRowC[r].x * aim / r2 * (1.0 - smoothstep(0.5, 1.0, abs(fz - kz)));
      vLamp.w += w * max(0.0, dot(vWNor, l)); vLamp.xyz += w * l;
    }
  }
}`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos; varying vec3 vWNor; varying float vGroom; varying float vDye;
uniform sampler2D uNoise; uniform sampler2D uTrack;
uniform sampler2D uTrack2; uniform vec2 uTrack2Origin; uniform vec2 uTrack2Size; uniform vec2 uTrack2Texel;
uniform vec4 uTrackWin; uniform vec4 uTrackBase; uniform vec4 uTrackK; uniform vec4 uTrackLook;
// one look at the tracks here: (the distance into a groove (m, + inside, through its edge field), the heap, the scrape,
// the groove's depth), the fine map and the coarse map weighed by wf and wc (what neither covers counts as untouched)
// (gTrkAny: the most any channel read; nothing at all there means no track within a few texels)
float gTrkAny;
vec4 trTap(vec2 p, float wf, float wc) {
  vec4 r = vec4((wf + wc - 1.0) * 0.25, 0.0, 0.0, 0.0);
  if (wf > 0.0) { vec4 t = textureLod(uTrack, (p - uTrackBase.xy) * uTrackK.zw, 0.0); r += wf * vec4((t.r - 0.5) / uTrackK.x, t.gba); gTrkAny = max(gTrkAny, max(max(t.r, t.g), max(t.b, t.a))); }
  if (wc > 0.0) { vec4 t = textureLod(uTrack2, (p - uTrack2Origin) / uTrack2Size, 0.0); r += wc * vec4((t.r - 0.5) / uTrackK.y, t.gba); gTrkAny = max(gTrkAny, max(max(t.r, t.g), max(t.b, t.a))); }
  return r;
}
uniform vec3 uSunDir; uniform float uSparkle; uniform float uTime;
uniform sampler2D uHorizon; uniform vec4 uSnowLook; uniform float uSnowRough; uniform float uNight;
uniform float uLamps; varying vec4 vLamp; uniform vec2 uFarFade; uniform sampler2D uGrain; uniform sampler2D uLumps; uniform float uTrackDepth;
float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3 hash33(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float gRock; float gTrackShadow; float gScrape; float gCover; float gTDep; float gBerm; vec2 gTN; vec4 gLump; vec3 gPN;
// the snow's steepness for the rock, from the rock field where it is ready (the same at a place whatever patch draws it)
uniform sampler2D uRockMap; uniform sampler2D uRockMap2; uniform vec4 uRockWin; uniform vec4 uRockWin2;
float rockNy(float ny) {
  if (uRockWin2.w > 0.5) { vec2 u = (vWPos.xz - uRockWin2.xy) * uRockWin2.z; float e = min(min(u.x, 1.0 - u.x), min(u.y, 1.0 - u.y)); ny = mix(ny, texture2D(uRockMap2, u).r, smoothstep(0.0, 0.03, e)); }
  if (uRockWin.w > 0.5) { vec2 u = (vWPos.xz - uRockWin.xy) * uRockWin.z; float e = min(min(u.x, 1.0 - u.x), min(u.y, 1.0 - u.y)); ny = mix(ny, texture2D(uRockMap, u).r, smoothstep(0.0, 0.06, e)); }
  return ny;
}`)
      // albedo: rock on steep faces, compacted grey-blue in tracks
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 wn = normalize(vWNor);
  float camD = length(vWPos - cameraPosition);
  // (2026-11-07: the terrain's steepness from the rock field, not its patch's normals: no patch-shaped edges. The
  // kickers' own meshes (groomed 0.65) keep their normals)
  float rny = vGroom < 0.5 ? rockNy(wn.y) : wn.y;
  float steep = smoothstep(0.80, 0.62, rny);
  // (2026-11-06, the lag pass: rock only where the snow is steep enough for it, so most of the snow skips its three
  // lookups; the same picture)
  gRock = 0.0;
  if (steep > 0.0 && vGroom < 1.0) {
    float rn = texture2D(uNoise, vWPos.xz * 0.013).b + texture2D(uNoise, vWPos.xz * 0.05 + vWPos.y * 0.02).b * 0.5;
    gRock = steep * smoothstep(0.45, 0.62, rn + (0.8 - rny) * 0.6) * (1.0 - vGroom);
    if (gRock > 0.0) {
      vec3 rock = mix(vec3(0.20, 0.19, 0.18), vec3(0.34, 0.32, 0.30), texture2D(uNoise, vWPos.xz * 0.2).b);
      diffuseColor.rgb = mix(diffuseColor.rgb, rock, gRock);
    }
  }
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
  // ---- the tracks (snow.js). Three looks at the maps (here and a texel along x and z) give everything: a groove's edge
  // is drawn where its edge field crosses zero, anti-aliased by how much of the snow the pixel spans across it, so it
  // stays crisp up close and fades rather than flickers far off; its wall, floor, the heaps beside and a skid's scrape
  // tilt the normal; the wall nearer a low sun shades the floor beside it
  gTN = vec2(0.0); gCover = 0.0; gScrape = 0.0; gBerm = 0.0; gTDep = 0.0; gTrackShadow = 0.0;
  {
    vec2 xz = vWPos.xz, dpx = dFdx(xz), dpy = dFdy(xz);
    // the fine map over its window, fading to the coarse one over its last 6 m; the coarse one fading out at the park's edge
    vec2 rel = xz - uTrackWin.xy, c2 = (xz - uTrack2Origin) / uTrack2Size, e2 = min(c2, 1.0 - c2) * uTrack2Size;
    float wf = smoothstep(0.0, 6.0, min(min(rel.x, uTrackWin.z - rel.x), min(rel.y, uTrackWin.w - rel.y)));
    float wc = smoothstep(0.0, 5.0, min(e2.x, e2.y)) * (1.0 - wf);
    float flatK = smoothstep(0.45, 0.7, wn.y);       // (none on steep faces: the maps are seen from above)
    gTrkAny = 0.0;
    vec4 t0 = (wf + wc) * flatK > 0.002 ? trTap(xz, wf, wc) : vec4(0.0);
    if (gTrkAny > 0.003) {
      vec2 st = wf > 0.0 ? uTrackBase.zz : uTrack2Size * uTrack2Texel;
      vec4 tx = trTap(xz + vec2(st.x, 0.0), wf, wc), tz = trTap(xz + vec2(0.0, st.y), wf, wc);
      vec2 gd = vec2(tx.x - t0.x, tz.x - t0.x) / st;
      float gl = max(length(gd), 0.2);                // (1 on a crisp wall's side of the field, less on a soft one)
      vec2 n = gd / gl;                               // into the groove, away from the nearer wall
      float dw = t0.x / gl;                           // how far inside the groove (m)
      // how much of the pixel the groove covers: the pixel's width across it (P) against a groove at least a ski's
      // groove wide (a box filter): crisp near by, and far off, where a groove is less than a pixel wide, as much
      // darker as it is wide, the same wherever the pixel falls on it, so it stays put as the camera moves
      float pix = abs(dot(n, dpx)) + abs(dot(n, dpy));
      // (the snow's own softness widens the edge too; off the groomed run the snow is deep whatever the kind: soft
      // walls, deeper)
      float e = mix(max(uTrackLook.x, 0.035), uTrackLook.x, vGroom) / gl;
      float P = max(pix, 2.0 * e) + 1e-4, hwE = max(0.05, dw), rr = hwE - dw;
      gCover = clamp((min(rr + 0.5 * P, hwE) - max(rr - 0.5 * P, -hwE)) / P, 0.0, 1.0) * flatK;
      e = max(e, 0.5 * pix);
      float tD = mix(max(uTrackDepth, 0.2), uTrackDepth, vGroom);
      gTDep = t0.w; gBerm = t0.y * flatK; gScrape = t0.z * flatK;
      float fd = tD * gTDep;                          // the groove's depth here (m)
      // the wall: about 2.4 times as steep as it is wide where an edge cut it, gentler where the field says it is soft
      float wW = max(fd * 0.42 / gl, 0.003);
      gTN = n * (fd / wW) * gCover * (1.0 - smoothstep(wW - e, wW + e, dw));
      gTN += (vec2(tx.w, tz.w) - t0.w) / st * tD * gCover;                  // the floor, deepest at the inside wall
      gTN -= (vec2(tx.y, tz.y) - t0.y) / st * tD * 0.45 * flatK;            // the snow heaped beside
      gTN += (vec2(tx.z, tz.z) - t0.z) / st * tD * 0.12 * flatK;            // a scraped band sits a little lower
      // (far off, where a pixel spans more than these few centimetres of relief, it would only sparkle: it fades)
      float farK = 1.0 - 0.8 * smoothstep(0.05, 0.25, length(dpx) + length(dpy));
      gTN *= farK;
      // the wall between the floor and a low sun shades the floor as far as its height throws a shadow
      float sxz = length(uSunDir.xz);
      if (sxz > 0.01 && gCover > 0.0) {
        float L = fd * sxz / max(uSunDir.y, 0.06) * max(0.0, -dot(n, uSunDir.xz / sxz));
        gTrackShadow = gCover * (1.0 - smoothstep(L - e, L + e, dw)) * step(0.002, L) * farK;
      }
      // snow pressed into a groove is a little greyer and bluer (wet slush darker); heaped loose snow a touch brighter;
      // on ice a scratch is shaved ice, white and dull. (Far off, where the relief and its shadow have faded, a groove
      // keeps their average: a little darker again.)
      float inG = gCover * (0.35 + 0.65 * gTDep);
      diffuseColor.rgb *= mix(1.0, 0.9 - uSnowLook.z * 0.1 - 0.36 * (1.0 - farK) * (1.0 - uTrackLook.z), inG) * (1.0 + gBerm * 0.035 + gScrape * 0.035 * (1.0 - uTrackLook.z));
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.95, 0.975, 1.03), inG);
      if (uTrackLook.z > 0.001) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.93), uTrackLook.z * clamp(gCover + gScrape * 0.6, 0.0, 1.0) * (1.0 - gRock));
    }
  }
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = uSnowRough;
roughnessFactor = mix(roughnessFactor, min(roughnessFactor, 0.6), gCover * 0.6);               // the base pressed the floor smoother
roughnessFactor = mix(roughnessFactor, min(roughnessFactor, 0.3), gScrape * uTrackLook.y);    // a skid polishes the snow
roughnessFactor = mix(roughnessFactor, 0.85, uTrackLook.z * clamp(gCover + gScrape, 0.0, 1.0));   // (ice: a scratch is dull)
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
  vec3 pn = wn;
  float side = 1.0 - abs(wn.y);
  // (the side projection's grain only where it shows: on gentle snow it moved the normal by under half a degree;
  // brought in smoothly from there, so no line where it starts)
  float sideK = smoothstep(0.04, 0.09, side);
  vec2 g3 = sideK > 0.0 ? texture2D(uNoise, vWPos.xy * 0.45).rg * 2.0 - 1.0 : vec2(0.0);
  float fine = (0.32 + uSnowLook.z * 0.35) * (1.0 - uSnowLook.w * 0.75);
  // (a track flattens the grain: a skid smooths it away, a groove's floor is pressed)
  float flat_ = 1.0 - max(gScrape * 0.8, gCover * 0.5);
  pn.xz += (g1 * fine * near * flat_ + g2 * 0.16 * (1.0 - uSnowLook.w * 0.6) + gl * (0.06 + max(uSnowLook.y, 0.55 * (1.0 - vGroom)) * 0.38) * (1.0 - vGroom * uSnowLook.x * 0.6) * (1.0 - gScrape * 0.6)) * (1.0 - side * 0.6);
  pn.xy += g3 * 0.12 * side * sideK;
  // corduroy: ridges about 3 cm apart along the fall line on groomed snow, faded before they alias; a track cuts
  // through them (crisply, with the groove's edge) and a skid wipes them out
  float fw = fwidth(vWPos.x);
  float cord = (1.0 - smoothstep(0.004, 0.014, fw)) * vGroom * uSnowLook.x * (1.0 - max(gCover, smoothstep(0.15, 0.5, gScrape)));
  float band = step(0.5, fract(vWPos.x / 5.2 + 0.13)) * 0.35 + 0.65;
  pn.x += sin(vWPos.x * 6.2831 / 0.031) * 0.32 * cord * band;
  // the tracks' relief (worked out with the albedo above), and the lumps of loose snow on what is heaped beside them
  pn.xz += gTN;
  if (gBerm > 0.12) {
    vec2 ch = texture2D(uGrain, vWPos.xz * 2.7 + 0.31).rg * 2.0 - 1.0;
    pn.xz += ch * smoothstep(0.12, 0.6, gBerm) * uTrackLook.w * 0.55;
  }
  pn = normalize(pn);
  gPN = pn;
  normal = normalize((viewMatrix * vec4(pn, 0.0)).xyz);
}`)
      // glints and the cold shade
      .replace('#include <opaque_fragment>', `
{
  float camD = length(vWPos - cameraPosition);
  vec3 V = normalize(cameraPosition - vWPos);
  ${detail ? `if (camD < 40.0) {     // (they have faded out by 40 m: nothing worked out further off)
  vec3 cell = floor(vWPos * 70.0);
  float r = hash13(cell);
  vec3 fn = normalize(vec3(hash33(cell) * 2.0 - 1.0) + vec3(0.0, 1.2, 0.0));
  float gl = pow(max(0.0, dot(reflect(-uSunDir, fn), V)), 120.0) * step(0.84, r);
  float sunlit = smoothstep(0.08, 0.5, dot(reflectedLight.directDiffuse, vec3(0.33)));
  float fade = 1.0 - smoothstep(6.0, 40.0, camD);
  outgoingLight += vec3(1.0, 0.97, 0.92) * gl * 7.0 * sunlit * fade * uSparkle * (1.0 - gRock) * (1.0 - uNight);
  }` : ''}   // (no glints on the low tier: they cost about 0.35 ms a frame up close on the test machine)
  float lit = dot(reflectedLight.directDiffuse, vec3(0.33));
  outgoingLight -= reflectedLight.directDiffuse * gTrackShadow * 0.75;
  // (a deep trench sees less of the sky)
  outgoingLight -= reflectedLight.indirectDiffuse * gCover * gTDep * clamp(uTrackDepth * 2.5, 0.0, 0.55);
  // the park's lamps' pools (worked out at the corners, the vertex shader): the snow's own relief, tracks and all,
  // catches their light; only half of it: their light is spread wide and bounced about the white slope, so a wall
  // turned away from them is shaded, not black
  if (uLamps > 0.001 && vLamp.w > 1e-5) {
    vec3 n0 = normalize(vWNor), wn = normalize(n0 + (gPN - n0) * 0.5), l = normalize(vLamp.xyz);
    float relief = clamp(max(0.0, dot(wn, l)) / max(dot(n0, l), 0.15), 0.0, 2.0);
    outgoingLight += diffuseColor.rgb * vec3(1.0, 0.88, 0.72) * vLamp.w * relief * uLamps * (1.0 - gTrackShadow * 0.15);
  }
  // by night the light that lights the rider comes from the nearest lamps (env.js follow): the snow keeps only a little
  // of it (enough for the rider's shadow) and is lit by the pools instead (less what a track's shadow already took, or
  // a shaded groove would go below black)
  if (uNight > 0.001) outgoingLight -= (reflectedLight.directDiffuse * (1.0 - gTrackShadow * 0.75) + reflectedLight.directSpecular) * uNight * 0.85;
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
