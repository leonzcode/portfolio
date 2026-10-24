/* ---------------------------------------------------------------------------
   Leoncraft 2 - drawing the mobs.

   Every kind of model is one draw, however many of it there are: the model's
   boxes are one geometry (each vertex knows its part), each mob is an
   instance, and every part of every mob gets its own matrix in one float
   texture, filled on the CPU each frame. A zombie and a husk share the
   humanoid geometry and differ only in where their texture sits in the atlas
   (an offset per instance); a sheep's wool takes its dye colour per instance.

   Lit as the player's model is (avatar.js): the sun through the shadow map,
   the sky, block light and the light in your hand, with each mob's own sky
   and block light levels from where it stands. Hurt mobs flash red, a
   swelling creeper flashes white.

   Also here: the round shadow under each mob (the game's "entity shadows"),
   and the particles (smoke puffs, crits, hearts, flames, explosions), each
   one instanced draw.
--------------------------------------------------------------------------- */
import { COMMON, SHADOW, TONEMAP, LDR, LIGHTS } from './glsl.js?v=107';
import { VANILLA } from './vanilla.js?v=107';
import { lightDefines } from './materials.js?v=107';
import { GLINT } from './armor.js?v=107';
const THREE = window.THREE;

export const ATLAS = 2048;           // the mob texture atlas, in pixels a side (2048: room for every mob of the game)
const BONE_W = 256;                  // matrices per row of the bone texture

const HEAD = `precision highp float; precision highp int; precision highp sampler2DShadow;\n`;
const VS = /* glsl */`
uniform mat4 viewMatrix, projectionMatrix;
uniform vec3 cameraPosition;
uniform highp sampler2D uBones;
in vec3 position; in vec3 normal; in vec2 uv; in vec2 aPart;
in vec4 aI0;   // first bone, atlas offset u, v, enchantment glint (armour: render/armor.js)
in vec4 aI1;   // sky, block light (0..1), hurt red, white flash
in vec4 aI2;   // tint colour (rgb), Glowing (1 none, 2 glowing, 3 glowing and invisible: only the outline)
out vec3 vWorld; out vec3 vN; out vec2 vUv; out vec4 vL; out vec3 vTint; out vec3 vG;
#ifdef FOG_V
// Detailed: the fog worked out per vertex (glsl.js fogTerms), as the blocks do
uniform sampler2D uView, uAmbient;
uniform float uEyeInWater;
out vec3 vKeep; out vec3 vAdd;
#endif
LDR_HERE
mat4 bone(int i) {
  ivec2 p = ivec2((i % ${BONE_W}) * 4, i / ${BONE_W});
  return mat4(texelFetch(uBones, p, 0), texelFetch(uBones, p + ivec2(1, 0), 0), texelFetch(uBones, p + ivec2(2, 0), 0), texelFetch(uBones, p + ivec2(3, 0), 0));
}
void main() {
  if (aI2.w > 2.5) { vWorld = vec3(0.0); vN = vec3(0.0, 1.0, 0.0); vUv = vec2(0.0); vL = vec4(0.0); vTint = vec3(1.0); vG = vec3(0.0); gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  mat4 M = bone(int(aI0.x + 0.5) + int(aPart.x + 0.5));
  vec4 w = M * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(M) * normal);
  vUv = (uv + aI0.yz) / ${ATLAS}.0;
  vG = vec3(uv, aI0.w);   // the glint, in the texture's pixels
  vL = aI1;
  // a tinted part (wool, a collar) takes the instance colour
  vTint = aPart.y > 0.5 ? aI2.rgb : vec3(1.0);
  // (from the eye, never viewMatrix on the place in the world: vanilla.js TERRAIN_VS)
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * (w.xyz - cameraPosition), 1.0);
#ifdef FOG_V
  fogTerms(w.xyz, vKeep, vAdd);
#endif
}`;
/* Glowing on a mob (a spectral arrow): as the player's (render/avatar.js), the mob's shape marked in the stencil through
   everything, then its faces pushed out a little drawn in white only outside the mark. Only instances flagged glowing. */
const GLOW_VS = /* glsl */`
uniform mat4 viewMatrix, projectionMatrix;
uniform vec3 cameraPosition;
uniform highp sampler2D uBones;
uniform float uPush;
in vec3 position; in vec3 normal; in vec2 aPart;
in vec4 aI0; in vec4 aI2;
mat4 bone(int i) {
  ivec2 p = ivec2((i % ${BONE_W}) * 4, i / ${BONE_W});
  return mat4(texelFetch(uBones, p, 0), texelFetch(uBones, p + ivec2(1, 0), 0), texelFetch(uBones, p + ivec2(2, 0), 0), texelFetch(uBones, p + ivec2(3, 0), 0));
}
void main() {
  if (aI2.w < 1.5) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  mat4 M = bone(int(aI0.x + 0.5) + int(aPart.x + 0.5));
  vec4 w = M * vec4(position, 1.0);
  w.xyz += normalize(mat3(M) * normal) * uPush;
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * (w.xyz - cameraPosition), 1.0);
}`;
const GLOW_FS = /* glsl */`
uniform vec4 uGlow;
out vec4 o;
void main() { o = uGlow; }`;
const FS = /* glsl */`
uniform sampler2D uAtlas, uAmbient;
uniform vec3 cameraPosition, uLightDir;
uniform float uFrame;
uniform float uTime;
uniform sampler2D uNoise;
uniform float uDim;      // 0 the Overworld, 1 the Nether, 2 the End (js/dims.js)
uniform vec3 uDimAmb;    // the light everything gets there instead of the sky's (js/dim/look.js)
#define HAS_DIM
#ifdef LDR
uniform sampler2D uView;
uniform float uEyeInWater;
` + LDR + `
#endif
` + LIGHTS + `
uniform float uClock;
#ifndef LDR
uniform sampler2D uExpoTex;     // the eye's exposure, the last frame's (render/post.js)
#define GLINT_TONE
#endif
` + GLINT + `
in vec3 vWorld; in vec3 vN; in vec2 vUv; in vec4 vL; in vec3 vTint; in vec3 vG;
#ifdef LDR
in vec3 vKeep; in vec3 vAdd;
#endif
layout(location = 0) out vec4 outColor;
vec3 ambientAt(vec3 n) {
  vec3 up = texelFetch(uAmbient, ivec2(0, 0), 0).rgb;
  vec3 side = texelFetch(uAmbient, ivec2(1, 0), 0).rgb;
  vec3 down = texelFetch(uAmbient, ivec2(2, 0), 0).rgb;
  return n.y > 0.0 ? mix(side, up, n.y) : mix(side, down, -n.y);
}
void main() {
  vec4 t = texture(uAtlas, vUv);
  if (t.a < 0.5) discard;
  vec3 albedo = toLinear(t.rgb * vTint);
  // hurt: the game's red overlay; a creeper about to go: white
  albedo = mix(albedo, vec3(0.75, 0.0, 0.0), vL.z * 0.55);
  albedo = mix(albedo, vec3(1.0), vL.w);
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  float sky = vL.x, block = vL.y;
  vec3 L = uLightDir;
  float NoL = dot(N, L);
  // (no sun or moon in the other dimensions, and no shadow map drawn there)
  float gate = uDim > 0.5 ? 0.0 : smoothstep(0.03, 0.2, sky);
  float shadow = 0.0;
#if SHADOWS > 0
  if (gate > 0.0 && NoL > 0.0) {
    vec3 sc = shadowCoord(vWorld, N, NoL, length(cameraPosition - vWorld));
    shadow = shadowHard(sc);
    shadow = mix(shadow, smoothstep(0.85, 0.95, sky), shadowFade(sc));
  }
#else
  shadow = smoothstep(0.8, 0.95, sky) * step(0.0, NoL);
#endif
  shadow *= gate;
  if (shadow > 0.0) shadow *= cloudShade(vWorld, L);
  vec3 sunC = texelFetch(uAmbient, ivec2(3, 0), 0).rgb;
  vec3 diffuse = sunC * shadow * sat(NoL);
  vec3 amb = ambientAt(N);
  amb = mix(amb, vec3(lum(amb)), 0.22);
  amb += sunC * 0.03;
  // (the sky's light as the block it stands in gets it, no less: materials.js)
  amb *= sky * sky;
  // the Nether's even light and the End's dim sky light, as the blocks round them have it (materials.js)
  if (uDim > 0.5) amb = uDimAmb * (uDim < 1.5 ? 1.0 : 0.3 + 0.7 * sky * sky);
  block = max(block, heldLight(vWorld, N));
  vec3 blockL = block > 0.0 ? blockLight(block, uDim > 0.5 ? 0.0 : sky * sky * sat(lum(sunC) * 0.3)) : vec3(0.0);
  vec3 light = (diffuse * PI + amb + blockL + lightFloor() + fullbrightFill(diffuse * PI + amb + blockL)) / PI;
  vec3 col = albedo * light;
  // enchanted armour: the glint added unlit on the screen's own colour, as bright in any light (as on the player, render/avatar.js)
  vec3 g = vG.z > 0.5 ? glintAt(vG.xy, uClock) : vec3(0.0);
#ifdef LDR
  // (fading into the fog with what it is on)
  col = min(toneLDR(col * vKeep + vAdd) + g * dot(vKeep, vec3(1.0 / 3.0)), vec3(1.0));
#else
  if (vG.z > 0.5) col = glintOver(col, g, max(texture(uExpoTex, vec2(0.5)).r, 0.02));
#endif
  outColor = vec4(col, 1.0);
}`;

/* Fast graphics (the game with no shaders): a mob is its skin, the game's two
   fixed lights on its faces, the lightmap where it stands and the fog; hurt
   is the game's red overlay (30% red), a creeper about to go flashes white. */
const FS_VANILLA = VANILLA + /* glsl */`
uniform sampler2D uAtlas, uNoise;
uniform vec3 cameraPosition;
uniform float uClock;
in vec3 vWorld; in vec3 vN; in vec2 vUv; in vec4 vL; in vec3 vTint; in vec3 vG;
layout(location = 0) out vec4 outColor;
` + GLINT + `
void main() {
  vec4 t = texture(uAtlas, vUv);
  if (t.a < 0.5) discard;
  vec3 c = t.rgb * vTint;
  c = mix(c, vec3(1.0, 0.0, 0.0), vL.z * 0.3);
  c = mix(c, vec3(1.0), vL.w);
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  c *= entityShade(N) * lightmapAt(vL.x, vL.y);
  // enchanted armour: the glint on top, unlit, as the game draws it
  if (vG.z > 0.5) c += glintAt(vG.xy, uClock);
  outColor = vec4(linearFog(c, fogDistance(vWorld - cameraPosition)), 1.0);
}`;
const PART_FS_VANILLA = VANILLA + /* glsl */`
uniform sampler2D uSheet;
in vec2 vUv; in vec4 vC; in float vLight; in float vBlock;
layout(location = 0) out vec4 outColor;
void main() {
  vec4 t = texture(uSheet, vUv);
  if (t.a * vC.a < 0.1) discard;
  vec3 c = t.rgb * vC.rgb * (vLight > 0.99 ? vec3(1.0) : lightmapAt(vLight, vBlock));
  outColor = vec4(c, t.a * vC.a);
}`;

/* ---- the round shadow under a mob ---- */
const BLOB_VS = /* glsl */`
uniform mat4 viewMatrix, projectionMatrix;
uniform vec3 cameraPosition;
in vec3 position; in vec4 aB;   // centre x, y, z, radius
in float aA;                    // darkness
out vec2 vP; out float vA;
void main() {
  vP = position.xz;
  vA = aA;
  vec3 w = aB.xyz + vec3(position.x * aB.w, 0.0, position.z * aB.w);
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * (w - cameraPosition), 1.0);
}`;
const BLOB_FS = /* glsl */`
in vec2 vP; in float vA;
layout(location = 0) out vec4 outColor;
void main() {
  float d = length(vP);
  if (d > 1.0) discard;
  // a soft-edged disc in fat pixels, like the game's shadow picture
  vec2 q = floor(vP * 4.0) / 4.0;
  float a = vA * (1.0 - smoothstep(0.55, 1.0, length(q + 0.125)));
  outColor = vec4(0.0, 0.0, 0.0, a);
}`;

/* ---- the patch over a boat's inside: depth only, so the water under it is not drawn there ---- */
const MASK_VS = /* glsl */`
uniform mat4 viewMatrix, projectionMatrix;
uniform vec3 cameraPosition;
in vec3 position; in vec4 aM;   // x, y, z, yaw
in vec2 aS;                     // half size across, along
void main() {
  float c = cos(aM.w), s = sin(aM.w);
  vec2 q = position.xz * aS;
  vec3 w = aM.xyz + vec3(q.x * c + q.y * s, 0.0, -q.x * s + q.y * c);
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * (w - cameraPosition), 1.0);
}`;
const MASK_FS = /* glsl */`
layout(location = 0) out vec4 outColor;
void main() { outColor = vec4(0.0); }`;

/* ---- particles: camera-facing squares out of a small sheet ---- */
const PART_VS = /* glsl */`
uniform mat4 viewMatrix, projectionMatrix;
uniform vec3 cameraPosition;
in vec3 position; in vec4 aP;   // x, y, z, size
in vec4 aC;                     // colour rgb, alpha
in vec4 aT;                     // frame, sky light (0..1; 1 glows), spin, block light (0..1)
out vec2 vUv; out vec4 vC; out float vLight; out float vBlock;
void main() {
  vec4 v = vec4(mat3(viewMatrix) * (aP.xyz - cameraPosition), 1.0);
  float c = cos(aT.z), s = sin(aT.z);
  vec2 q = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
  v.xy += q * aP.w;
  float f = aT.x;
  vUv = (vec2(mod(f, 8.0), floor(f / 8.0)) + (position.xy * vec2(1.0, -1.0) + 0.5)) / 8.0;
  vC = aC; vLight = aT.y; vBlock = aT.w;
  gl_Position = projectionMatrix * v;
}`;
const PART_FS = /* glsl */`
uniform sampler2D uSheet, uAmbient;
uniform float uDim;      // 0 the Overworld, 1 the Nether, 2 the End (js/dims.js)
uniform vec3 uDimAmb;    // the light everything gets there instead of the sky's (js/dim/look.js)
in vec2 vUv; in vec4 vC; in float vLight; in float vBlock;
layout(location = 0) out vec4 outColor;
void main() {
  vec4 t = texture(uSheet, vUv);
  if (t.a * vC.a < 0.1) discard;
  vec3 c = pow(t.rgb * vC.rgb, vec3(2.2));
  // lit by the sky's light where it is (glowing ones carry a light of 1), and the warm light of torches and fires there;
  // in the Nether and the End by their own even light, as the blocks are (the sky table is left at midnight there)
  vec3 amb = texelFetch(uAmbient, ivec2(0, 0), 0).rgb + texelFetch(uAmbient, ivec2(3, 0), 0).rgb * 0.6;
  vec3 lit = vLight > 0.99 ? vec3(1.0)
    : uDim > 0.5 ? uDimAmb / 3.14159 * 1.4 * (uDim < 1.5 ? 1.0 : 0.3 + 0.7 * vLight * vLight)
    : amb / 3.14159 * 1.4 * max(vLight, 0.06);
  vec3 warm = vLight > 0.99 ? vec3(0.0) : vec3(1.0, 0.8, 0.58) * pow(vBlock, 2.4) * 1.1;
  c *= max(lit + warm, vec3(0.004));
#ifdef LDR
  c = pow(c, vec3(1.0 / 2.2));
#endif
  outColor = vec4(c, t.a * vC.a);
}`;

/* ---------------------------------------------------------------------------
   A model's geometry: boxes on parts, from the definitions in
   entities/mobmodels.js. Coordinates are the game's (pixels, y down, -z the
   front); they are turned here to y up, +z the front, as avatar.js does.
--------------------------------------------------------------------------- */
function faceList(u, v, w, h, d) {
  return [
    [[0, 0, 1], [[-1, 1, 1], [1, 1, 1], [1, -1, 1], [-1, -1, 1]], [u + d, v + d, u + d + w, v + d + h]],                  // front
    [[0, 0, -1], [[1, 1, -1], [-1, 1, -1], [-1, -1, -1], [1, -1, -1]], [u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h]], // back
    [[-1, 0, 0], [[-1, 1, -1], [-1, 1, 1], [-1, -1, 1], [-1, -1, -1]], [u, v + d, u + d, v + d + h]],                    // its right
    [[1, 0, 0], [[1, 1, 1], [1, 1, -1], [1, -1, -1], [1, -1, 1]], [u + d + w, v + d, u + 2 * d + w, v + d + h]],          // its left
    [[0, 1, 0], [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]], [u + d, v, u + d + w, v + d]],                          // top
    [[0, -1, 0], [[-1, -1, 1], [1, -1, 1], [1, -1, -1], [-1, -1, -1]], [u + d + w, v, u + d + 2 * w, v + d]],              // bottom
  ];
}
/* three.js works out once, the first time an instanced geometry is drawn,
   how many instances its attributes can hold, and never draws more than that:
   after the attributes are replaced with bigger ones it has to be told to
   look again, or everything past the first size goes undrawn (the particles
   of a rain shower, the twentieth sheep). */
function uncap(geo) { delete geo._maxInstanceCount; }

export function modelGeometry(model) {
  const P = [], N = [], T = [], A = [], I = [];
  model.parts.forEach((part, pi) => {
    for (const bx of part.boxes) {
      // [x, y, z, w, h, d, u, v, inflate, mirror, tinted, front only, texture pixels to a model pixel]
      const [x0, y0, z0, w, h, d, u, v] = bx;
      const inf = bx[8] || 0, mirror = !!bx[9], tint = bx[10] ? 1 : 0, frontOnly = !!bx[11], ts = bx[12] || 1;
      // the box's centre in the turned space (y and z flip)
      const cx = x0 + w / 2, cy = -(y0 + h / 2), cz = -(z0 + d / 2);
      const hx = w / 2 + inf, hy = h / 2 + inf, hz = d / 2 + inf;
      // (a painting's picture is drawn at four texture pixels to each of the model's: items2.js)
      const faces = faceList(u, v, w * ts, h * ts, d * ts);
      if (mirror) { const t = faces[2][2]; faces[2][2] = faces[3][2]; faces[3][2] = t; }
      for (const [n, corners, r] of faces) {
        /* a flat box drawn two-sided has its front and back in one place with different pictures, and which of
           them shows changed as the camera turned (a painting's picture flickered): front only, where asked */
        if (frontOnly && n[2] !== 1) continue;
        const v0 = P.length / 3;
        let UV = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
        if (mirror) UV = [UV[1], UV[0], UV[3], UV[2]];
        for (let k = 0; k < 4; k++) {
          const s = corners[k];
          P.push(cx + s[0] * hx, cy + s[1] * hy, cz + s[2] * hz);
          N.push(n[0], n[1], n[2]);
          T.push(UV[k][0], UV[k][1]);
          A.push(pi, tint);
        }
        I.push(v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2);
      }
    }
  });
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(T, 2));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(A, 2));
  g.setIndex(I);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

/* ---------------------------------------------------------------------------
   The renderer side. Per frame: begin(), then add() each mob, then end().
--------------------------------------------------------------------------- */
export class EntityMeshes {
  constructor(R, atlasCanvas, sheetCanvas) {
    this.R = R;
    const U = R.U, opts = R.opts;
    this.group = new THREE.Group();
    this.group.name = 'entities';
    // the atlas and the particle sheet
    const tex = this.atlas = new THREE.CanvasTexture(atlasCanvas);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false; tex.flipY = false;
    tex.colorSpace = THREE.NoColorSpace;
    const sheet = this.sheet = new THREE.CanvasTexture(sheetCanvas);
    sheet.magFilter = THREE.NearestFilter; sheet.minFilter = THREE.NearestFilter;
    sheet.generateMipmaps = false; sheet.flipY = false;
    sheet.colorSpace = THREE.NoColorSpace;
    // the bone matrices
    this.boneRows = 4;
    this.bones = new Float32Array(BONE_W * 4 * this.boneRows * 4);
    this.boneTex = this.makeBoneTex();
    this.nBones = 0;
    this.uBones = { value: this.boneTex };
    const uni = Object.assign({}, U, { uAtlas: { value: tex }, uBones: this.uBones });
    // made again for each look, Shaders ON or OFF (render/looks.js)
    this.mat = R.looked(o => {
      const defines = Object.assign({ SHADOWS: o.shadows === undefined ? 2 : o.shadows }, o.ldr ? { LDR: 1 } : {}, o.ldr && !o.vanilla ? { FOG_V: 1, TONE_LUT: 1 } : {}, lightDefines(o));
      return new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3, vertexShader: HEAD + COMMON + (o.ldr && !o.vanilla ? TONEMAP + VS.replace('LDR_HERE', LDR) : VS.replace('LDR_HERE', '')),
        fragmentShader: o.vanilla ? HEAD + FS_VANILLA : HEAD + COMMON + SHADOW + TONEMAP + FS,
        uniforms: R.withU(uni), defines, side: THREE.DoubleSide,
      });
    });
    this.models = new Map();        // name -> { mesh, geo, inst arrays, n, cap }
    // round shadows
    const bg = new THREE.InstancedBufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], 3));
    bg.setIndex([0, 2, 1, 0, 3, 2]);
    this.blobCap = 0; this.blobN = 0;
    this.blobGeo = bg;
    this.growBlobs(64);
    this.blob = new THREE.Mesh(bg, new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: HEAD + BLOB_VS, fragmentShader: HEAD + BLOB_FS,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    this.blob.frustumCulled = false; this.blob.renderOrder = 5;
    this.group.add(this.blob);
    // particles
    const pg = new THREE.InstancedBufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    pg.setIndex([0, 1, 2, 0, 2, 3]);
    this.partGeo = pg; this.partCap = 0; this.partN = 0;
    this.growParts(256);
    const uSheet = { value: sheet };
    this.parts = new THREE.Mesh(pg, R.looked(o => new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: HEAD + PART_VS, fragmentShader: HEAD + (o.vanilla ? PART_FS_VANILLA : PART_FS), defines: o.ldr ? { LDR: 1 } : {},
      uniforms: { uSheet, uAmbient: U.uAmbient, uDim: U.uDim, uDimAmb: U.uDimAmb, uLightmap: U.uLightmap || { value: null }, uFogColor: U.uFogColor || { value: null }, uFog: U.uFog || { value: null }, uConstAmb: U.uConstAmb || { value: 0 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    })));
    this.parts.frustumCulled = false; this.parts.renderOrder = 6;
    this.group.add(this.parts);
    // boats' water patches: after everything opaque, depth only
    const mg = new THREE.InstancedBufferGeometry();
    mg.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], 3));
    mg.setIndex([0, 2, 1, 0, 3, 2]);
    this.maskGeo = mg; this.maskN = 0; this.maskCap = 16;
    this.mM = new THREE.InstancedBufferAttribute(new Float32Array(64), 4).setUsage(THREE.DynamicDrawUsage);
    this.mS = new THREE.InstancedBufferAttribute(new Float32Array(32), 2).setUsage(THREE.DynamicDrawUsage);
    mg.setAttribute('aM', this.mM); mg.setAttribute('aS', this.mS);
    this.mask = new THREE.Mesh(mg, new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: HEAD + MASK_VS, fragmentShader: HEAD + MASK_FS, colorWrite: false, depthWrite: true, side: THREE.DoubleSide }));
    this.mask.frustumCulled = false; this.mask.renderOrder = 4;
    this.group.add(this.mask);
    this.tmp = new THREE.Matrix4(); this.tmp2 = new THREE.Matrix4(); this.e = new THREE.Euler();
    // Glowing: the flag the next add() writes (1 none, 2 glowing, 3 glowing and invisible), and the two materials
    this.glowNow = 1;
    this.uGlow = { value: new THREE.Vector4(1, 1, 1, 1) };
    let cleared = -1;
    const gmat = (push, extra) => new THREE.RawShaderMaterial(Object.assign({ glslVersion: THREE.GLSL3, vertexShader: HEAD + GLOW_VS, fragmentShader: HEAD + GLOW_FS,
      uniforms: { uBones: this.uBones, uPush: { value: push }, uGlow: this.uGlow }, side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: true, stencilWrite: true }, extra));
    this.glowMaskMat = gmat(0, { colorWrite: false, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp });
    this.glowRimMat = gmat(0.07, { stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc, stencilWriteMask: 0, stencilZPass: THREE.KeepStencilOp });
    // (the stencil cleared once a frame, before the first mob's mark; the players' outlines clear their own after)
    this.glowClear = r => {
      const f = r.info.render.frame;
      if (f === cleared) return;
      cleared = f; r.state.buffers.stencil.setMask(0xff); r.clearStencil();
      const t = r.getRenderTarget(), lit = t && !t.stencilBuffer;
      this.uGlow.value.set(lit ? 3 : 1, lit ? 3 : 1, lit ? 3 : 1, lit ? 0.7 : 1);
    };
  }
  makeBoneTex() {
    const t = new THREE.DataTexture(this.bones, BONE_W * 4, this.boneRows, THREE.RGBAFormat, THREE.FloatType);
    t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
    return t;
  }
  // a model, made once, by name
  model(name, def) {
    let m = this.models.get(name);
    if (m) return m;
    const geo = modelGeometry(def);
    m = { name, geo, n: 0, cap: 0, mesh: new THREE.Mesh(geo, this.mat) };
    m.mesh.frustumCulled = false;
    m.mesh.matrixAutoUpdate = false;
    this.grow(m, 16);
    this.group.add(m.mesh);
    this.models.set(name, m);
    return m;
  }
  grow(m, cap) {
    m.cap = cap;
    for (const k of ['aI0', 'aI1', 'aI2']) {
      const old = m[k];
      const a = new Float32Array(cap * 4);
      if (old) a.set(old.array.subarray(0, Math.min(old.array.length, a.length)));
      const attr = new THREE.InstancedBufferAttribute(a, 4);
      attr.setUsage(THREE.DynamicDrawUsage);
      m[k] = attr;
      m.geo.setAttribute(k, attr);
    }
    uncap(m.geo);
  }
  growBlobs(cap) {
    this.blobCap = cap;
    this.blobB = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.blobA = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
    this.blobGeo.setAttribute('aB', this.blobB);
    this.blobGeo.setAttribute('aA', this.blobA);
    uncap(this.blobGeo);
  }
  growParts(cap) {
    this.partCap = cap;
    this.pP = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.pC = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.pT = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.partGeo.setAttribute('aP', this.pP);
    this.partGeo.setAttribute('aC', this.pC);
    this.partGeo.setAttribute('aT', this.pT);
    uncap(this.partGeo);
  }

  begin() {
    for (const m of this.models.values()) { m.n = 0; m.glows = false; }
    this.glowNow = 1;
    this.nBones = 0; this.blobN = 0; this.partN = 0; this.maskN = 0;
  }
  // room for n more matrices; returns the first one's index
  allocBones(n) {
    const need = this.nBones + n;
    if (need > BONE_W * this.boneRows) {
      let rows = this.boneRows;
      while (BONE_W * rows < need) rows *= 2;
      const b = new Float32Array(BONE_W * 4 * rows * 4);
      b.set(this.bones);
      this.bones = b; this.boneRows = rows;
      this.boneTex.dispose();
      this.boneTex = this.makeBoneTex();
      this.uBones.value = this.boneTex;
    }
    const i = this.nBones;
    this.nBones = need;
    return i;
  }
  setBone(i, m4) { this.bones.set(m4.elements, i * 16); }
  /* One mob: its model, its first bone, where its texture is in the atlas,
     its light and flashes, its tint, and (armour) whether it shimmers. */
  add(m, bone, u, v, sky, block, hurt, white, r, g, b, glint) {
    if (m.n >= m.cap) this.grow(m, m.cap * 2);
    const o = m.n * 4;
    const a0 = m.aI0.array, a1 = m.aI1.array, a2 = m.aI2.array;
    a0[o] = bone; a0[o + 1] = u; a0[o + 2] = v; a0[o + 3] = glint || 0;
    a1[o] = sky; a1[o + 1] = block; a1[o + 2] = hurt; a1[o + 3] = white;
    a2[o] = r; a2[o + 1] = g; a2[o + 2] = b; a2[o + 3] = this.glowNow;
    if (this.glowNow > 1) {
      if (!m.glowMask) {
        m.glowMask = new THREE.Mesh(m.geo, this.glowMaskMat); m.glowRim = new THREE.Mesh(m.geo, this.glowRimMat);
        for (const q of [m.glowMask, m.glowRim]) { q.frustumCulled = false; q.matrixAutoUpdate = false; this.group.add(q); }
        // every mob's mark before any mob's outline, all before the players' (render/avatar.js, 100000 up)
        m.glowMask.renderOrder = 99990; m.glowRim.renderOrder = 99991;
        m.glowMask.onBeforeRender = this.glowClear;
      }
      m.glows = true;
    }
    m.n++;
  }
  blobAt(x, y, z, r, a) {
    if (this.blobN >= this.blobCap) { const ob = this.blobB.array, oa = this.blobA.array; this.growBlobs(this.blobCap * 2); this.blobB.array.set(ob); this.blobA.array.set(oa); }
    const o = this.blobN * 4, B = this.blobB.array;
    B[o] = x; B[o + 1] = y; B[o + 2] = z; B[o + 3] = r;
    this.blobA.array[this.blobN] = a;
    this.blobN++;
  }
  maskAt(x, y, z, yaw, hx, hz) {
    if (this.maskN >= this.maskCap) {
      const om = this.mM.array, os = this.mS.array;
      this.maskCap *= 2;
      this.mM = new THREE.InstancedBufferAttribute(new Float32Array(this.maskCap * 4), 4).setUsage(THREE.DynamicDrawUsage);
      this.mS = new THREE.InstancedBufferAttribute(new Float32Array(this.maskCap * 2), 2).setUsage(THREE.DynamicDrawUsage);
      this.mM.array.set(om); this.mS.array.set(os);
      this.maskGeo.setAttribute('aM', this.mM); this.maskGeo.setAttribute('aS', this.mS);
    }
    const o = this.maskN * 4, M = this.mM.array, S = this.mS.array;
    M[o] = x; M[o + 1] = y; M[o + 2] = z; M[o + 3] = yaw;
    S[this.maskN * 2] = hx; S[this.maskN * 2 + 1] = hz;
    this.maskN++;
  }
  particle(x, y, z, size, r, g, b, a, frame, light, spin, block) {
    if (this.partN >= this.partCap) {
      const op = this.pP.array, oc = this.pC.array, ot = this.pT.array;
      this.growParts(this.partCap * 2);
      this.pP.array.set(op); this.pC.array.set(oc); this.pT.array.set(ot);
    }
    const o = this.partN * 4, P = this.pP.array, C = this.pC.array, T = this.pT.array;
    P[o] = x; P[o + 1] = y; P[o + 2] = z; P[o + 3] = size;
    C[o] = r; C[o + 1] = g; C[o + 2] = b; C[o + 3] = a;
    T[o] = frame; T[o + 1] = light; T[o + 2] = spin || 0; T[o + 3] = block || 0;
    this.partN++;
  }
  end() {
    for (const m of this.models.values()) {
      m.geo.instanceCount = m.n;
      m.mesh.visible = m.n > 0;
      if (m.glowMask) m.glowMask.visible = m.glowRim.visible = m.n > 0 && !!m.glows;
      if (m.n) for (const k of ['aI0', 'aI1', 'aI2']) { const at = m[k]; at.needsUpdate = true; at.clearUpdateRanges && at.clearUpdateRanges(); at.addUpdateRange && at.addUpdateRange(0, m.n * 4); }
    }
    if (this.nBones) {
      // only the rows in use go up
      const rows = Math.ceil(this.nBones / BONE_W);
      const img = this.boneTex.image;
      if (img.height !== rows) { /* the texture keeps its size; the shader reads only the rows it needs */ }
      this.boneTex.needsUpdate = true;
    }
    this.blobGeo.instanceCount = this.blobN;
    this.blob.visible = this.blobN > 0;
    if (this.blobN) { this.blobB.needsUpdate = true; this.blobA.needsUpdate = true; }
    this.maskGeo.instanceCount = this.maskN;
    this.mask.visible = this.maskN > 0;
    if (this.maskN) { this.mM.needsUpdate = true; this.mS.needsUpdate = true; }
    this.partGeo.instanceCount = this.partN;
    this.parts.visible = this.partN > 0;
    if (this.partN) { this.pP.needsUpdate = true; this.pC.needsUpdate = true; this.pT.needsUpdate = true; }
  }
}
