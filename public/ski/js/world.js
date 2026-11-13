// The world round the park: the sky (env.js), conifers (detailed near, flat cards far), a chairlift, park fencing,
// flags and the start arch. (The far mountain ranges are gone: Leon, 2026-11-05, "remove the mountains in the
// background and replace with just a blue sky for now".)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { height, ground, runHalf, baseLine, normal, getPark } from './terrain.js?v=23';
import { fbm, ridged, rng, smoothstep } from './noise.js?v=23';
import { Env, buildPanel } from './env.js?v=23';
import { snowUniforms, FIELD_GLSL, fieldUniforms } from './materials.js?v=23';

// the sky, the sun and sky light, the fog and the reflections are env.js's (photographs of real skies, the time of
// day and the weather chosen on the home screen); makeSky keeps its old shape for main.js: { sky, sun, hemi, sunDir, follow }
export function makeSky(scene, renderer, q, wide) {
  const env = new Env(scene, renderer, q, wide);
  RENDERER = renderer;
  buildPanel(env, document.getElementById('opt-scene'));
  return { sky: env.dome, sun: env.sun, hemi: env.hemi, sunDir: env.sunDir, env, follow: p => env.follow(p) };
}

// ---- trees ----------------------------------------------------------------------------------------------------------
/* (2026-11-08, for "trees: see-through leaves, more realistic". The conifers were solid cones of flat green.) A tree is
   now a trunk, a dark core and whorls of branches, each branch a card with a photographed fir twig on it, its needles
   cut out of the card by their own outline (an alpha test: the sky and the snow show between them), drooping more
   towards the tip, snow lying on the upper sides in clumps and the sun shining through the needles from behind. The
   pictures are Poly Haven's "Fir Tree 01" (CC0): four of its twig sprays, a strip of its bark and a strip of its
   sprays heaped up dark (the crown's middle) in one 512 px picture, tex/fir_atlas.webp. Far off a tree is a pair of
   crossed cards with a picture of the same tree taken once at load (an impostor), so near and far match where one
   fades into the other. All the near trees are still one draw, all the
   far ones another. */
// the four twig sprays in the picture (u0, v0, u1, v1: the stem at v0, the tip at v1), and the bark strip's width in u
// (the crown's dark middle is the next strip, as wide)
const FIR_RECTS = [[0.1309, 0.5059, 0.5566, 0.9746], [0.5742, 0.5059, 0.9863, 0.9941], [0.1309, 0.0059, 0.5566, 0.4785], [0.5703, 0.0059, 0.9902, 0.4922]];
const BARK_U = 0.0625;
// a conifer one unit tall (scaled by each tree's size): segs, the cards along each branch (1 on the low tier: a flat
// card from the trunk to the tip; 2: bending down from half way)
function coniferGeometry(r, segs) {
  const P = [], N = [], U = [], C = [], S = [], I = [];
  const vert = (x, y, z, nx, ny, nz, u, v, cr, cg, cb, sn) => { const l = Math.hypot(nx, ny, nz) || 1; P.push(x, y, z); N.push(nx / l, ny / l, nz / l); U.push(u, v); C.push(cr, cg, cb); S.push(sn); return P.length / 3 - 1; };
  // the trunk: a tapering post with the bark on it
  const ring = (n, y0, r0, y1, r1, u0, u1, col, ny) => {
    const base = P.length / 3;
    for (let k = 0; k <= n; k++) {
      const a = k / n * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), u = u0 + (u1 - u0) * k / n;
      vert(ca * r0, y0, sa * r0, ca, ny, sa, u, 0.02, col[0], col[1], col[2], 0);
      vert(ca * r1, y1, sa * r1, ca, ny, sa, u, 0.98, col[0] * 1.1, col[1] * 1.1, col[2] * 1.1, 0.15);
    }
    for (let k = 0; k < n; k++) { const q = base + k * 2; I.push(q, q + 1, q + 2, q + 2, q + 1, q + 3); }
  };
  ring(6, -0.02, 0.024, 0.96, 0.004, 0, BARK_U, [0.85, 0.85, 0.85], 0);
  // the dark core inside the branches (needles heaped in shade: what shows between the branches deep in a crown)
  ring(6, 0.08, 0.06, 0.8, 0.008, BARK_U + 0.004, BARK_U * 2 - 0.004, [0.95, 1, 0.95], 0.5);
  // the branches, in whorls up the trunk: longest at the bottom, more of them low down, drooping more there
  const T = segs > 1 ? 13 : 11;
  for (let i = 0; i < T; i++) {
    const t = i / (T - 1), y = 0.1 + t * 0.83;
    const R = (0.27 * Math.pow(1 - t, 0.85) + 0.045) * (0.88 + r() * 0.24);
    const nb = Math.max(3, Math.round((segs > 1 ? 6.6 : 6) - t * 2.4 + r() * 0.8)), rot = r() * 6.283;
    for (let j = 0; j < nb; j++) {
      const ang = rot + j / nb * Math.PI * 2 + (r() - 0.5) * 0.6, dx = Math.cos(ang), dz = Math.sin(ang), tx = -dz, tz = dx;
      const L = R * (0.85 + r() * 0.3), W = L * 0.46, rect = FIR_RECTS[(r() * 4) | 0], roll = (r() - 0.5) * 0.5;
      const sag = L * (0.3 + 0.28 * (1 - t)) * (0.8 + r() * 0.4), lift = L * 0.05;
      // (the lower branches are sheltered by the ones above: less snow, more shade)
      const bright = (0.82 + r() * 0.3) * (0.82 + 0.18 * t), snow = (0.4 + r() * 0.5) * (0.72 + 0.45 * t);
      // rows from the trunk out: [how far along, how far down, how bright, how much snow]
      const rows = segs > 1 ? [[0.02, -lift, 0.5, 0.95], [0.5, sag * 0.32, 0.82, 1], [1, sag, 1.02, 0.6]] : [[0.02, -lift, 0.55, 0.95], [1, sag * 0.8, 1, 0.75]];
      const base = P.length / 3;
      for (const [f, dn, br, sn] of rows) {
        const cx = dx * (0.012 + f * L), cy = y - dn, cz = dz * (0.012 + f * L), v = rect[1] + (rect[3] - rect[1]) * f;
        // (the light falls on a branch as on a round crown: up at the trunk, out and up at the tip)
        const nx = dx * (0.25 + 0.6 * f), ny = 0.85, nz = dz * (0.25 + 0.6 * f), c = bright * br;
        vert(cx - tx * W, cy + W * roll, cz - tz * W, nx, ny, nz, rect[0], v, c * 0.93, c, c * 0.9, snow * sn);
        vert(cx + tx * W, cy - W * roll, cz + tz * W, nx, ny, nz, rect[2], v, c * 0.93, c, c * 0.9, snow * sn);
      }
      // (wound so the upper side is the front: the snow lies on the front)
      for (let k = 0; k < rows.length - 1; k++) { const q = base + k * 2; I.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
    }
  }
  // the leader: two crossed sprays standing up at the top
  for (const [dx, dz] of [[1, 0], [0, 1]]) {
    const rect = FIR_RECTS[1], w = 0.045, y0 = 0.84, y1 = 1.0, base = P.length / 3;
    vert(-dx * w, y0, -dz * w, 0, 1, 0, rect[0], rect[1], 0.8, 0.86, 0.78, 0.3); vert(dx * w, y0, dz * w, 0, 1, 0, rect[2], rect[1], 0.8, 0.86, 0.78, 0.3);
    vert(-dx * w, y1, -dz * w, 0, 1, 0, rect[0], rect[3], 1, 1, 0.95, 0.2); vert(dx * w, y1, dz * w, 0, 1, 0, rect[2], rect[3], 1, 1, 0.95, 0.2);
    I.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('aSnow', new THREE.Float32BufferAttribute(S, 1)); g.setIndex(I);
  return g;
}
// fog the colour of the sky's horizon the way the camera looks (as the snow has it), not the one colour all round: far
// trees at sunset fade into the bright sky by the sun and the dark one opposite (vTW: the world place)
const TREE_FOG = `#ifdef USE_FOG
  float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  vec3 fdir = normalize(vTW - cameraPosition);
  gl_FragColor.rgb = mix( gl_FragColor.rgb, texture2D(uHorizon, vec2(atan(fdir.z, fdir.x) * 0.1591549 + 0.5, 0.5)).rgb, fogFactor );
#endif`;
// the renderer, for taking the far trees' picture (makeSky is handed it first)
let RENDERER = null;
const FAR_W = 0.42;      // (the far card's half width, one unit tall: the longest branches reach about 0.42 either side)
const frac = x => ((x % 1) + 1) % 1;
export class Forest {
  constructor(scene, q, mtn) {
    const r = rng(5);
    this.trees = [];
    const max = q.tier === 'low' ? 2600 : q.tier === 'medium' ? 5000 : 8000;
    // on a real mountain: below the treeline, thinning as it nears, on ground not too steep
    // (a made-up mountain places its own: mtn.trees(max, random), Freeride's)
    if (mtn && mtn.trees) this.trees.push(...mtn.trees(max, r));
    else if (mtn) for (let tries = 0; this.trees.length < max && tries < max * 12; tries++) {
      const a = r() * Math.PI * 2, d = 30 + Math.sqrt(r()) * 2600, x = Math.cos(a) * d, z = Math.sin(a) * d;
      const y = height(x, z), line = mtn.spot.treeline + 60 * fbm(x * 0.004, z * 0.004, 2);
      if (y > line || r() < smoothstep(line - 150, line, y) * 0.9) continue;
      if (fbm(x * 0.01 + 3, z * 0.01, 3) < -0.15) continue;
      const n = normal(x, z); if (n.y < 0.8) continue;
      this.trees.push({ x, y: y - 0.3, z, s: 6 + r() * 11, rot: r() * 6.28 });
    }
    // scattered in clumps beside the run and up the valley sides
    if (!mtn) for (let tries = 0; this.trees.length < max && tries < max * 8; tries++) {
      const z = -300 + r() * 1900, side = r() < 0.5 ? -1 : 1;
      const d = 4 + Math.pow(r(), 1.6) * 360;
      const x = side * (runHalf(z) + d);
      const clump = fbm(x * 0.012, z * 0.012, 3);
      if (clump < -0.05 + d * 0.0008) continue;
      const n = normal(x, z); if (n.y < 0.8) continue;
      if (ground(x, z) - baseLine(z) > 140) continue;
      const s = 6 + r() * 10 + (d < 30 ? 0 : r() * 6);
      this.trees.push({ x, y: height(x, z) - 0.3, z, s, rot: r() * 6.28 });
    }
    // a grid of the trees for collisions (8 m cells)
    this.grid = new Map();
    for (const t of this.trees) { const k = Math.floor(t.x / 8) + ',' + Math.floor(t.z / 8); if (!this.grid.has(k)) this.grid.set(k, []); this.grid.get(k).push(t); }
    /* (2026-11-06, for smoother distance changes: a tree near the camera is a 3D conifer, further off a flat card, and
       they used to swap in batches every 15 m of camera movement, a row of trees popping from one to the other at once.
       Now each tree fades from one to the other over the last few metres of the near radius, worked out every frame
       from the camera on the graphics card (a fine dither: the near tree's pixels and the card's take turns, so
       together they always make one whole tree). Every card is in one buffer sent once (the ones near the camera are
       dropped at their corners, so they cost nothing to fill); only the short list of near trees changes, every 6 m.) */
    // (2026-11-08: the near trees are cards of needles now, each cut out pixel by pixel, which costs the graphics card more
    // than the solid cones did; on the low tier they give way to their far picture sooner, 50 m out, not 70)
    this.nearR = q.tier === 'low' ? 50 : 110; this.band = q.tier === 'low' ? 12 : 20; this.move = 6;
    const nearMax = q.tier === 'low' ? 320 : 640;
    this.geo = coniferGeometry(r, q.tier === 'low' ? 1 : 2);
    const uFade = { value: new THREE.Vector2(this.nearR - this.band, this.nearR) };
    // the fade worked out at each corner from its tree's place; fully faded, its triangles go out of view
    const fade = (far) => s => {
      s.uniforms.uTreeFade = uFade;
      s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>
uniform vec2 uTreeFade; varying float vTreeK;${far ? '\nattribute float aNear;' : ''}`).replace('#include <project_vertex>', `#include <project_vertex>
{
  float f = smoothstep(uTreeFade.x, uTreeFade.y, length(instanceMatrix[3].xz - cameraPosition.xz));
  vTreeK = ${far ? 'aNear > 0.5 ? f : 1.0' : '1.0 - f'};
  if (vTreeK < 0.002) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
}`);
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
varying float vTreeK;
// (a 4 x 4 ordered dither: the card keeps the pixels the near tree leaves)
float tb2(vec2 p) { return 2.0 * abs(p.x - p.y) + p.y; }
float treeDither() { vec2 p = mod(floor(gl_FragCoord.xy), 4.0); return (4.0 * tb2(mod(p, 2.0)) + tb2(floor(p * 0.5)) + 0.5) / 16.0; }`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  if (vTreeK < 0.999 && ${far ? 'treeDither() >= vTreeK' : 'treeDither() < 1.0 - vTreeK'}) discard;`);
    };
    const tex = this.tex = new THREE.TextureLoader().load('./tex/fir_atlas.webp', () => this.bake());
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    this.uImp = { value: 0 };
    const tm = new THREE.MeshLambertMaterial({ map: tex, vertexColors: true, alphaTest: 0.42, side: THREE.DoubleSide });
    // (by night the light that follows the rider is the park's floodlight: the trees keep only a little of it)
    const nearFade = fade(false), farFade = fade(true);
    tm.onBeforeCompile = s => {
      Object.assign(s.uniforms, { uNight: snowUniforms.uNight, uNoise: snowUniforms.uNoise, uSunDir: snowUniforms.uSunDir, uImp: this.uImp, uHorizon: snowUniforms.uHorizon, uSnowLook: snowUniforms.uSnowLook });
      fieldUniforms(s);
      nearFade(s);
      s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>
attribute float aSnow; varying float vSnow; varying vec3 vTW; varying vec2 vTL;
${FIELD_GLSL}`).replace('#include <project_vertex>', `#include <project_vertex>
vSnow = aSnow;
vTW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
vTL = fieldAt(instanceMatrix[3].xz).gb;     // (2026-11-11: the mountain's own light at the tree's foot: sky seen, sun)`);
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
uniform float uNight; uniform sampler2D uNoise; uniform vec3 uSunDir; uniform float uImp; uniform sampler2D uHorizon; uniform vec4 uSnowLook;
varying float vSnow; varying vec3 vTW; varying vec2 vTL; float gSn;`)
        .replace('#include <fog_fragment>', TREE_FOG)
        // snow in clumps on the upper sides (filling the gaps between the needles near the stem), the undersides darker
        .replace('#include <alphatest_fragment>', `{
  float n = texture2D(uNoise, vTW.xz * 1.3 + vTW.y * 0.7).b${q.tier === 'low' ? ' * 1.5' : ' + texture2D(uNoise, vTW.xz * 4.1 - vTW.y * 1.9).b * 0.5'};
  // (as much snow on the branches as the snow kind has had: more after powder, less in spring slush or on ice; env.js)
  float amt = clamp(1.0 + 0.25 * uSnowLook.y - 0.7 * uSnowLook.z - 0.45 * uSnowLook.w, 0.2, 1.25);
  gSn = gl_FrontFacing ? smoothstep(0.64, 0.95, n * 0.7 + vSnow * 0.6 * amt - (1.0 - amt) * 0.25) : 0.0;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.97), gSn);
  diffuseColor.a = max(diffuseColor.a, gSn * smoothstep(0.02, 0.2, diffuseColor.a) * 0.8);
  if (!gl_FrontFacing) diffuseColor.rgb *= 0.62;
}
#include <alphatest_fragment>`)
        // (lit as the round crown, both sides: not the card's own side, which would light a branch's underside from inside)
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
normal = normalize(vNormal);`)
        .replace('#include <opaque_fragment>', `outgoingLight -= (reflectedLight.directDiffuse + reflectedLight.directSpecular) * uNight * 0.7;
// (2026-11-11) out of the sun behind a ridge (not by night), less sky in a gully
if (uImp < 0.5) outgoingLight -= (reflectedLight.directDiffuse + reflectedLight.directSpecular) * (1.0 - vTL.y) * (1.0 - uNight) * 0.9 + reflectedLight.indirectDiffuse * (1.0 - vTL.x) * 0.6;
{
  // the sun through the needles, looking towards it (not through the snow on them)
  vec3 V = normalize(cameraPosition - vTW);
  float tr = pow(max(0.0, dot(-V, uSunDir)), 5.0) * (1.0 - uNight) * (1.0 - gSn) * mix(1.0, vTL.y, 1.0 - uNight);
  outgoingLight += diffuseColor.rgb * vec3(1.0, 0.95, 0.72) * tr * 1.1;
}
if (uImp > 0.5) outgoingLight = diffuseColor.rgb;      // (taking the far trees' picture: the colour alone)
#include <opaque_fragment>`);
    };
    tm.customProgramCacheKey = () => 'conifer4';
    this.near = new THREE.InstancedMesh(this.geo, tm, nearMax);
    this.near.castShadow = false; this.near.receiveShadow = q.tier !== 'low'; this.near.frustumCulled = false;   // (low: no shadows on the needles)
    /* (the lag pass: the near trees' shadows come from a copy holding only the trees that can shade the snow round the
       rider, those in the column of sunlight through the shadow map's box, drawn only into the shadow map (layer 5,
       env.js): all the near trees went into it before, about 34 000 triangles on the high tier, most of them outside
       the box. No tree shadows on the low tier, as before.) */
    if (q.tier !== 'low') {
      this.shade = new THREE.InstancedMesh(this.geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, colorWrite: false, map: tex, alphaTest: 0.42 }), nearMax);
      this.shade.layers.set(5); this.shade.castShadow = true; this.shade.frustumCulled = false; this.shade.count = 0; this.shade.name = 'trees shadow';
      this.shade.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.shade.matrixAutoUpdate = false;
      this.sunAt = new THREE.Vector3();
    }
    this.near.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.near.count = 0;
    const card = new THREE.PlaneGeometry(FAR_W * 2, 1); card.translate(0, 0.5, 0);
    const card2 = card.clone().rotateY(Math.PI / 2);
    const cards = new THREE.BufferGeometry();
    const cp = [...card.toNonIndexed().attributes.position.array, ...card2.toNonIndexed().attributes.position.array];
    const cu = [...card.toNonIndexed().attributes.uv.array, ...card2.toNonIndexed().attributes.uv.array];
    cards.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3)); cards.setAttribute('uv', new THREE.Float32BufferAttribute(cu, 2));
    cards.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(cp.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    // which trees are on the near list now (the others' cards always show whole)
    this.aNear = new Float32Array(this.trees.length);
    const an = new THREE.InstancedBufferAttribute(this.aNear, 1); an.setUsage(THREE.DynamicDrawUsage); cards.setAttribute('aNear', an);
    // (the picture of the near tree, taken in bake() once its picture has loaded; mipmapped, so far trees do not sparkle)
    const lowT = q.tier === 'low';
    this.impRT = new THREE.WebGLRenderTarget(lowT ? 112 : 184, lowT ? 136 : 224, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true });
    const cm = new THREE.MeshLambertMaterial({ map: this.impRT.texture, alphaTest: 0.38, side: THREE.DoubleSide });
    cm.onBeforeCompile = s => {
      s.uniforms.uNight = snowUniforms.uNight; s.uniforms.uHorizon = snowUniforms.uHorizon; farFade(s); fieldUniforms(s);
      s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>
varying vec3 vTW; varying vec2 vTL;
${FIELD_GLSL}`).replace('#include <project_vertex>', `#include <project_vertex>
vTW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
vTL = fieldAt(instanceMatrix[3].xz).gb;`);
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
uniform float uNight; uniform sampler2D uHorizon; varying vec3 vTW; varying vec2 vTL;`).replace('#include <opaque_fragment>', `outgoingLight -= reflectedLight.directDiffuse * uNight * 0.8;
outgoingLight -= reflectedLight.directDiffuse * (1.0 - vTL.y) * (1.0 - uNight) * 0.9 + reflectedLight.indirectDiffuse * (1.0 - vTL.x) * 0.6;
#include <opaque_fragment>`).replace('#include <fog_fragment>', TREE_FOG);
    };
    cm.customProgramCacheKey = () => 'treecard4';
    this.far = new THREE.InstancedMesh(cards, cm, this.trees.length);
    this.far.frustumCulled = false;
    // each tree's two matrices, worked out once: its card's straight into the card buffer, its near one kept for when it
    // is near
    this.mNear = new Float32Array(this.trees.length * 16);
    {
      const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), sc = new THREE.Vector3(), pp = new THREE.Vector3(), fa = this.far.instanceMatrix.array;
      this.trees.forEach((t, i) => {
        qq.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, t.rot); pp.set(t.x, t.y, t.z);
        const w = t.s * (0.8 + 0.22 * frac(t.rot * 7.31));
        m.compose(pp, qq, sc.set(w, t.s, w)); m.toArray(this.mNear, i * 16); m.toArray(fa, i * 16);
      });
      this.far.instanceMatrix.needsUpdate = true;
    }
    // (each tree its own shade of green, a little darker or lighter, bluer or more yellow, as a real forest is; the far
    // card the same as its near tree)
    this.cols = new Float32Array(this.trees.length * 3);
    this.trees.forEach((t, i) => {
      const h = frac(t.rot * 13.7), b = 0.9 + 0.2 * frac(t.rot * 5.3), w = (h - 0.5) * 0.12;
      this.cols[i * 3] = b * (1 + w * 0.6); this.cols[i * 3 + 1] = b; this.cols[i * 3 + 2] = b * (1 - w);
    });
    this.far.instanceColor = new THREE.InstancedBufferAttribute(this.cols.slice(), 3);
    this.near.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.near.instanceMatrix.count * 3).fill(1), 3);
    this.near.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.tx = Float32Array.from(this.trees, t => t.x); this.tz = Float32Array.from(this.trees, t => t.z);
    for (const o of [this.near, this.far]) o.matrixAutoUpdate = false;
    scene.add(this.near, this.far); if (this.shade) scene.add(this.shade);
    this.at = new THREE.Vector3(1e9, 0, 0);
    if (typeof window !== 'undefined') window.__skiForest = this;     // (a test handle)
  }
  update(cam) {
    if (this.bakedLook && !this.bakedLook.equals(snowUniforms.uSnowLook.value)) { this.baked = false; this.bake(); }
    const L = snowUniforms.uSunDir.value, sunMoved = this.shade && this.sunAt.distanceToSquared(L) > 4e-4;
    if (cam.distanceTo(this.at) < this.move && !sunMoved) return;
    this.at.copy(cam);
    if (this.shade) this.sunAt.copy(L);
    // the near list: every tree that can come inside the near radius before the next update (the fade does the rest)
    const R = this.nearR + this.move + 1, R2 = R * R, cap = this.near.instanceMatrix.count, src = this.mNear, dst = this.near.instanceMatrix.array, aN = this.aNear;
    const cx = cam.x, cz = cam.z, X = this.tx, Z = this.tz, cs = this.cols, nc = this.near.instanceColor.array;
    let ni = 0, si = 0;
    // (the shadow copy: a tree within about 60 m of the column of light through the shadow box, which reaches up towards
    // the sun from the rider; the box is 34 m each way, and 6 m more for a tree's own spread and for the camera moving)
    const sh = this.shade, sd = sh ? sh.instanceMatrix.array : null, cy = cam.y, P2 = 60 * 60;
    for (let i = 0, n = X.length; i < n; i++) {
      const dx = X[i] - cx, dz = Z[i] - cz;
      if (dx * dx + dz * dz < R2 && ni < cap) {
        const o = ni * 16, k = i * 16; for (let j = 0; j < 16; j++) dst[o + j] = src[k + j];
        nc[ni * 3] = cs[i * 3]; nc[ni * 3 + 1] = cs[i * 3 + 1]; nc[ni * 3 + 2] = cs[i * 3 + 2]; ni++; aN[i] = 1;
        if (sh) {
          const dy = src[k + 13] + src[k + 5] * 0.5 - cy, along = dx * L.x + dy * L.y + dz * L.z;
          if (along > -50 && dx * dx + dy * dy + dz * dz - along * along < P2) { const so = si * 16; for (let j = 0; j < 16; j++) sd[so + j] = src[k + j]; si++; }
        }
      } else aN[i] = 0;
    }
    this.near.count = ni;
    const im = this.near.instanceMatrix; im.clearUpdateRanges(); im.addUpdateRange(0, Math.max(16, ni * 16)); im.needsUpdate = true;
    const ic = this.near.instanceColor; ic.clearUpdateRanges(); ic.addUpdateRange(0, Math.max(3, ni * 3)); ic.needsUpdate = true;
    if (sh) { sh.count = si; const sm = sh.instanceMatrix; sm.clearUpdateRanges(); sm.addUpdateRange(0, Math.max(16, si * 16)); sm.needsUpdate = true; }
    this.far.geometry.attributes.aNear.needsUpdate = true;
  }
  /* the far cards' picture: one near tree drawn once into a small picture from the side, its colour alone (uImp), with
     a clear background, so a far tree is the same tree as near. Done as the twig picture comes, between frames. */
  bake() {
    const R = RENDERER; if (!R || this.baked) return;
    this.baked = true;
    const sc = new THREE.Scene(), one = new THREE.InstancedMesh(this.geo, this.near.material, 1);
    one.setMatrixAt(0, new THREE.Matrix4()); one.frustumCulled = false; sc.add(one);
    const cam = new THREE.OrthographicCamera(-FAR_W, FAR_W, 1.01, -0.01, 0.1, 10); cam.position.set(0, 0, 4); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
    const was = R.getRenderTarget(), cc = R.getClearColor(new THREE.Color()), ca = R.getClearAlpha();
    this.uImp.value = 1;
    R.setRenderTarget(this.impRT); R.setClearColor(0x16251b, 0); R.clear(true, true, false);
    R.render(sc, cam);
    R.setRenderTarget(was); R.setClearColor(cc, ca);
    this.uImp.value = 0;
    one.dispose();
    this.bakedLook = snowUniforms.uSnowLook.value.clone();      // (taken again when the snow kind changes: update)
  }
  nearCap() { return this.near.instanceMatrix.count; }
  // the tree whose trunk (and lower branches) a body of radius r at x, z touches, or null
  hit(x, z, r) {
    const cx = Math.floor(x / 8), cz = Math.floor(z / 8);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const l = this.grid.get((cx + i) + ',' + (cz + j)); if (!l) continue;
      for (const t of l) { const d = Math.hypot(t.x - x, t.z - z), R = 0.18 + t.s * 0.035 + r; if (d < R) return { t, d, R, nx: (x - t.x) / (d || 1), nz: (z - t.z) / (d || 1) }; }
    }
    return null;
  }
}

// ---- the far ranges ------------------------------------------------------------------------------------------------
// the horizon round a real mountain: the coarse elevation grid as one mesh, sunk under the fine terrain near the start
export function makeMountainRanges(scene, q, mtn) {
  const e = mtn.farExtent(), N = q.tier === 'low' ? 140 : 220;
  const pos = [], col = [], idx = [];
  const fe = mtn.ext, inFine = (x, z, m) => x > fe.x0 + m && x < fe.x1 - m && z > fe.z0 + m && z < fe.z1 - m;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const x = e.x0 + (e.x1 - e.x0) * i / N, z = e.z0 + (e.z1 - e.z0) * j / N;
    let y = mtn.farAt(x, z); if (inFine(x, z, 150)) y -= 40;
    pos.push(x, y, z);
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const nn = g.attributes.normal, snow = new THREE.Color(0xf2f5f9), rockC = new THREE.Color(0x5b5d62), forestC = new THREE.Color(0x26392d);
  for (let k = 0; k < nn.count; k++) {
    const ny = nn.getY(k), y = pos[k * 3 + 1], x = pos[k * 3], z = pos[k * 3 + 2], n = fbm(x * 0.003, z * 0.003, 2);
    const c = snow.clone().lerp(rockC, smoothstep(0.7, 0.45, ny + n * 0.1) * 0.85);
    const line = mtn.spot.treeline;
    if (y < line) c.lerp(forestC, smoothstep(line, line - 200, y + n * 80) * 0.8 * smoothstep(0.6, 0.85, ny));
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  m.name = 'ranges'; m.matrixAutoUpdate = false; scene.add(m);
  return m;
}

// (no far ranges round the park for now: kept as a function so main.js's call stands)
// (2026-11-11: but Freeride has its own, makeFarRange, below)
export function makeRanges(scene, q) { const park = getPark(); return park && park.freeride ? makeFarRange(scene, q) : null; }

/* ---- Freeride's far ranges (2026-11-11, for "better graphics for the entire mountain": its skyline was empty haze past
   the terrain's last patches, 2 km out). Two rings of made-up mountains round the venue, out past where the terrain is
   drawn: a nearer range rising from 3 km out to its crests at about 4.5 km, and a higher one behind it from 7 km, both
   ridged noise (sharp crests, gullies down their faces), snow where they are gentle enough to hold it, dark rock on
   their steep crests and faces, a dark band of forest low on the nearer one. Lit by the sun and the sky as everything
   else is (lit faces and shaded ones), and laid in the air's haze (the horizon's own colour that way, as the snow's fog
   has it), more of it the further and the lower: their feet go into the haze the far snow fades into. One mesh, one
   draw call: about 7 500 triangles on the low tier, 11 000 above. Nothing to ride: no physics, no shadows. */
function makeFarRange(scene, q) {
  const low = q.tier === 'low', C = [10, 250];
  const P = [], I = [], K = [];
  const ROCK = [0.085, 0.08, 0.075], SNOW = [0.84, 0.87, 0.92], WOOD = [0.045, 0.07, 0.05];
  // a range: its rows' radii, segments round, its height at a place
  // (its faces towards the venue no steeper than about 40 degrees between rows: a lone sharp peak over a low row in front
  // stood as a thin dark fin down into the haze; the row in front is raised into a buttress instead)
  const ring = (radii, segs, hAt) => {
    const base = P.length / 3, rows = radii.length, h = new Float32Array(rows * segs);
    for (let j = 0; j < rows; j++) for (let i = 0; i < segs; i++) {
      const a = i / segs * Math.PI * 2, r = radii[j];
      h[j * segs + i] = hAt(C[0] + Math.cos(a) * r, C[1] + Math.sin(a) * r, r);
    }
    for (let i = 0; i < segs; i++) for (let j = rows - 2; j >= 0; j--) {
      const k = j * segs + i, lim = h[k + segs] - 0.84 * (radii[j + 1] - radii[j]);
      if (h[k] < lim) h[k] = lim;
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i < segs; i++) {
      const a = i / segs * Math.PI * 2, r = radii[j];
      P.push(C[0] + Math.cos(a) * r, h[j * segs + i], C[1] + Math.sin(a) * r);
    }
    for (let j = 0; j < rows - 1; j++) for (let i = 0; i < segs; i++) {
      const a = base + j * segs + i, b = base + j * segs + (i + 1) % segs, c = a + segs, d = b + segs;
      I.push(a, b, c, b, d, c);
    }
  };
  // (crests a few degrees over the summit's horizon, as real ranges 5 to 10 km off stand: 200 to 550 m up for the nearer,
  // to about 1 100 m for the higher one behind)
  // (each higher in some directions than others, saddles and valleys opening between the massifs, not a saw of even
  // peaks all round)
  const near = (x, z, r) => {
    const env = smoothstep(3000, 4500, r) * (1 - 0.85 * smoothstep(5100, 6400, r));
    const m = ridged(x * 0.00032 + 3.1, z * 0.00032 - 1.7, 4), lump = fbm(x * 0.00018 - 2, z * 0.00018 + 5, 2);
    const mass = 0.55 + 0.6 * smoothstep(-0.5, 0.5, fbm(x * 0.0001 + 8, z * 0.0001 - 4, 2));
    return -760 + env * (560 + (700 * m * m + 160 * lump) * mass);
  };
  const far = (x, z, r) => {
    const env = smoothstep(6800, 8800, r) * (1 - 0.75 * smoothstep(10000, 11600, r));
    const m = ridged(x * 0.0002 - 5.3, z * 0.0002 + 2.9, 4);
    const mass = 0.4 + 0.85 * smoothstep(-0.45, 0.45, fbm(x * 0.00007 - 3, z * 0.00007 + 6, 2));
    return -900 + env * (1000 + 1300 * m * m * mass);
  };
  ring(low ? [3000, 3500, 3900, 4250, 4550, 4850, 5300, 5900, 6400] : [3000, 3350, 3700, 4000, 4250, 4450, 4650, 4900, 5200, 5600, 6000, 6400], low ? 320 : 480, near);
  ring(low ? [6800, 7600, 8300, 8900, 9700, 11600] : [6800, 7400, 7950, 8400, 8850, 9400, 10200, 11600], low ? 240 : 360, far);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals();
  // snow, rock and forest by the slope and height, broken up by noise
  const nn = g.attributes.normal.array;
  for (let k = 0; k < P.length / 3; k++) {
    const x = P[k * 3], y = P[k * 3 + 1], z = P[k * 3 + 2], ny = nn[k * 3 + 1], n = fbm(x * 0.004, z * 0.004, 2);
    const rock = smoothstep(0.8, 0.62, ny + n * 0.12), wood = (1 - smoothstep(-560, -420, y + n * 90)) * smoothstep(0.55, 0.8, ny);
    for (let c = 0; c < 3; c++) K.push(SNOW[c] + (ROCK[c] - SNOW[c]) * rock * 0.9 + (WOOD[c] - SNOW[c]) * wood * 0.85);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(K, 3));
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  /* (the faces' ribs and gullies, rock and snow, worked out per pixel: the ranges face the venue, so their fall lines
     run out from its middle, and the noise picture laid in rings round it, stretched along the radius, gives ribs of rock
     and gullies of snow down every face, and their shading; 120 ribs round, so the picture meets itself where the angle
     comes round; some faces rocky, some broad snowfields; low down, where the valleys' haze lies, smooth snow and
     forest) */
  m.onBeforeCompile = s => {
    s.uniforms.uHorizon = snowUniforms.uHorizon; s.uniforms.uNight = snowUniforms.uNight; s.uniforms.uNoise = snowUniforms.uNoise;
    s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>
varying vec3 vTW;`).replace('#include <project_vertex>', `#include <project_vertex>
vTW = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
uniform sampler2D uHorizon; uniform float uNight; uniform sampler2D uNoise; varying vec3 vTW;
vec2 gRel; vec4 gSt;`).replace('#include <color_fragment>', `#include <color_fragment>
{
  gRel = vTW.xz - vec2(${C[0]}.0, ${C[1]}.0);
  float r = length(gRel), th = atan(gRel.y, gRel.x), dd = length(vTW - cameraPosition);
  vec2 uv = vec2(th * 19.0986, r / 700.0);          // (120 ribs round: 120 / 2 pi)
  float lod = max(0.0, log2(dd * 0.0075 / max(r, 1.0) * 1300.0));
  vec4 a = textureLod(uNoise, uv, lod), b = ${low ? 'a.gbra' : 'textureLod(uNoise, uv * vec2(3.0, 2.3) + 0.37, lod)'};      // (low: one look fewer)
  float big = textureLod(uNoise, vec2(th * 3.1831, r / 3000.0) + 0.6, 0.0).b;     // (20 round: rocky faces, snowfields)
  float up = smoothstep(-560.0, -300.0, vTW.y);                                    // (none of it low in the haze)
  gSt = vec4((a.rg * 0.65 + b.rg * 0.35 - 0.5) * up + 0.5, a.b * 0.62 + b.b * 0.38, up);
  vec3 wn = normalize(cross(dFdx(vTW), dFdy(vTW)));
  float steep = 1.0 - abs(wn.y);
  // rock on the ribs (high in the picture), the steeper, the higher and the rockier the face the more; snow in the gullies
  float rock = smoothstep(0.55, 0.61, gSt.z + steep * 0.55 + smoothstep(-200.0, 900.0, vTW.y) * 0.14 + (big - 0.5) * 0.5 - 0.17) * up;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.075, 0.07, 0.066), rock * 0.92);
}`).replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  // the ribs' and gullies' relief, across the faces (round the venue) more than down them
  vec2 rad = gRel / max(length(gRel), 1.0), tng = vec2(-rad.y, rad.x);
  vec3 bump = vec3(tng.x, 0.0, tng.y) * (gSt.x - 0.5) * 1.3 + vec3(rad.x, 0.0, rad.y) * (gSt.y - 0.5) * 0.4;
  normal = normalize(normal + (viewMatrix * vec4(bump, 0.0)).xyz);
}`).replace('#include <opaque_fragment>', `outgoingLight -= reflectedLight.directDiffuse * uNight * 0.9;
// (the air between lights a far mountain's shade with the sky's blue: its shaded faces are blue-grey, never near black)
outgoingLight += diffuseColor.rgb * vec3(0.13, 0.16, 0.22) * (1.0 - uNight);
#include <opaque_fragment>`).replace('#include <fog_fragment>', `#ifdef USE_FOG
  // the air's haze: more the further (as the scene's fog is thick) and the lower (the valleys' haze), the horizon's colour
  float dd = length(vTW - cameraPosition), kk = fogDensity / 0.00028;
  float hz = 1.0 - exp(-dd * 0.000055 * kk);
  // (the valleys filled with haze, its top a fairly even level, as a valley's haze lies)
  float lay = -300.0 + 60.0 * (textureLod(uNoise, vTW.xz * 0.00008, 0.0).b - 0.5);
  hz = mix(hz, 1.0, (1.0 - smoothstep(lay - 70.0, lay + 50.0, vTW.y)) * 0.97);
  vec3 fdir = normalize(vTW - cameraPosition);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, texture2D(uHorizon, vec2(atan(fdir.z, fdir.x) * 0.1591549 + 0.5, 0.5)).rgb, clamp(hz, 0.0, 1.0));
#endif`);
  };
  m.customProgramCacheKey = () => 'farrange' + (low ? 'L' : '');
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'far ranges'; mesh.matrixAutoUpdate = false; mesh.frustumCulled = false; mesh.castShadow = mesh.receiveShadow = false;
  // (drawn after the rest of the opaque world, just before the sky: whatever the mountain covers is then skipped by the
  // depth test before any of its shading is done)
  mesh.renderOrder = 1e5;
  scene.add(mesh);
  return mesh;
}

// ---- lift, fences, flags, the start arch ----------------------------------------------------------------------------
export function makeProps(scene, park, q) {
  const group = new THREE.Group(); group.name = 'props';
  const M = {
    steel: new THREE.MeshStandardMaterial({ color: 0x8b9096, metalness: 0.7, roughness: 0.45 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.6 }),
    orange: new THREE.MeshStandardMaterial({ color: 0xff6a13, roughness: 0.75, side: THREE.DoubleSide }),
  };
  // everything of one material goes into one mesh
  const buckets = { steel: [], dark: [], orange: [] };
  const _m = new THREE.Matrix4(), _e = new THREE.Euler();
  const add = (geo, key, x, y, z, ry = 0, rx = 0) => {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone());
    g.deleteAttribute('uv');
    g.applyMatrix4(_m.makeRotationFromEuler(_e.set(rx, ry, 0)).setPosition(x, y, z));
    buckets[key].push(g);
  };
  // chairlift up the right side of the run
  const lx = 64, towers = [];
  for (let z = 1400; z >= -60 && !park.hasLift; z -= 85) {   // (L: not where lift.js has built the real chairlift)
    const y = height(lx, z);
    add(new THREE.CylinderGeometry(0.35, 0.45, 12, 8), 'steel', lx, y + 6, z);
    add(new THREE.BoxGeometry(5.2, 0.4, 0.5), 'steel', lx, y + 12, z);
    towers.push(new THREE.Vector3(lx, y + 11.6, z));
  }
  const cable = [];
  for (const sx of [-2.4, 2.4]) for (let i = 0; i < towers.length - 1; i++) {
    const a = towers[i].clone(), b = towers[i + 1].clone(); a.x += sx; b.x += sx;
    for (let k = 0; k < 8; k++) { const t0 = k / 8, t1 = (k + 1) / 8; const p0 = a.clone().lerp(b, t0), p1 = a.clone().lerp(b, t1); p0.y -= Math.sin(Math.PI * t0) * 1.2; p1.y -= Math.sin(Math.PI * t1) * 1.2; cable.push(p0, p1); }
  }
  group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(cable), new THREE.LineBasicMaterial({ color: 0x2a2d31 })));
  const chairG = new THREE.BoxGeometry(1.6, 0.12, 0.6), backG = new THREE.BoxGeometry(1.6, 0.7, 0.08), hangG = new THREE.CylinderGeometry(0.03, 0.03, 2.2, 4);
  for (const sx of [-2.4, 2.4]) for (let i = 0; i < towers.length - 1; i++) for (let k = 1; k < 4; k++) {
    const p = towers[i].clone().lerp(towers[i + 1], k / 4); p.x += sx; p.y -= Math.sin(Math.PI * k / 4) * 1.2;
    add(hangG, 'steel', p.x, p.y - 1.1, p.z); add(chairG, 'dark', p.x, p.y - 2.2, p.z); add(backG, 'dark', p.x, p.y - 1.85, p.z - 0.28);
  }
  // the start arch
  /* (2026-11-11: not on Freeride, whose runs start at the Summit Chair's top on the Peak now; the arch stood on the main
     face's brink, where runs began before the Peak was built, and its banner read as a leftover) */
  if (!park.freeride) {
  const az = park.archZ ?? -20, sy = height(0, az);   // (J, round 9: the Jump Line's start moved down the hill, park.archZ)
  add(new THREE.BoxGeometry(0.5, 6, 0.5), 'dark', -9, sy + 3, az); add(new THREE.BoxGeometry(0.5, 6, 0.5), 'dark', 9, sy + 3, az);
  const banner = document.createElement('canvas'); banner.width = 1024; banner.height = 128; const bx = banner.getContext('2d');
  bx.fillStyle = '#0d1b2a'; bx.fillRect(0, 0, 1024, 128); bx.fillStyle = '#ff6a13'; bx.fillRect(0, 108, 1024, 20);
  bx.font = 'italic 800 84px "Barlow Condensed", Arial Narrow, sans-serif'; bx.fillStyle = '#fff'; bx.textAlign = 'center'; bx.fillText(park.banner || 'LEON FREESKI  PARK', 512, 92);
  const bt = new THREE.CanvasTexture(banner); bt.colorSpace = THREE.SRGBColorSpace;
  const bn = new THREE.Mesh(new THREE.BoxGeometry(18.5, 2.2, 0.2), new THREE.MeshStandardMaterial({ map: bt, roughness: 0.8 })); bn.position.set(0, sy + 5.6, az); bn.castShadow = true; group.add(bn);
  }
  // orange fences beside the jump line and the pipe
  const postG = new THREE.CylinderGeometry(0.04, 0.04, 1.3, 5);
  const fence = (x0, z0, x1, z1) => {
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.round(L / 3));
    const pts = [];
    for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * i / n, z = z0 + (z1 - z0) * i / n, y = height(x, z); add(postG, 'dark', x, y + 0.6, z); pts.push(new THREE.Vector3(x, y + 1.05, z), new THREE.Vector3(x, y + 0.5, z)); }
    const tri = [];
    for (let i = 0; i < n; i++) { const a = pts[i * 2], b = pts[i * 2 + 2], c = pts[i * 2 + 1], d = pts[i * 2 + 3]; tri.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry().setFromPoints(tri); g.computeVertexNormals(); buckets.orange.push(g);
  };
  for (const f of park.fences || []) fence(...f);
  const pp = park.pipe;
  if (pp) { const px = pp.F + pp.R + pp.deck + 9; fence(pp.x - px, pp.z0, pp.x - px, pp.z1); fence(pp.x + px, pp.z0, pp.x + px, pp.z1); }
  // flags on the knuckles (not where a rail or tube runs past)
  const flagG = new THREE.PlaneGeometry(0.7, 0.45), poleG = new THREE.CylinderGeometry(0.025, 0.025, 2.2, 5), cl = {};
  for (const k of park.kickers) for (const s of [-1, 1]) {
    // (on the knuckle's shoulders, just outside its flat top: the Jump Line's takeoffs and tables are wider now, K)
    const x = (k.cxT ?? k.x) + s * ((k.hwAt ? k.hwAt(k.K.z) : k.wD) + 1.2), z = k.K.z, y = height(x, z);
    if ((park.rails || []).some(r => { r.closest(new THREE.Vector3(x, y + 0.5, z), cl); return cl.dh < 1.8; })) continue;
    add(poleG, 'dark', x, y + 1.1, z); add(flagG, 'orange', x + 0.36, y + 1.95, z);
  }
  /* (2026-11-06, the lag pass: the fences, posts and flags cast their shadows from copies in 100 m pieces along the
     park, drawn only into the shadow map (layer 5, env.js): merged, all 8 400 triangles of them went into the shadow
     map every frame, which only covers the snow round the rider) */
  const pieces = new Map(), _c = new THREE.Vector3();
  for (const key in buckets) {
    if (!buckets[key].length) continue;
    for (const g0 of buckets[key]) {
      g0.computeBoundingBox(); const k = Math.floor(g0.boundingBox.getCenter(_c).z / 100);
      const h = new THREE.BufferGeometry(); h.setAttribute('position', g0.attributes.position);
      if (!pieces.has(k)) pieces.set(k, []); pieces.get(k).push(h);
    }
    const g = mergeGeometries(buckets[key], false); if (!g) continue;
    const m = new THREE.Mesh(g, M[key]); m.castShadow = false; m.receiveShadow = true; m.matrixAutoUpdate = false; group.add(m);
  }
  const shadowMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, colorWrite: false });
  for (const list of pieces.values()) {
    const g = mergeGeometries(list, false); if (!g) continue;
    g.computeBoundingSphere();
    const sm = new THREE.Mesh(g, shadowMat); sm.layers.set(5); sm.castShadow = true; sm.matrixAutoUpdate = false; sm.name = 'props shadow';
    group.add(sm);
  }
  scene.add(group);
  return group;
}
