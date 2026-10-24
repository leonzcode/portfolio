/* ---------------------------------------------------------------------------
   Leoncraft 2 - the enchantment glint on things held in a hand.

   As the game draws it: the item a second time over itself, the shimmer
   added on top, unlit, so an enchanted sword shines the same in a cave as in
   the sun. Only where the item's own picture is solid (the see-through part
   of a flat item's square never shimmers), and never through your arm.

   The shimmer is render/armor.js's (our own, made from the noise texture),
   in the item's texture pixels. In Detailed the picture is still to be
   exposed for the eye's adjusting, so the shimmer is divided by that
   exposure first and comes out as bright as in Fast.

   One material per renderer; addGlint(mesh) gives a held mesh (the vertex
   format of render/blockmesh.js) a glint child sharing its geometry.
--------------------------------------------------------------------------- */
import { GLINT } from './armor.js?v=107';
const THREE = window.THREE;

const HEAD = `precision highp float; precision highp int; precision highp sampler2DArray;\n`;
const VS = /* glsl */`
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
uniform vec3 cameraPosition;
uniform vec3 uChunk;
layout(location = 0) in uvec4 aPos; layout(location = 1) in uvec4 aA;
#define aPos vec4(aPos)
#define aA vec4(aA)
out vec2 vUv; flat out float vLayer; flat out int vFlags;
void main() {
  vUv = aA.xy / 16.0;
  vLayer = aPos.w;
  vFlags = int(aA.w + 0.5);
  // (worked out in the same order as the terrain shader does it, materials.js: in another order the rounding
  // put a framed item's shimmer behind the item itself, by more than the depth nudge, so it hardly showed)
  vec4 world = modelMatrix * vec4(aPos.xyz / 32.0 - vec3(8.0, 0.0, 8.0) + uChunk, 1.0);
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * (world.xyz - cameraPosition), 1.0);
}`;
const FS = /* glsl */`
uniform sampler2DArray uAlbedo;
uniform sampler2D uNoise;
uniform float uClock;
#ifdef HDR
uniform sampler2D uExpo;
#endif
in vec2 vUv; flat in float vLayer; flat in int vFlags;
layout(location = 0) out vec4 outColor;
` + GLINT + `
void main() {
  int rot = (vFlags >> 2) & 3;
  vec2 uv = vUv;
  if (rot == 1) uv = vec2(1.0 - vUv.y, vUv.x);
  else if (rot == 2) uv = vec2(1.0 - vUv.x, 1.0 - vUv.y);
  else if (rot == 3) uv = vec2(vUv.y, 1.0 - vUv.x);
  if (textureLod(uAlbedo, vec3(uv, vLayer), 0.0).a < 0.5) discard;
  vec3 g = glintAt(vUv * 16.0 * 6.0, uClock) * 1.3;
#ifdef HDR
  /* High and RIP: the picture is still light to go through the eye and the
     tone curve, which turned the shimmer at full strength into pale lilac
     blotches glaring over the item. So it goes in as the light that comes out
     about as bright as the shimmer the game adds on screen (its blend squares
     the colour, as here), and the exposure is taken off it. */
  g = min(g, vec3(1.0));
  g = g * g * 0.5 / max(texture(uExpo, vec2(0.5)).r, 0.02);
#endif
  outColor = vec4(g, 1.0);
}`;

export function glintMaterial(R, gui) {
  const mats = R.glintMats || (R.glintMats = []), k = gui ? 1 : 0;
  if (mats[k]) return mats[k];
  // gui: for the figure in the inventory, which is never exposed; made again for each look (render/looks.js)
  const uExpo = { value: null };
  const make = o => new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: HEAD + VS, fragmentShader: HEAD + FS,
    uniforms: { uAlbedo: R.U.uAlbedo, uNoise: R.U.uNoise, uClock: R.U.uClock, uGlint: R.U.uGlint, uChunk: R.U.uChunk, uExpo },
    defines: !gui && !o.vanilla && !o.ldr ? { HDR: 1 } : {},
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthFunc: THREE.LessEqualDepth,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, side: THREE.DoubleSide,
  });
  const m = R.looked ? R.looked(make) : make(R.opts);
  // the full chain: the exposure the last frame was shown at
  if (!gui) m.userData.expo = uExpo;
  mats[k] = m;
  return m;
}

/* a glint on a held mesh (or off again): a child drawn after it, with the same geometry */
export function setGlint(mesh, on, R, gui) {
  if (!mesh) return;
  let g = mesh.userData.glint;
  if (on && !g) {
    g = new THREE.Mesh(mesh.geometry, glintMaterial(R, gui));
    g.frustumCulled = false; g.matrixAutoUpdate = false;
    // Detailed: the exposure texture changes hands every frame
    const u = g.material.userData.expo;
    if (u) g.onBeforeRender = () => { const post = R.post; if (post && post.expo) u.value = post.expo[post.expoI].texture; };
    mesh.add(g);
    mesh.userData.glint = g;
  }
  if (g) g.visible = !!on;
}
