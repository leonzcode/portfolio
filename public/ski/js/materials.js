// Materials. The snow is three's standard material with more in it: the grain and the soft lumps of real snow (normal
// maps from ambientCG, CC0), the groomer's corduroy on the run, the tracks from the track map (snow.js), glints where
// single crystals catch the sun, a cold tint in the shade, rock on the steepest walls, the look of each kind of snow
// (env.js: groomed, powder, packed, spring slush, ice), the floodlights' pools by night, and fog the colour of the sky's
// own horizon in each direction.
import * as THREE from 'three';
import { rng } from './noise.js?v=24';
import { ground, onMountain } from './terrain.js?v=24';

// a tileable height/normal picture: periodic value noise in a few octaves
// (2026-11-12, loading: the same bytes as before, with each texel's cell worked out once a row and once a column instead
// of through two small functions each time: about a third of the time, 0.1 s less of the start on a slow processor)
function noiseTexture(size = 256, seed = 3) {
  const r = rng(seed), H = new Float32Array(size * size);
  for (const [cells, amp] of [[8, 1], [16, 0.55], [32, 0.3], [64, 0.16], [128, 0.08]]) {
    const L = new Float32Array(cells * cells); for (let i = 0; i < L.length; i++) L[i] = r() * 2 - 1;
    // (x and y run 0..size-1: a texel's cell and the next one along, which past the last is the first, and the smoothed
    // place between them)
    const I0 = new Int32Array(size), I1 = new Int32Array(size), T = new Float64Array(size);
    for (let x = 0; x < size; x++) { const f = x / size * cells, i = Math.floor(f); let t = f - i; t = t * t * (3 - 2 * t); I0[x] = i % cells; I1[x] = (i + 1) % cells; T[x] = t; }
    for (let y = 0; y < size; y++) {
      const r0 = I0[y] * cells, r1 = I1[y] * cells, ty = T[y];
      for (let x = 0; x < size; x++) {
        const tx = T[x], a = L[r0 + I0[x]], b = L[r0 + I1[x]], c = L[r1 + I0[x]], d = L[r1 + I1[x]];
        H[y * size + x] += amp * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
      }
    }
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1 + size) % size) * size, yp = ((y + 1) % size) * size, y0 = y * size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size, xp = (x + 1) % size;
      const dx = (H[y0 + xp] - H[y0 + xm]) * 2.2, dy = (H[yp + x] - H[ym + x]) * 2.2;
      const l = Math.hypot(dx, dy, 1), k = (y0 + x) * 4;
      data[k] = (-dx / l * 0.5 + 0.5) * 255; data[k + 1] = (-dy / l * 0.5 + 0.5) * 255;
      data[k + 2] = (H[y0 + x] * 0.35 + 0.5) * 255; data[k + 3] = r() * 255;
    }
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
  // (2026-11-11) 1 once the rock field also carries the mountain's own light (Freeride's, frfield.js): how much sky a
  // place sees (g), whether the sun reaches it (b), how exposed it is to the wind (a)
  uFieldLight: { value: 0 },
  // (2026-11-11, Freeride) real rock: Poly Haven's "Dark Rock 02" (CC0), its colour with its height in alpha and its
  // normal with its occlusion (tex/rock_col.webp, tex/rock_nrm.webp); uRockTex 1 once both have come
  uRockCol: { value: null },
  uRockNrm: { value: null },
  uRockTex: { value: 0 },
};
/* (2026-11-11) the look a map asks for: Freeride's snow (freerideLook) has its wind texture and its rock from real
   pictures; the other maps keep theirs (a program of its own, so theirs costs what it did) */
export const LOOK = { fr: false };
export function freerideLook() {
  if (LOOK.fr) return; LOOK.fr = true;
  let n = 0;
  const load = (url, srgb) => {
    const t = new THREE.TextureLoader().load(url, () => { if (++n === 2) snowUniforms.uRockTex.value = 1; });
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    return t;
  };
  snowUniforms.uRockCol.value = load('./tex/rock_col.webp', true);
  snowUniforms.uRockNrm.value = load('./tex/rock_nrm.webp', false);
}
/* the field (above) at a world place, for the other materials that read the mountain's own light (frrock.js, world.js):
   (steepness, sky seen, sun reaching it, wind exposure), (1, 1, 1, 0.5) where there is none */
export const FIELD_GLSL = `
uniform sampler2D uRockMap; uniform sampler2D uRockMap2; uniform vec4 uRockWin; uniform vec4 uRockWin2; uniform float uFieldLight;
vec4 fieldAt(vec2 xz) {
  vec4 f = vec4(1.0, 1.0, 1.0, 0.5);
  if (uFieldLight < 0.5) return f;
  vec2 u = (xz - uRockWin2.xy) * uRockWin2.z; float e = min(min(u.x, 1.0 - u.x), min(u.y, 1.0 - u.y));
  f = mix(f, texture2D(uRockMap2, u), smoothstep(0.0, 0.03, e));
  u = (xz - uRockWin.xy) * uRockWin.z; e = min(min(u.x, 1.0 - u.x), min(u.y, 1.0 - u.y));
  return mix(f, texture2D(uRockMap, u), smoothstep(0.0, 0.06, e));
}`;
export const fieldUniforms = s => { for (const k of ['uRockMap', 'uRockMap2', 'uRockWin', 'uRockWin2', 'uFieldLight']) s.uniforms[k] = snowUniforms[k]; };

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
export const rockField = { height: null, center: null, adjust: null, state: 0, data: [] };
// the two windows round a middle: texels a side, metres a texel, the corner
const ROCK_LEVELS = [{ N: 320, r: 4 }, { N: 256, r: 32 }];
export function rockLevels(c) { return ROCK_LEVELS.map(L => ({ N: L.N, r: L.r, x0: c[0] - L.N * L.r / 2, z0: c[1] - L.N * L.r / 2 })); }
function setRockLevel(i, data, c) {
  const L = rockLevels(c)[i], u = i ? snowUniforms.uRockWin2 : snowUniforms.uRockWin, m = i ? snowUniforms.uRockMap2 : snowUniforms.uRockMap;
  m.value = rockTexture(data, L.N); u.value.set(L.x0, L.z0, 1 / (L.N * L.r), 1);
  rockField.data[i] = data.length === L.N * L.N * 4 ? { data, L } : null;
}
// (main.js: the bake starts once this promise is done, not at the first compile)
export function rockFieldAfter(p) { rockField.after = p; }
// (a map with its own source can start the bake at once: its heights do not wait for the rest of the world)
export function setRockSource(height, center, adjust) { rockField.height = height; rockField.center = center; rockField.adjust = adjust || null; bakeRockField(); }
/* (or have a module worker work it out, off the page's own thread: Freeride's land is plain JS a worker can load. The
   worker is sent the windows and posts back each one's texels; if it cannot start, the page bakes it itself) */
/* (2026-11-11: light, Freeride's: the worker also works out the mountain's own light in the same texels, frfield.js, and
   stays to work out the sun's shadows again for each new sun, setFieldSun) */
export function rockFieldWorker(url, center, fallback, light = false) {
  let w = null;
  try { w = new Worker(url, { type: 'module' }); } catch (e) { w = null; }
  if (!w) { fallback(); return; }
  rockField.state = 1; rockField.center = center;
  w.onmessage = e => {
    const d = e.data;
    if (d.ms) (rockField.ms || (rockField.ms = [])).push((d.data ? 'level ' : d.ga ? 'light ' : 'sun ') + d.i + ' ' + Math.round(d.ms) + ' ms');
    if (d.data) {
      setRockLevel(d.i, d.data, center);
      if (d.i === ROCK_LEVELS.length - 1) { rockField.state = 2; if (light) { snowUniforms.uFieldLight.value = 1; FIELD.ready = true; FIELD.send(); } else w.terminate(); }
    } else if (d.b) {
      // a new sun's shadows: into the blue channel of the texels kept, sent to the graphics card again
      const k = rockField.data[d.i], m = d.i ? snowUniforms.uRockMap2 : snowUniforms.uRockMap;
      if (k) { const D = k.data, b = d.b; for (let t = 0, n = b.length; t < n; t++) D[t * 4 + 2] = b[t]; m.value.needsUpdate = true; }
      if (d.i === ROCK_LEVELS.length - 1) { FIELD.busy = false; FIELD.send(); }
    } else if (d.ga) {
      // the sky and the wind (after the steepness: frfield.js), into the green and alpha channels
      const k = rockField.data[d.i], m = d.i ? snowUniforms.uRockMap2 : snowUniforms.uRockMap;
      if (k) { const D = k.data, ga = d.ga; for (let t = 0, n = ga.length / 2; t < n; t++) { D[t * 4 + 1] = ga[t * 2]; D[t * 4 + 3] = ga[t * 2 + 1]; } m.value.needsUpdate = true; }
    } else if (d.g) {
      // the sky under the trees (the finest window), into the green channel
      const k = rockField.data[d.i], m = d.i ? snowUniforms.uRockMap2 : snowUniforms.uRockMap;
      if (k) { const D = k.data, g = d.g; for (let t = 0, n = g.length; t < n; t++) D[t * 4 + 1] = g[t]; m.value.needsUpdate = true; }
    }
  };
  w.onerror = () => { w.terminate(); FIELD.w = null; snowUniforms.uFieldLight.value = 0; if (rockField.state < 2) { rockField.state = 0; fallback(); } };
  w.postMessage({ levels: rockLevels(center), light });
  if (light) FIELD.w = w;
}
/* the sun for the field's shadows (env.js apply, each change of the time of day): sent when it has moved more than
   about a third of a degree, one at a time (a slider dragged sends the latest when the one before is done) */
const FIELD = {
  w: null, ready: false, busy: false, want: null, sent: null,
  send() {
    if (!this.w || !this.ready || this.busy || !this.want) return;
    const a = this.want, b = this.sent;
    if (b && a[0] * b[0] + a[1] * b[1] + a[2] * b[2] > 0.99998) return;
    this.sent = a.slice(); this.busy = true; this.w.postMessage({ sun: this.sent });
  },
};
export function setFieldSun(dir) { FIELD.want = [dir.x, dir.y, dir.z]; FIELD.send(); }
// the trees, for their shade on the snow (frfield.js): [{ x, z, s }], sent once (Freeride's forest, freeride.js)
export function setFieldTrees(list) {
  if (!FIELD.w) return;
  const a = new Float32Array(list.length * 3);
  list.forEach((t, i) => { a[i * 3] = t.x; a[i * 3 + 1] = t.z; a[i * 3 + 2] = t.s; });
  FIELD.w.postMessage({ trees: a }, [a.buffer]);
}
// the field's light at a place on the page's own thread (sky seen, sun reaching it), from the finest window holding it
export function fieldLight(x, z, out = { sky: 1, sun: 1 }) {
  out.sky = 1; out.sun = 1;
  for (const k of rockField.data) {
    if (!k) continue;
    const { N, r, x0, z0 } = k.L, i = Math.floor((x - x0) / r), j = Math.floor((z - z0) / r);
    if (i < 0 || j < 0 || i >= N || j >= N) continue;
    const t = (j * N + i) * 4; out.sky = k.data[t + 1] / 255; out.sun = k.data[t + 2] / 255; return out;
  }
  return out;
}
function rockTexture(data, N) {
  const t = new THREE.DataTexture(data, N, N, data.length === N * N * 4 ? THREE.RGBAFormat : THREE.RedFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}
function bakeRockField() {
  if (rockField.state) return;
  // (2026-11-12, loading: on a map whose snow has no rock, the Jump Line, the bake waits for the start to be over;
  // until it is in, the snow is drawn as all gentle, as it is there anyway)
  if (rockField.after) { const p = rockField.after; rockField.after = null; p.then(bakeRockField, bakeRockField); return; }
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
    const fr = LOOK.fr;      // (Freeride's look: its rock from real pictures, its wind-blown snow; set before the first compile)
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
uniform sampler2D uRockCol; uniform sampler2D uRockNrm; uniform float uRockTex; vec3 gRN;
uniform float uLamps; varying vec4 vLamp; uniform vec2 uFarFade; uniform sampler2D uGrain; uniform sampler2D uLumps; uniform float uTrackDepth;
float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3 hash33(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float gRock; float gTrackShadow; float gScrape; float gCover; float gTDep; float gBerm; vec2 gTN; vec4 gLump; vec3 gPN;
// the snow's steepness for the rock, from the rock field where it is ready (the same at a place whatever patch draws it)
uniform sampler2D uRockMap; uniform sampler2D uRockMap2; uniform vec4 uRockWin; uniform vec4 uRockWin2; uniform float uFieldLight;
// (2026-11-11) the field here: (steepness, sky seen, sun reaching it, wind exposure); without the field's light (any map but
// Freeride) the last three are (1, 1, 0.5)
vec4 gFld;
vec4 field(float ny) {
  vec4 f = vec4(ny, 1.0, 1.0, 0.5);
  if (uRockWin2.w > 0.5) { vec2 u = (vWPos.xz - uRockWin2.xy) * uRockWin2.z; float e = min(min(u.x, 1.0 - u.x), min(u.y, 1.0 - u.y)); f = mix(f, texture2D(uRockMap2, u), smoothstep(0.0, 0.03, e)); }
  if (uRockWin.w > 0.5) { vec2 u = (vWPos.xz - uRockWin.xy) * uRockWin.z; float e = min(min(u.x, 1.0 - u.x), min(u.y, 1.0 - u.y)); f = mix(f, texture2D(uRockMap, u), smoothstep(0.0, 0.06, e)); }
  return uFieldLight > 0.5 ? f : vec4(f.r, 1.0, 1.0, 0.5);
}`)
      // albedo: rock on steep faces, compacted grey-blue in tracks
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 wn = normalize(vWNor);
  float camD = length(vWPos - cameraPosition);
  // (2026-11-07: the terrain's steepness from the rock field, not its patch's normals: no patch-shaped edges. The
  // kickers' own meshes (groomed 0.65) keep their normals)
  gFld = field(wn.y);
  float rny = vGroom < 0.5 ? gFld.r : wn.y;
  float steep = smoothstep(0.80, 0.62, rny);
  // (2026-11-06, the lag pass: rock only where the snow is steep enough for it, so most of the snow skips its three
  // lookups; the same picture)
  gRock = 0.0;
  if (steep > 0.0 && vGroom < 1.0) {
    float rn = texture2D(uNoise, vWPos.xz * 0.013).b + texture2D(uNoise, vWPos.xz * 0.05 + vWPos.y * 0.02).b * 0.5;
    ${fr ? `/* (Freeride, 2026-11-11) rock from the real picture (materials.js freerideLook), seen from the three axes, and the
       snow's edge on it by the rock's own relief: the snow fills the hollows and lies on the shelves, the rock's knobs
       and edges stand out of it, crisp, as on a real face (it was a soft grey blot) */
    gRN = vec3(0.0);
    if (uRockTex > 0.5) {
      // (how steep, the big and middle noise, a finer one and the rock's own relief, against one crisp edge, as wide as a
      // pixel there: no grey wash where rock and snow mix, rock and snow side by side at any distance)
      // (and streaks down the fall line, as rock shows on a face: in ribs and runnels, not round blots; the faces here
      // fall to +z, the bowls' walls to the side, where the streaks lie across them as the rock's beds do)
      // (the steepness and the big noise first: only where they bring the edge within reach are the rock's pictures and
      // the finer noise looked at, so most of a steep snow face costs one more lookup, not six)
      float s1 = texture2D(uNoise, vec2(vWPos.x * 0.034, vWPos.z * 0.0085) + 0.13).b;
      float nearR = 1.0 - smoothstep(15.0, 60.0, camD);
      float e = (0.8 - rny) * 2.4 + (rn - 0.75) * 0.42 + (s1 - 0.5) * 0.6;
      float w = max(fwidth(e) * 0.7, mix(0.015, 0.004, nearR));
      gRock = 0.0;
      if (e > 0.3 - w - 0.19 - 0.09 * nearR) {
        vec3 bl = pow(abs(wn), vec3(4.0)); bl /= bl.x + bl.y + bl.z;
        ${detail ? `vec4 rc = texture2D(uRockCol, vWPos.zy * 0.25) * bl.x + texture2D(uRockCol, vWPos.xz * 0.25) * bl.y + texture2D(uRockCol, vWPos.xy * 0.25) * bl.z;
        float n3 = texture2D(uNoise, vWPos.xz * 0.22 + 0.21).b, s2 = texture2D(uNoise, vec2(vWPos.x * 0.11, vWPos.z * 0.03) + 0.57).b;` :
        // (the low tier: the picture from above only, and the finer noise from the one picture, three lookups fewer)
        `vec4 rc = texture2D(uRockCol, vWPos.xz * 0.25);
        vec4 nn = texture2D(uNoise, vWPos.xz * 0.22 + 0.21); float n3 = nn.b, s2 = nn.r;`}
        // (near by, the rock's own relief rough on its edge; far off, where the picture is blurred, the noise's)
        e += (s2 - 0.5) * 0.18 + (rc.a - 0.5) * (0.2 + 0.35 * nearR) + (n3 - 0.5) * 0.12;
        gRock = smoothstep(0.3 - w, 0.3 + w, e) * (1.0 - vGroom);
        if (gRock > 0.0) {
          vec3 col = mix(vec3(dot(rc.rgb, vec3(0.3, 0.55, 0.15))), rc.rgb, 0.75) * 2.9 * (0.85 + 0.3 * ${detail ? 'texture2D(uNoise, vWPos.xz * 0.05).b' : 's1'});
          // (snow lying on the rock's own high shelves, a dusting on its knobs)
          col = mix(col, vec3(0.86, 0.89, 0.94), smoothstep(0.62, 0.76, rc.a + (n3 - 0.5) * 0.4) * 0.6);
          diffuseColor.rgb = mix(diffuseColor.rgb, col, gRock);
          ${detail ? `vec2 a = texture2D(uRockNrm, vWPos.zy * 0.25).rg * 2.0 - 1.0, b = texture2D(uRockNrm, vWPos.xz * 0.25).rg * 2.0 - 1.0, c = texture2D(uRockNrm, vWPos.xy * 0.25).rg * 2.0 - 1.0;
          gRN = (vec3(0.0, a.y, a.x) * bl.x + vec3(b.x, 0.0, b.y) * bl.y + vec3(c.x, c.y, 0.0) * bl.z) * gRock;` : ''}
        }
      }
    } else` : ''} {
    gRock = steep * smoothstep(0.45, 0.62, rn + (0.8 - rny) * 0.6) * (1.0 - vGroom);
    if (gRock > 0.0) {
      vec3 rock = mix(vec3(0.20, 0.19, 0.18), vec3(0.34, 0.32, 0.30), texture2D(uNoise, vWPos.xz * 0.2).b);
      diffuseColor.rgb = mix(diffuseColor.rgb, rock, gRock);
    }
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
  ${fr && detail ? `/* (Freeride, 2026-11-11; not on the low tier) wind-blown snow off the groomed run: where the land stands out to
     the wind (the field's a: crests, lips, ribs) the snow is carved into sastrugi, ridges a metre or two long lying
     along the wind; in the hollows it lies soft. The wind blows across the face from the west. */
  {
    float wk = smoothstep(0.42, 0.75, gFld.a) * (1.0 - vGroom) * (1.0 - gRock) * (1.0 - smoothstep(60.0, 220.0, camD));
    if (wk > 0.0) {
      vec2 wd = vec2(0.94, 0.34), wq = vec2(dot(vWPos.xz, wd), dot(vWPos.xz, vec2(-wd.y, wd.x)));
      vec2 sg = texture2D(uNoise, vec2(wq.x * 0.07, wq.y * 0.28)).rg * 2.0 - 1.0;
      sg += (texture2D(uNoise, vec2(wq.x * 0.2, wq.y * 0.8) + 0.41).rg * 2.0 - 1.0) * 0.45;
      pn.xz += (wd * sg.x * 0.6 + vec2(-wd.y, wd.x) * sg.y) * 0.11 * wk * (1.0 - side * 0.6);
    }
  }
  pn += gRN * 0.8;` : ''}
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
  float sunlit = smoothstep(0.08, 0.5, dot(reflectedLight.directDiffuse, vec3(0.33))) * gFld.b;
  float fade = 1.0 - smoothstep(6.0, 40.0, camD);
  outgoingLight += vec3(1.0, 0.97, 0.92) * gl * 7.0 * sunlit * fade * uSparkle * (1.0 - gRock) * (1.0 - uNight);
  }` : ''}   // (no glints on the low tier: they cost about 0.35 ms a frame up close on the test machine)
  /* (2026-11-11) the mountain's own light, Freeride's field: out of the sun behind a ridge, a rib or a cliff (not by
     night: the floodlights' light is not the sun's), and less of the sky's light in a gully, a chute, under a wall */
  float sunV = mix(1.0, gFld.b, 1.0 - uNight), skyV = gFld.g;
  float lit = dot(reflectedLight.directDiffuse, vec3(0.33)) * sunV;
  outgoingLight -= reflectedLight.directDiffuse * (1.0 - (1.0 - gTrackShadow * 0.75) * sunV) + reflectedLight.directSpecular * (1.0 - sunV);
  outgoingLight -= (reflectedLight.indirectDiffuse + reflectedLight.indirectSpecular) * (1.0 - skyV) * 0.85;
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
  m.customProgramCacheKey = () => 'snow' + (detail ? 'D' : 'L') + (LOOK.fr ? 'F' : '');
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
