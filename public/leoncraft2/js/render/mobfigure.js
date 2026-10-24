/* ---------------------------------------------------------------------------
   Leoncraft 2 - the animal in its own screen.

   A horse's, donkey's, mule's, llama's or camel's screen (ui/containers.js
   MountScreen) shows the animal in the black box beside the saddle, as the
   game draws any mob there: standing with the middle of its height a quarter
   of a block below the middle of the box, 17 GUI pixels a block, turned to
   the mouse (the body by atan(dx / 40) x 20 degrees, the head as much again,
   the head tipped up or down by atan(dy / 40) x 20 degrees and the whole
   animal leaning back or forward by the same about its feet), in what it
   wears (saddle, armour, carpet, chest, markings) and its own breathing,
   tail and ears as they are at that moment. Lit as the inventory figure is
   (render/figure.js): two fixed lights from above and in front, 0.4 under.

   The parts are posed by the same rules the world uses (entities/manager.js
   drawOne), into a small texture of matrices of its own, and drawn into the
   figure's picture (figure.js) in its place.
--------------------------------------------------------------------------- */
import { MODELS, POSE, restPose } from '../entities/mobmodels.js?v=107';
import { SLOTS } from '../entities/mobart.js?v=107';
import { ATLAS, modelGeometry } from './entitymesh.js?v=107';
const THREE = window.THREE;
const DEG = Math.PI / 180;
const MAX_PARTS = 64;

const HEAD = `precision highp float; precision highp int;\n`;
const VS = /* glsl */`
uniform mat4 viewMatrix, projectionMatrix;
uniform highp sampler2D uBones;
uniform vec2 uOff;
in vec3 position; in vec3 normal; in vec2 uv; in vec2 aPart;
out vec2 vUv; out vec3 vN; out float vTinted;
mat4 bone(int i) {
  ivec2 p = ivec2(i * 4, 0);
  return mat4(texelFetch(uBones, p, 0), texelFetch(uBones, p + ivec2(1, 0), 0), texelFetch(uBones, p + ivec2(2, 0), 0), texelFetch(uBones, p + ivec2(3, 0), 0));
}
void main() {
  mat4 M = bone(int(aPart.x + 0.5));
  vN = normalize(mat3(M) * normal);
  vUv = (uv + uOff) / ${ATLAS}.0;
  vTinted = aPart.y;
  gl_Position = projectionMatrix * viewMatrix * (M * vec4(position, 1.0));
}`;
const FS = /* glsl */`
uniform sampler2D uAtlas;
uniform vec3 uTint;
in vec2 vUv; in vec3 vN; in float vTinted;
layout(location = 0) out vec4 outColor;
const vec3 L0 = vec3(0.1508, 0.7538, 0.6396), L1 = vec3(-0.1508, 0.7538, 0.6396);
float guiShade(vec3 n) { return min(1.0, (max(0.0, dot(L0, n)) + max(0.0, dot(L1, n))) * 0.6 + 0.4); }
void main() {
  vec4 t = texture(uAtlas, vUv);
  if (t.a < 0.5) discard;
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  outColor = vec4(t.rgb * (vTinted > 0.5 ? uTint : vec3(1.0)) * guiShade(N), 1.0);
}`;

const wrap = a => { a %= 2 * Math.PI; if (a > Math.PI) a -= 2 * Math.PI; if (a < -Math.PI) a += 2 * Math.PI; return a; };

export class MobFigure {
  constructor(scene) {
    this.scene = scene;
    this.bones = new Float32Array(MAX_PARTS * 16);
    this.boneTex = new THREE.DataTexture(this.bones, MAX_PARTS * 4, 1, THREE.RGBAFormat, THREE.FloatType);
    this.boneTex.magFilter = this.boneTex.minFilter = THREE.NearestFilter; this.boneTex.generateMipmaps = false;
    this.uBones = { value: this.boneTex };
    this.uAtlas = { value: null };
    this.geos = new Map();            // model name -> its boxes, as a plain geometry
    this.meshes = [];                 // the animal, then each layer over it
    this.pose = new Float32Array(MAX_PARTS * POSE);
    this.A = {};
    this.mats = Array.from({ length: MAX_PARTS }, () => new THREE.Matrix4());
    this.root = new THREE.Matrix4(); this.t = new THREE.Matrix4(); this.euler = new THREE.Euler(); this.v = new THREE.Vector3();
    this.layerList = [];
  }
  geo(name) {
    let g = this.geos.get(name);
    if (g) return g;
    const src = modelGeometry(MODELS[name]);
    g = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'uv', 'aPart']) g.setAttribute(k, src.getAttribute(k));
    g.setIndex(src.index);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geos.set(name, g);
    return g;
  }
  mesh(i) {
    let m = this.meshes[i];
    if (m) return m;
    const mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: HEAD + VS, fragmentShader: HEAD + FS, side: THREE.DoubleSide,
      uniforms: { uBones: this.uBones, uAtlas: this.uAtlas, uOff: { value: new THREE.Vector2() }, uTint: { value: new THREE.Color(1, 1, 1) } },
    });
    m = this.meshes[i] = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    m.frustumCulled = false; m.matrixAutoUpdate = false; m.renderOrder = 10 + i; m.visible = false;
    this.scene.add(m);
    return m;
  }
  hide() { for (const m of this.meshes) m.visible = false; }

  /* Pose the animal for the box W (figure.js: its size in screen pixels, the mouse from its middle, the GUI scale,
     GUI pixels a block and the drop below the middle). False when there is nothing to draw. */
  posed(e, a, W) {
    this.hide();
    const c = e.constructor, name = e.modelName ? e.modelName() : c.MODEL, mdl = MODELS[name];
    if (!mdl || mdl.parts.length > MAX_PARTS || !e.m || !e.m.meshes) return false;
    this.uAtlas.value = e.m.meshes.atlas;
    const h = Math.atan(-W.mx / 40), i = Math.atan(-W.my / 40);
    // the game's turn: the body facing you, turned by h x 20 degrees, the head by as much again, tipped by i x 20
    const turn = -h * 20 * DEG, body = Math.PI + turn, head = body + turn;
    const P = this.pose, A = this.A;
    restPose(mdl, P);
    A.walk = e.prevWalk + (e.walk - e.prevWalk) * a; A.amt = Math.min(1, e.prevWalkAmt + (e.walkAmt - e.prevWalkAmt) * a) || 0;
    A.walk = A.walk || 0;
    A.age = e.age + a;
    A.yaw = -wrap(head - body);
    A.pitch = -(i * 20 * DEG);
    A.attack = 0; A.aggressive = false; A.aiming = false; A.eating = 0; A.flap = 0; A.swell = 0; A.riding = false; A.shake = false; A.angry = false; A.carry = 0; A.sitting = !!e.sitting;
    if (e.anim) e.anim(A, a);
    mdl.animate && mdl.animate(mdl, P, A);
    // the root: the feet the height's half and the drop below the middle of the box, leaning about them, turned
    const px = W.size * W.s, root = this.root, t = this.t;
    root.makeTranslation(0, -(e.h / 2 + W.drop) * px, 0);
    root.multiply(t.makeRotationX(-i * 20 * DEG));
    root.multiply(t.makeScale(px, px, px));
    root.multiply(t.makeRotationY(body + Math.PI));
    // (a foal is drawn as big as its parent, as the game divides by its scale)
    const s = (c.SCALE || 1) / 16 * (e.drawScale || 1);
    root.multiply(t.makeScale(s, s, s));
    const n = mdl.parts.length, mats = this.mats, eu = this.euler;
    for (let k = 0; k < n; k++) {
      const o = k * POSE, part = mdl.parts[k], m = mats[k];
      m.makeRotationFromEuler(eu.set(P[o + 3], -P[o + 4], -P[o + 5], 'ZYX'));
      const ps = P[o + 6];
      if (ps !== 1) m.scale(this.v.set(ps, ps, ps));
      if (part.parent >= 0) { m.setPosition(P[o], -P[o + 1], -P[o + 2]); m.premultiply(mats[part.parent]); }
      else { m.setPosition(P[o], 24 - P[o + 1], -P[o + 2]); m.premultiply(root); }
      this.bones.set(m.elements, k * 16);
    }
    this.boneTex.needsUpdate = true;
    // the animal, then its layers on the same bones ([model, texture, colour])
    const slot = SLOTS[e.texName ? e.texName() : c.TEX] || [0, 0];
    const tint = e.tint ? e.tint() : 0xffffff;
    this.put(0, name, slot, tint);
    const L = this.layerList; L.length = 0;
    if (e.layers) e.layers(L);
    let j = 1;
    for (const [ln, lt, col] of L) {
      if (!MODELS[ln] || MODELS[ln].parts.length > MAX_PARTS) continue;
      this.put(j++, ln, SLOTS[lt] || slot, col === null || col === undefined ? 0xffffff : col);
    }
    return true;
  }
  put(i, name, slot, col) {
    const m = this.mesh(i);
    m.geometry = this.geo(name);
    m.material.uniforms.uOff.value.set(slot[0], slot[1]);
    m.material.uniforms.uTint.value.setRGB(((col >> 16) & 255) / 255, ((col >> 8) & 255) / 255, (col & 255) / 255);
    m.visible = true;
  }
}
