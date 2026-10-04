/* ---------------------------------------------------------------------------
   Leoncraft 2 - the player you can see.

     model     the classic 64 x 64 skin layout: head, body, two arms (4 or 3
               pixels wide) and two legs, each with its outer layer puffed out
               (the hat by half a pixel, everything else by a quarter), 32
               pixels tall at a scale of 0.9375, so 1.875 blocks. One mesh,
               one draw: every vertex knows its part, and the parts' matrices
               go up as one uniform array.
     pose      the game's humanoid numbers: legs swing 1.4 times as far as the
               arms on cos(limb * 0.6662), the swing amount eased per tick, a
               slow idle sway of the arms, the sneak lean, the 6 tick arm
               swing, a stroke when swimming. The body only turns once the head
               has turned more than 50 degrees, and turns towards where you
               walk. Everything is worked out at 20 ticks a second and drawn
               between them with the game's own alpha.
     light     the same sun, shadow map, sky and torch light as the blocks,
               the sky and block light levels found around the player on the
               main thread a few times a second; on the low tiers the same
               single-pass finish (fog, exposure, tone map) as the terrain.
     views     Q (or F5) goes first person, third person behind, third person
               in front, with the camera pulled in so it never ends inside a
               block; in first person an empty hand is the skin's own arm.

   The box sizes, pivots, overlay sizes and the skin's UV unwrapping follow
   skinview3d (https://github.com/bs-community/skinview3d), MIT licence:
     Copyright (c) 2014-2018 Kent Rasmussen
     Copyright (c) 2017-2022 Haowei Wen, Sean Boult and contributors
     Permission is hereby granted, free of charge, to any person obtaining a
     copy of this software and associated documentation files (the
     "Software"), to deal in the Software without restriction, including
     without limitation the rights to use, copy, modify, merge, publish,
     distribute, sublicense, and/or sell copies of the Software, and to permit
     persons to whom the Software is furnished to do so, subject to the
     following conditions: The above copyright notice and this permission
     notice shall be included in all copies or substantial portions of the
     Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
--------------------------------------------------------------------------- */
import { VANILLA, AVATAR_FS } from './vanilla.js?v=9';
import { COMMON, SHADOW, TONEMAP, LDR, LIGHTS } from './glsl.js?v=9';
import { lightDefines } from './materials.js?v=9';
import { SOLID, OPAQUE, OPACITY, EMIT, FLUID } from '../blocks.js?v=9';
import { H, idx } from '../world-const.js?v=9';
const THREE = window.THREE;

const PI = Math.PI, DEG = PI / 180;
const MODEL_SCALE = 0.9375 / 16;
const wrap = a => a - 2 * PI * Math.round(a / (2 * PI));
const mix = (x, y, t) => x + (y - x) * t;

/* the outer layers, as bits of the show mask (bit 0 is the base layer, always on) */
export const SKIN_PARTS = ['hat', 'jacket', 'leftSleeve', 'rightSleeve', 'leftPants', 'rightPants'];
const BIT = { hat: 1, jacket: 2, leftSleeve: 3, rightSleeve: 4, leftPants: 5, rightPants: 6 };
const DEFAULT_SKIN = new URL('../../textures/skin/default.png?v=9', import.meta.url).href;
// the default skin: ours, or the one a resource pack the player opened brings (see ui/pack.js)
let defaultSkin = DEFAULT_SKIN;

/* ---- what the player chose, kept in the browser ---- */
const KEY = 'lc2_skin';
const settings = (() => {
  const s = { skin: null, slim: null, show: 0x7f };
  try { Object.assign(s, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
  return s;
})();
function saveSettings() { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) {} }

let current = null;
/* For the Skin Customization screen. They work before the renderer exists
   too: the choice is saved and picked up when the avatar is made. */
export function setSkin(urlOrImage, slim) {
  if (current) return current.setSkin(urlOrImage, slim);
  settings.skin = typeof urlOrImage === 'string' ? urlOrImage : null; settings.slim = slim === undefined ? null : slim; saveSettings();
  return Promise.resolve();
}
export function resetSkin() { return setSkin(defaultSkin, false); }
// a pack's own default skin; worn unless the player chose a skin of their own
export function useDefaultSkin(url) {
  defaultSkin = url || DEFAULT_SKIN;
  if (current && !settings.skin) return current.setSkin(defaultSkin, false);
  return Promise.resolve();
}
export function setSkinPart(name, on) {
  const names = name === 'sleeves' ? ['leftSleeve', 'rightSleeve'] : name === 'pants' ? ['leftPants', 'rightPants'] : [name];
  for (const n of names) {
    if (!BIT[n]) continue;
    if (on) settings.show |= 1 << BIT[n]; else settings.show &= ~(1 << BIT[n]);
  }
  settings.show |= 1;
  saveSettings();
  if (current) current.uShow.value = settings.show;
}
export function getSkinParts() {
  const o = {};
  for (const n of SKIN_PARTS) o[n] = !!(settings.show & (1 << BIT[n]));
  return o;
}
export function getSkinSettings() { return { skin: settings.skin || defaultSkin, slim: !!settings.slim, parts: getSkinParts() }; }

/* ---- the geometry ----
   Each box: [part, layer bit, centre from the part's pivot (model pixels, y up,
   +z the front, +x the player's left), size, skin uv origin, how far it is puffed out]. */
function boxList(slim) {
  const aw = slim ? 3 : 4, ax = slim ? 0.5 : 1;
  return [
    [0, 0, [0, 4, 0], [8, 8, 8], [0, 0], 0], [0, 1, [0, 4, 0], [8, 8, 8], [32, 0], 0.5],
    [1, 0, [0, -6, 0], [8, 12, 4], [16, 16], 0], [1, 2, [0, -6, 0], [8, 12, 4], [16, 32], 0.25],
    [2, 0, [-ax, -4, 0], [aw, 12, 4], [40, 16], 0], [2, 4, [-ax, -4, 0], [aw, 12, 4], [40, 32], 0.25],
    [3, 0, [ax, -4, 0], [aw, 12, 4], [32, 48], 0], [3, 3, [ax, -4, 0], [aw, 12, 4], [48, 48], 0.25],
    [4, 0, [0, -6, 0], [4, 12, 4], [0, 16], 0], [4, 6, [0, -6, 0], [4, 12, 4], [0, 32], 0.25],
    [5, 0, [0, -6, 0], [4, 12, 4], [16, 48], 0], [5, 5, [0, -6, 0], [4, 12, 4], [0, 48], 0.25],
  ];
}
// faces: normal, corners (top left, top right, bottom right, bottom left as seen from outside), uv rect
function faceList(u, v, w, h, d) {
  return [
    [[0, 0, 1], [[-1, 1, 1], [1, 1, 1], [1, -1, 1], [-1, -1, 1]], [u + d, v + d, u + d + w, v + d + h]],                 // front
    [[0, 0, -1], [[1, 1, -1], [-1, 1, -1], [-1, -1, -1], [1, -1, -1]], [u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h]], // back
    [[-1, 0, 0], [[-1, 1, -1], [-1, 1, 1], [-1, -1, 1], [-1, -1, -1]], [u, v + d, u + d, v + d + h]],                   // the player's right
    [[1, 0, 0], [[1, 1, 1], [1, 1, -1], [1, -1, -1], [1, -1, 1]], [u + d + w, v + d, u + 2 * d + w, v + d + h]],         // the player's left
    [[0, 1, 0], [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]], [u + d, v, u + d + w, v + d]],                         // top
    [[0, -1, 0], [[-1, -1, 1], [1, -1, 1], [1, -1, -1], [-1, -1, -1]], [u + d + w, v, u + d + 2 * w, v + d]],             // bottom
  ];
}
function buildGeometry(slim, onlyPart) {
  const P = [], N = [], T = [], A = [], I = [];
  for (const [part, layer, c, size, uv, inf] of boxList(slim)) {
    if (onlyPart !== undefined && part !== onlyPart) continue;
    const [w, h, d] = size;
    const hx = w / 2 + inf, hy = h / 2 + inf, hz = d / 2 + inf;
    for (const [n, corners, r] of faceList(uv[0], uv[1], w, h, d)) {
      const v0 = P.length / 3;
      const UV = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
      for (let k = 0; k < 4; k++) {
        const s = corners[k];
        P.push(c[0] + s[0] * hx, c[1] + s[1] * hy, c[2] + s[2] * hz);
        N.push(n[0], n[1], n[2]);
        T.push(UV[k][0] / 64, UV[k][1] / 64);
        A.push(part, layer);
      }
      I.push(v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(T, 2));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(A, 2));
  g.setIndex(I);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 64);
  return g;
}

/* ---- the shaders ---- */
const HEAD = `precision highp float; precision highp int; precision highp sampler2DShadow;\n`;
const VS = /* glsl */`
uniform mat4 viewMatrix, projectionMatrix;
uniform mat4 uParts[6];
uniform int uShow;
in vec3 position; in vec3 normal; in vec2 uv; in vec2 aPart;
out vec3 vWorld; out vec3 vN; out vec2 vUv; flat out int vLayer;
void main() {
  int layer = int(aPart.y + 0.5);
  vLayer = layer; vUv = uv;
  // a layer switched off goes behind the far plane
  if (((uShow >> layer) & 1) == 0) { vWorld = vec3(0.0); vN = vec3(0.0, 1.0, 0.0); gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  mat4 M = uParts[int(aPart.x + 0.5)];
  vec4 w = M * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = mat3(M) * normal;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FS = /* glsl */`
uniform sampler2D uSkin, uAmbient;
uniform vec3 cameraPosition, uLightDir;
uniform float uFrame;
uniform vec2 uLightLv;   // sky and block light where the player stands, 0..1
uniform float uTime;
uniform sampler2D uNoise;
#ifdef LDR
uniform sampler2D uView;
uniform float uEyeInWater;
` + LDR + `
#endif
` + LIGHTS + `
in vec3 vWorld; in vec3 vN; in vec2 vUv; flat in int vLayer;
layout(location = 0) out vec4 outColor;
vec3 ambientAt(vec3 n) {
  vec3 up = texelFetch(uAmbient, ivec2(0, 0), 0).rgb;
  vec3 side = texelFetch(uAmbient, ivec2(1, 0), 0).rgb;
  vec3 down = texelFetch(uAmbient, ivec2(2, 0), 0).rgb;
  return n.y > 0.0 ? mix(side, up, n.y) : mix(side, down, -n.y);
}
void main() {
  vec4 t = texture(uSkin, vUv);
  // the base layer is solid and one-sided (a camera pushed into the head sees out); the outer layers are cut out
  if (vLayer == 0 ? !gl_FrontFacing : t.a < 0.5) discard;
  vec3 albedo = toLinear(t.rgb);
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  float sky = uLightLv.x, block = uLightLv.y;
  vec3 L = uLightDir;
  float NoL = dot(N, L);
  float gate = smoothstep(0.03, 0.2, sky);
  float shadow = 0.0;
#if SHADOWS > 0
  if (gate > 0.0 && NoL > 0.0) {
    vec3 sc = shadowCoord(vWorld, N, NoL, length(cameraPosition - vWorld));
#if SHADOWS > 1
    shadow = shadowSoft(sc, ign(gl_FragCoord.xy, uFrame), 1.6);
#else
    shadow = shadowHard(sc);
#endif
    float edge = max(abs(sc.x - 0.5), abs(sc.y - 0.5)) * 2.0;
    shadow = mix(shadow, smoothstep(0.85, 0.95, sky), linstep(0.85, 1.0, edge));
  }
#else
  shadow = smoothstep(0.8, 0.95, sky) * step(0.0, NoL);
#endif
  shadow *= gate;
  if (shadow > 0.0) shadow *= cloudShade(vWorld, L);
  // lit as the blocks are: sun, sky, torch light and the floor every cave has
  vec3 sunC = texelFetch(uAmbient, ivec2(3, 0), 0).rgb;
  vec3 diffuse = sunC * shadow * sat(NoL);
  vec3 amb = ambientAt(N);
  amb = mix(amb, vec3(lum(amb)), 0.22);
  amb += sunC * 0.03;
  amb *= sky * sky * 0.8;
  block = max(block, heldLight(vWorld, N));
  vec3 blockL = block > 0.0 ? blockLight(block, sky * sky * sat(lum(sunC) * 0.3)) : vec3(0.0);
  vec3 col = albedo / PI * (diffuse * PI + amb + blockL + vec3(0.0035, 0.004, 0.006));
#ifdef LDR
  col = finishLDR(col, vWorld);
#endif
  outColor = vec4(col, 1.0);
}`;
const SHADOW_VS = /* glsl */`
uniform mat4 uShadowMat;
uniform mat4 uParts[6];
uniform int uShow;
in vec3 position; in vec2 uv; in vec2 aPart;
out vec2 vUv; flat out int vLayer;
const float SHADOW_B = 0.85;
void main() {
  int layer = int(aPart.y + 0.5);
  vLayer = layer; vUv = uv;
  if (((uShow >> layer) & 1) == 0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  vec4 c = uShadowMat * (uParts[int(aPart.x + 0.5)] * vec4(position, 1.0));
  c.xy /= length(c.xy) * SHADOW_B + (1.0 - SHADOW_B);
  c.z *= 0.2;
  gl_Position = c;
}`;
const SHADOW_FS = /* glsl */`
uniform sampler2D uSkin;
in vec2 vUv; flat in int vLayer;
out vec4 o;
void main() {
  if (vLayer > 0 && texture(uSkin, vUv).a < 0.5) discard;
  o = vec4(1.0);
}`;

/* ---- a skin image onto the 64 x 64 canvas: old 64 x 32 skins get their
   left arm and leg as mirror copies of the right, as the game does ---- */
function drawSkin(canvas, img) {
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.clearRect(0, 0, 64, 64);
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const k = w / 64;      // high resolution skins are drawn down to 64
  if (Math.abs(h / w - 0.5) < 0.01) {
    g.drawImage(img, 0, 0, w, h, 0, 0, 64, 32);
    const flip = (sx, sy, sw, sh, dx, dy) => {
      g.save(); g.translate(dx + sw, dy); g.scale(-1, 1); g.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh); g.restore();
    };
    for (const [u, v, U, V] of [[0, 16, 16, 48], [40, 16, 32, 48]]) {
      flip(u + 4, v, 4, 4, U + 4, V); flip(u + 8, v, 4, 4, U + 8, V);
      flip(u, v + 4, 4, 12, U + 8, V + 4); flip(u + 4, v + 4, 4, 12, U + 4, V + 4);
      flip(u + 8, v + 4, 4, 12, U, V + 4); flip(u + 12, v + 4, 4, 12, U + 12, V + 4);
    }
    // old skins often filled the hat with a solid colour; that hides the face
    const hat = g.getImageData(32, 0, 32, 16).data;
    let solid = true;
    for (let i = 3; i < hat.length; i += 4) if (hat[i] < 255) { solid = false; break; }
    if (solid) g.clearRect(32, 0, 32, 16);
  } else {
    g.imageSmoothingEnabled = false;
    g.drawImage(img, 0, 0, w, h, 0, 0, 64, Math.round(h / k));
  }
}
// slim (3 pixel) arms leave the last column of the arm's strips empty
function looksSlim(canvas) {
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(50, 16, 6, 16).data;
  const at = (x, y) => d[((y - 16) * 6 + (x - 50)) * 4 + 3];
  for (let y = 16; y < 20; y++) for (let x = 50; x < 52; x++) if (at(x, y)) return false;
  for (let y = 20; y < 32; y++) for (let x = 54; x < 56; x++) if (at(x, y)) return false;
  return true;
}
function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

/* where each part's pivot sits at rest, in the game's model space
   (pixels, y down from the neck, -z the front) */
const REST = [[0, 0, 0], [0, 0, 0], [-5, 2, 0], [5, 2, 0], [-1.9, 12, 0.1], [1.9, 12, 0.1]];

export class Avatar {
  constructor(renderer) {
    current = this;
    this.R = renderer;
    const U = renderer.U, opts = renderer.opts;
    this.view = 0;                  // 0 first person, 1 behind, 2 in front
    this.slim = !!settings.slim;
    this.ready = false;
    // the skin: a canvas, uploaded whenever a new skin is drawn into it
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = 64;
    const tex = this.tex = new THREE.Texture(this.canvas);
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false; tex.flipY = false;
    this.parts = Array.from({ length: 6 }, () => new THREE.Matrix4());
    this.armParts = Array.from({ length: 6 }, () => new THREE.Matrix4());
    this.uShow = { value: settings.show | 1 };
    this.uLight = { value: new THREE.Vector2(1, 0) };
    const uni = Object.assign({}, U, { uSkin: { value: tex }, uParts: { value: this.parts }, uShow: this.uShow, uLightLv: this.uLight });
    const defines = { SHADOWS: opts.shadows === undefined ? 2 : opts.shadows };
    if (opts.ldr) defines.LDR = 1;
    Object.assign(defines, lightDefines(opts));
    const mk = (vs, fs, uniforms, extra) => new THREE.RawShaderMaterial(Object.assign({
      glslVersion: THREE.GLSL3, vertexShader: HEAD + COMMON + vs,
      fragmentShader: opts.vanilla ? HEAD + VANILLA + AVATAR_FS : HEAD + COMMON + SHADOW + TONEMAP + fs,
      uniforms, defines, side: THREE.DoubleSide,
    }, extra || {}));
    this.mat = mk(VS, FS, uni);
    // the first-person arm: over whatever it is pushed into, like the held block
    this.armMat = mk(VS, FS, Object.assign({}, uni, { uParts: { value: this.armParts } }), { side: THREE.FrontSide, depthFunc: THREE.AlwaysDepth });
    this.shadowMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: HEAD + SHADOW_VS, fragmentShader: HEAD + SHADOW_FS, uniforms: uni, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(buildGeometry(this.slim), this.mat);
    this.shadowMesh = new THREE.Mesh(this.mesh.geometry, this.shadowMat);
    this.arm = new THREE.Mesh(buildGeometry(this.slim, 2), this.armMat);
    for (const m of [this.mesh, this.shadowMesh, this.arm]) { m.frustumCulled = false; m.matrixAutoUpdate = false; m.visible = false; }
    renderer.scene.add(this.mesh);
    if (opts.shadows) renderer.shadowScene.add(this.shadowMesh);
    renderer.handScene.add(this.arm);
    // the held block in the model's hand, in third person
    this.held = null; this.heldFlat = false;
    this.heldRot = new THREE.Matrix3();
    // pose state, per tick (o... is the tick before)
    this.started = false;
    this.speed = 0; this.oSpeed = 0; this.limb = 0;
    this.body = 0; this.oBody = 0;
    this.swinging = false; this.swingT = 0; this.attack = 0; this.oAttack = 0;
    this.swim = 0; this.oSwim = 0;
    this.age = 0; this.acc = 0;
    this.pose = REST.map(() => ({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }));
    this.cur = { attack: 0 };
    // light around the player, and the chunks near it (so looking blocks up allocates nothing)
    this.lightT = 0; this.skyLv = 15; this.blockLv = 0; this.sky = 1; this.block = 0;
    this.cache = new Array(9).fill(null); this.cacheX = 1e9; this.cacheZ = 1e9; this.world = null;
    // scratch
    this.m = new THREE.Matrix4(); this.t = new THREE.Matrix4(); this.root = new THREE.Matrix4();
    this.e = new THREE.Euler(); this.handPos = new THREE.Vector3(); this.vs = new THREE.Vector3(MODEL_SCALE, MODEL_SCALE, MODEL_SCALE);
    this.setSkin(settings.skin || defaultSkin, settings.slim === null ? undefined : settings.slim).catch(() => this.setSkin(defaultSkin, false));
  }

  /* ---- skins ----
     urlOrImage: a URL (data: and blob: too), an Image, an ImageBitmap or a canvas.
     slim: true for 3 pixel arms, false for 4, left out to tell from the skin. */
  async setSkin(urlOrImage, slim) {
    const img = typeof urlOrImage === 'string' ? await loadImage(urlOrImage) : urlOrImage;
    drawSkin(this.canvas, img);
    const s = slim === undefined || slim === null ? looksSlim(this.canvas) : !!slim;
    if (s !== this.slim) {
      this.slim = s;
      const old = this.mesh.geometry, oldArm = this.arm.geometry;
      this.mesh.geometry = this.shadowMesh.geometry = buildGeometry(s);
      this.arm.geometry = buildGeometry(s, 2);
      old.dispose(); oldArm.dispose();
    }
    this.tex.needsUpdate = true;
    this.ready = true;
    // keep it for next time: the default by name, anything else as a picture
    settings.slim = s;
    settings.skin = urlOrImage === DEFAULT_SKIN || urlOrImage === defaultSkin ? null : (() => { try { return this.canvas.toDataURL('image/png'); } catch (e) { return null; } })();
    saveSettings();
  }
  setPart(name, on) { setSkinPart(name, on); }
  get partsShown() { return getSkinParts(); }

  /* ---- views ---- */
  cycleView() { this.view = (this.view + 1) % 3; return this.view; }
  setView(v) { this.view = ((v | 0) % 3 + 3) % 3; }

  /* ---- the held block, from the renderer's setHeld: the same geometry,
     with its own light attribute so it darkens in a cave ---- */
  setHeld(handMesh, flat) {
    const R = this.R;
    if (this.held) { R.scene.remove(this.held); this.held.geometry.dispose(); this.held = null; }
    if (!handMesh) return;
    const src = handMesh.geometry, g = new THREE.BufferGeometry();
    for (const n of ['aPos', 'aA', 'aC']) g.setAttribute(n, src.attributes[n]);
    g.setIndex(src.index);
    g.setAttribute('aL', new THREE.BufferAttribute(new Uint8Array(src.attributes.aL.count * 4), 4));
    g.boundingSphere = src.boundingSphere;
    const m = this.held = new THREE.Mesh(g, flat ? R.mats.cutout : R.mats.opaque);
    m.frustumCulled = false; m.matrixAutoUpdate = false; m.visible = false;
    this.heldFlat = flat; this.heldLight = -1;
    // the shader's face frames turn with the block (as the renderer's own hand does)
    const U = R.U, rot = this.heldRot;
    m.onBeforeRender = () => { rot.setFromMatrix4(m.matrixWorld); rot.multiplyScalar(1 / m.matrixWorld.getMaxScaleOnAxis()); U.uFaceRot.value.copy(rot); m.material.uniformsNeedUpdate = true; };
    m.onAfterRender = () => { U.uFaceRot.value.identity(); m.material.uniformsNeedUpdate = true; };
    R.scene.add(m);
  }

  startSwing() {
    // as the game: a click in the second half of a swing starts it again
    if (!this.swinging || this.swingT >= 3 || this.swingT < 0) { this.swingT = -1; this.swinging = true; }
  }

  /* ---- one game tick ---- */
  tick(P) {
    const dx = P.pos.x - P.prev.x, dz = P.pos.z - P.prev.z;
    const d2 = dx * dx + dz * dz;
    // how far the limbs swing follows the speed, eased
    this.oSpeed = this.speed;
    this.speed += (Math.min(1, Math.sqrt(d2) * 4) - this.speed) * 0.4;
    this.limb += this.speed;
    // the body: towards where you walk (backwards walking keeps it facing ahead), and never more than 50 degrees off the head
    this.oBody = this.body;
    let want = this.body;
    if (d2 > 0.0025) {
      const m = Math.atan2(-dx, -dz);
      want = Math.abs(wrap(P.yaw - m)) > 95 * DEG ? m + PI : m;
    }
    if (this.attack > 0) want = P.yaw;
    this.body += wrap(want - this.body) * 0.3;
    const off = wrap(P.yaw - this.body);
    if (Math.abs(off) > 50 * DEG) this.body += off - Math.sign(off) * 50 * DEG;
    // the arm swing: 6 ticks
    this.oAttack = this.attack;
    if (this.swinging) { if (++this.swingT >= 6) { this.swingT = 0; this.swinging = false; } } else this.swingT = 0;
    this.attack = this.swingT / 6;
    // swimming: sprinting in water lays the body down
    this.oSwim = this.swim;
    const sw = P.pose === 'swim' && !P.flying ? 1 : 0;
    this.swim = sw > this.swim ? Math.min(1, this.swim + 0.09) : Math.max(0, this.swim - 0.09);
    this.age++;
  }

  /* ---- every frame: ticks since the last one, light, pose, camera ---- */
  update(state, dt, cam) {
    const P = state.player, R = this.R;
    if (R.swing >= 1) { this.startSwing(); R.swing = 0.999; }
    if (!P) { this.mesh.visible = this.shadowMesh.visible = false; if (this.held) this.held.visible = false; return; }
    this.world = P.w;
    const a = state.alpha;
    if (!this.started) {
      this.started = true;
      this.body = this.oBody = P.yaw;
    } else if (a !== undefined && this.lastAlpha !== undefined) {
      // the game's tick clock: the same dt went into its accumulator
      let n = Math.round(this.lastAlpha + dt * 20 - a);
      for (n = Math.min(n, 5); n > 0; n--) this.tick(P);
    } else {
      for (this.acc += dt; this.acc >= 0.05; this.acc -= 0.05) this.tick(P);
    }
    this.lastAlpha = a;
    const al = a === undefined ? this.acc / 0.05 : a;
    const feet = state.feet || P.pos;
    // the light around you, a few times a second, eased so it never pops
    this.lightT -= dt;
    if (this.lightT <= 0) { this.lightT = 0.25; this.refreshCache(feet.x, feet.z); this.sampleLight(feet); }
    const k = Math.min(1, dt * 6);
    this.sky += (this.skyLv / 15 - this.sky) * k; this.block += (this.blockLv / 15 - this.block) * k;
    this.uLight.value.set(this.sky, this.block);
    this.posed(P, al, feet);
    const third = this.view !== 0 && this.ready;
    this.mesh.visible = third;
    this.shadowMesh.visible = this.ready;
    if (this.held) {
      this.held.visible = third;
      const lv = (Math.round(this.sky * 255) << 8) | Math.round(this.block * 255);
      if (third && lv !== this.heldLight) {
        this.heldLight = lv;
        const L = this.held.geometry.attributes.aL;
        for (let i = 0; i < L.count; i++) { L.array[i * 4] = lv >> 8; L.array[i * 4 + 1] = lv & 255; }
        L.needsUpdate = true;
      }
    }
    // in third person the light in your hand is where the model's hand is (the renderer reads state.handPos)
    if (third && !state.handPos) state.handPos = this.handPos.set(-1, -10, 0).applyMatrix4(this.parts[2]);
    if (this.view && cam) this.placeCamera(cam, state);
  }

  /* the pose, in the game's model space (y down, -z forward), then the matrices */
  posed(P, a, feet) {
    const S = this.pose;
    for (let i = 0; i < 6; i++) { const p = S[i], r = REST[i]; p.x = r[0]; p.y = r[1]; p.z = r[2]; p.rx = p.ry = p.rz = 0; }
    if (this.slim) S[2].y = S[3].y = 2.5;
    const head = S[0], body = S[1], armR = S[2], armL = S[3], legR = S[4], legL = S[5];
    const amt = Math.min(1, this.oSpeed + (this.speed - this.oSpeed) * a);
    const ls = this.limb - this.speed * (1 - a);
    const age = this.age + a;
    const bodyYaw = this.oBody + wrap(this.body - this.oBody) * a;
    let att = this.attack - this.oAttack;
    if (att < 0) att += 1;
    att = this.swinging || this.oAttack > 0 ? this.oAttack + att * a : 0;
    this.cur.attack = att;
    const swim = this.oSwim + (this.swim - this.oSwim) * a;
    const sneak = P.sneaking && !P.flying && swim === 0;

    head.rx = -P.pitch;
    head.ry = -wrap(P.yaw - bodyYaw);
    // walking: opposite arm and leg together
    const c = Math.cos(ls * 0.6662);
    armR.rx = -c * amt; armL.rx = c * amt;
    legR.rx = c * 1.4 * amt; legL.rx = -c * 1.4 * amt;
    // holding something: the arm comes up a little
    if (this.held) armR.rx = armR.rx * 0.5 - PI / 10;
    // the swing: the body twists and the right arm comes over and down
    if (att > 0) {
      body.ry = Math.sin(Math.sqrt(att) * 2 * PI) * 0.2;
      armR.z = Math.sin(body.ry) * 5; armR.x = -Math.cos(body.ry) * 5;
      armL.z = -Math.sin(body.ry) * 5; armL.x = Math.cos(body.ry) * 5;
      armR.ry += body.ry; armL.ry += body.ry; armL.rx += body.ry;
      const e = 1 - Math.pow(1 - att, 4);
      const lift = Math.sin(e * PI), dip = Math.sin(att * PI) * -(head.rx - 0.7) * 0.75;
      armR.rx -= lift * 1.2 + dip;
      armR.ry += body.ry * 2;
      armR.rz += Math.sin(att * PI) * -0.4;
    }
    // riding (a boat, a horse: js/entities): sitting, legs forward and a little apart, arms down
    if (P.riding) {
      armR.rx = -PI / 5 + (this.held ? -PI / 10 : 0); armL.rx = -PI / 5;
      legR.rx = -1.4137167; legR.ry = PI / 10; legR.rz = 0.07853982;
      legL.rx = -1.4137167; legL.ry = -PI / 10; legL.rz = -0.07853982;
    }
    // sneaking: lean in, legs back, everything lower
    if (sneak) {
      body.rx = 0.5; body.y = 3.2;
      armR.rx += 0.4; armL.rx += 0.4; armR.y += 3.2; armL.y += 3.2;
      legR.z = legL.z = 4; legR.y = legL.y = 12.2;
      head.y = 4.2;
    }
    // the arms' idle sway
    const sz = Math.cos(age * 0.09) * 0.05 + 0.05, sx = Math.sin(age * 0.067) * 0.05;
    armR.rz += sz; armL.rz -= sz; armR.rx += sx; armL.rx -= sx;
    // swimming: arms reach past the head and pull back, legs flutter, the head looks ahead
    if (swim > 0) {
      const st = 0.5 + 0.5 * Math.cos(ls * 0.22);
      armR.rx = mix(armR.rx, -PI * st, swim); armL.rx = mix(armL.rx, -PI * st, swim);
      armR.rz = mix(armR.rz, 0.5 * Math.sin(st * PI), swim); armL.rz = mix(armL.rz, -0.5 * Math.sin(st * PI), swim);
      legR.rx = mix(legR.rx, 0.3 * Math.cos(ls * 0.333), swim); legL.rx = mix(legL.rx, -0.3 * Math.cos(ls * 0.333), swim);
      head.rx = mix(head.rx, -PI / 4, swim);
    }

    // the whole model: at the feet, turned with the body, lowered when sneaking, laid down when swimming
    const root = this.root, t = this.t;
    root.makeRotationY(bodyYaw + PI);
    root.setPosition(feet.x, feet.y - (sneak ? 0.125 : 0), feet.z);
    if (swim > 0) {
      root.multiply(t.makeTranslation(0, 0.9, 0));
      root.multiply(t.makeRotationX(swim * (PI / 2 - P.pitch)));
      root.multiply(t.makeTranslation(0, -0.9, 0));
    }
    root.scale(this.vs);
    for (let i = 0; i < 6; i++) {
      const p = S[i], m = this.parts[i];
      // the game's model space to this one: y and z flip, so do the y and z turns
      m.makeRotationFromEuler(this.e.set(p.rx, -p.ry, -p.rz, 'ZYX'));
      m.setPosition(p.x, 24 - p.y, -p.z);
      m.premultiply(root);
    }
    if (this.held) this.placeHeld();
  }

  /* the block in the model's right hand: the game's third-person item placing
     (at the hand, turned 75 and 45 degrees, 0.375 of a block for a block) */
  placeHeld() {
    const m = this.held.matrix, t = this.t;
    m.copy(this.parts[2]);
    m.multiply(t.makeScale(16, -16, -16));            // back to the game's model space, in blocks
    m.multiply(t.makeRotationX(-PI / 2));
    m.multiply(t.makeRotationY(PI));
    m.multiply(t.makeTranslation(1 / 16, 0.125, -0.625));
    if (this.heldFlat) {
      m.multiply(t.makeTranslation(0, 3 / 16, 1 / 16));
      m.multiply(t.makeScale(0.55, 0.55, 0.55));
    } else {
      m.multiply(t.makeTranslation(0, 2.5 / 16, 0));
      m.multiply(t.makeRotationFromEuler(this.e.set(75 * DEG, 45 * DEG, 0, 'XYZ')));
      m.multiply(t.makeScale(0.375, 0.375, 0.375));
    }
    m.multiply(t.makeTranslation(0, -1, 0));          // the hand geometry's cube is centred one block up
    this.held.matrixWorldNeedsUpdate = true;
  }

  /* ---- the first-person arm: the game's arm placing in front of the camera,
     with its swing; drawn when the hand is empty ---- */
  placeArm(state, cam, on) {
    this.arm.visible = !!on && this.ready && this.started;
    if (!this.arm.visible) return;
    const sp = this.cur.attack, sq = Math.sqrt(sp);
    const bob = state.bob, m = this.armParts[2], t = this.t;
    m.copy(cam.matrixWorld);
    m.multiply(t.makeTranslation(0.64 - 0.3 * Math.sin(sq * PI) + (bob ? bob.x : 0), -0.6 + 0.4 * Math.sin(sq * 2 * PI) + (bob ? bob.y : 0), -0.72 - 0.4 * Math.sin(sp * PI)));
    m.multiply(t.makeRotationY(45 * DEG + Math.sin(sq * PI) * 70 * DEG));
    m.multiply(t.makeRotationZ(Math.sin(sp * sp * PI) * -20 * DEG));
    m.multiply(t.makeTranslation(-1, 3.6, 3.5));
    m.multiply(t.makeRotationZ(120 * DEG));
    m.multiply(t.makeRotationX(200 * DEG));
    m.multiply(t.makeRotationY(-135 * DEG));
    m.multiply(t.makeTranslation(5.6, 0, 0));
    // the arm at its shoulder, in the game's model space (pixels, y down)
    m.multiply(t.makeTranslation(-5 / 16, (this.slim ? 2.5 : 2) / 16, 0));
    m.multiply(t.makeRotationZ(0.1));
    m.multiply(t.makeScale(1 / 16, -1 / 16, -1 / 16));
  }

  /* ---- third person: 4 blocks back along the look (or in front, looking
     back), pulled in by eight rays from just around the eye ---- */
  placeCamera(cam, state) {
    const e = state.eye;
    let yaw = state.yaw, pitch = state.pitch;
    if (this.view === 2) { yaw += PI; pitch = -pitch; }
    const cp = Math.cos(pitch);
    const fx = -Math.sin(yaw) * cp, fy = Math.sin(pitch), fz = -Math.cos(yaw) * cp;
    let d = 4;
    for (let i = 0; i < 8; i++) {
      const t = this.ray(e.x + (i & 1 ? 0.1 : -0.1), e.y + (i & 2 ? 0.1 : -0.1), e.z + (i & 4 ? 0.1 : -0.1), -fx, -fy, -fz, d);
      if (t < d) d = t;
    }
    cam.position.set(e.x - fx * d, e.y - fy * d, e.z - fz * d);
    cam.rotation.set(pitch, yaw, 0, 'YXZ');
  }
  // a voxel walk; the distance to the first block that stops the camera (the starting one does not count)
  ray(ox, oy, oz, dx, dy, dz, max) {
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = dx ? Math.abs(1 / dx) : Infinity, tdy = dy ? Math.abs(1 / dy) : Infinity, tdz = dz ? Math.abs(1 / dz) : Infinity;
    let tx = dx ? (dx > 0 ? x + 1 - ox : ox - x) * tdx : Infinity;
    let ty = dy ? (dy > 0 ? y + 1 - oy : oy - y) * tdy : Infinity;
    let tz = dz ? (dz > 0 ? z + 1 - oz : oz - z) * tdz : Infinity;
    for (let n = 0; n < 24; n++) {
      let t;
      if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; } else if (ty < tz) { y += sy; t = ty; ty += tdy; } else { z += sz; t = tz; tz += tdz; }
      if (t >= max) return max;
      const b = this.blockAt(x, y, z);
      if (b && (SOLID[b] || OPAQUE[b]) && !FLUID[b]) return t;
    }
    return max;
  }

  /* ---- blocks near the player, through a 3 x 3 chunk cache ---- */
  refreshCache(x, z) {
    const w = this.world;
    if (!w) return;
    this.cacheX = Math.floor(x / 16); this.cacheZ = Math.floor(z / 16);
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) this.cache[j * 3 + i] = w.chunks.get((this.cacheX + i - 1) + ',' + (this.cacheZ + j - 1)) || null;
  }
  chunkAt(x, z) {
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
    const i = cx - this.cacheX + 1, j = cz - this.cacheZ + 1;
    if (i >= 0 && i < 3 && j >= 0 && j < 3) return this.cache[j * 3 + i];
    return this.world ? this.world.chunkAt(x, z) || null : null;
  }
  blockAt(x, y, z) {
    if (y < 0 || y >= H) return 0;
    const c = this.chunkAt(x, z);
    return c ? c.blocks[idx(x - c.cx * 16, y, z - c.cz * 16)] : 0;
  }
  /* Sky light: the best of the nearby columns open to the sky above the
     player, less a level a block away. Block light: the brightest emitter
     within 7 blocks, less a level a block. (Walls are not traced: a torch
     behind one still reaches you a little.) */
  sampleLight(feet) {
    const x0 = Math.floor(feet.x), y0 = Math.floor(feet.y + 0.9), z0 = Math.floor(feet.z);
    let sky = 0;
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      const md = Math.abs(dx) + Math.abs(dz);
      if (md > 3 || 15 - md <= sky) continue;
      const x = x0 + dx, z = z0 + dz, c = this.chunkAt(x, z);
      if (!c) { sky = Math.max(sky, 15 - md); continue; }
      const lx = x - c.cx * 16, lz = z - c.cz * 16;
      let lv = 15 - md;
      for (let y = Math.max(0, y0); y <= c.top && y < H && lv > sky; y++) { const b = c.blocks[idx(lx, y, lz)]; if (b) lv -= OPACITY[b]; }
      if (lv > sky) sky = lv;
    }
    let bl = 0;
    for (let dz = -7; dz <= 7; dz++) for (let dx = -7; dx <= 7; dx++) {
      const hd = Math.abs(dx) + Math.abs(dz);
      if (hd > 13) continue;
      const x = x0 + dx, z = z0 + dz, c = this.chunkAt(x, z);
      if (!c) continue;
      const lx = x - c.cx * 16, lz = z - c.cz * 16;
      for (let dy = -6; dy <= 6; dy++) {
        const y = y0 + dy;
        if (y < 0 || y >= H) continue;
        const e = EMIT[c.blocks[idx(lx, y, lz)]];
        if (e) { const l = e - hd - Math.abs(dy); if (l > bl) bl = l; }
      }
    }
    this.skyLv = Math.max(0, sky); this.blockLv = bl;
  }
}
