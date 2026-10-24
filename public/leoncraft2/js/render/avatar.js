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
               block; in first person your arm is the skin's own arm, empty
               or holding what is in your hand (render/held.js).
     armour    what you wear, drawn over the skin with the game's armour
               model (render/armor.js): a second mesh on the same parts,
               leather in its dye, enchanted pieces with the glint. A carved
               pumpkin, a mob head or any other block worn on the head is
               that block, on the head as the game's head layer puts it.
     held      what is in either hand, in the model's hand in third person,
               placed the way the game places that kind of item.

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
import { VANILLA, AVATAR_FS } from './vanilla.js?v=107';
import { COMMON, SHADOW, TONEMAP, LDR, LIGHTS } from './glsl.js?v=107';
import { lightDefines } from './materials.js?v=107';
import { SOLID, OPAQUE, OPACITY, EMIT, FLUID } from '../blocks.js?v=107';
import { H, idx } from '../world-const.js?v=107';
import { lightNear } from '../lightlevel.js?v=107';
import { armorSheet, avatarArmorGeometry, poseWings, pieceLook, elytraLook, GLINT, SHEET_W, SHEET_H } from './armor.js?v=107';
import { blockGeometry, isFlatItem } from './blockmesh.js?v=107';
import { heldKind, heldGeometry, placeInHand, placeOnHead, setLight } from './held.js?v=107';
import { setGlint } from './glint.js?v=107';
import { hatParts, HAT_TEX } from './hats.js?v=107';
const THREE = window.THREE;

const PI = Math.PI, DEG = PI / 180;
const MODEL_SCALE = 0.9375 / 16;
const wrap = a => a - 2 * PI * Math.round(a / (2 * PI));
const mix = (x, y, t) => x + (y - x) * t;

/* the outer layers, as bits of the show mask (bit 0 is the base layer, always on) */
export const SKIN_PARTS = ['hat', 'jacket', 'leftSleeve', 'rightSleeve', 'leftPants', 'rightPants'];
const BIT = { hat: 1, jacket: 2, leftSleeve: 3, rightSleeve: 4, leftPants: 5, rightPants: 6 };
const DEFAULT_SKIN = new URL('../../textures/skin/default.png?v=107', import.meta.url).href;
// the default skin: ours, or the one a resource pack the player opened brings (see ui/pack.js)
let defaultSkin = DEFAULT_SKIN;

/* ---- what the player chose, kept in the browser ---- */
const KEY = 'lc2_skin';
const settings = (() => {
  const s = { skin: null, slim: null, show: 0x7f, cape: '', capeShown: true };
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
// the cape worn: a 64 x 32 picture's data URL (or any image URL), or '' for none
export function setCape(url) {
  settings.cape = typeof url === 'string' ? url : ''; saveSettings();
  if (current) return current.setCape(settings.capeShown !== false ? settings.cape : '');
  return Promise.resolve();
}
export function setSkinPart(name, on) {
  if (name === 'cape') { settings.capeShown = !!on; saveSettings(); if (current) current.setCape(on ? settings.cape : ''); return; }
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
export function getSkinSettings() { return { skin: settings.skin || defaultSkin, slim: !!settings.slim, parts: getSkinParts(), cape: settings.capeShown !== false && typeof settings.cape === 'string' ? settings.cape : '' }; }

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
/* The cape: the game's cloak, a 10 x 16 x 1 box hanging from its top edge (the pivot), laid out as any box is in a
   64 x 32 picture (its outside at 1,1, its inside at 12,1). Built in this model's frame, before the cape's own turn. */
function capeGeometry() {
  const P = [], N = [], T = [], A = [], I = [];
  const c = [0, -8, 0.5], hx = 5, hy = 8, hz = 0.5;
  for (const [n, corners, r] of faceList(0, 0, 10, 16, 1)) {
    const v0 = P.length / 3;
    const UV = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
    for (let k = 0; k < 4; k++) {
      const s = corners[k];
      P.push(c[0] + s[0] * hx, c[1] + s[1] * hy, c[2] + s[2] * hz);
      N.push(n[0], n[1], n[2]);
      T.push(UV[k][0] / 64, UV[k][1] / 32);
      A.push(0, 0);
    }
    I.push(v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2);
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
// grow: the boxes of the skin's first layer only, each grown by that many pixels every way (the Glowing outline's shell)
function buildGeometry(slim, onlyParts, grow) {
  const P = [], N = [], T = [], A = [], I = [];
  for (const [part, layer, c, size, uv, inf0] of boxList(slim)) {
    if (onlyParts && onlyParts.indexOf(part) < 0) continue;
    if (grow && layer !== 0) continue;
    const inf = inf0 + (grow || 0);
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

/* Riptide's swirl: a streaky white-blue picture of our own on two open
   eight-sided sleeves (render: Avatar.placeSwirl) */
function makeSwirl(R) {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 32;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, 64, 32);
  for (let i = 0; i < 9; i++) {
    const y = 2 + i * 3.3, a = 0.35 + 0.5 * ((i * 37) % 7) / 7;
    g.strokeStyle = `rgba(${200 + (i % 3) * 20},${230 + (i % 2) * 20},255,${a})`; g.lineWidth = 1 + (i % 2);
    g.beginPath(); g.moveTo(0, y); g.lineTo(64, y + 6); g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.wrapS = THREE.RepeatWrapping;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.85 });
  const group = new THREE.Group();
  for (const [r, h] of [[0.62, 1.7], [0.42, 1.2]]) {
    const geo = new THREE.CylinderGeometry(r, r, h, 8, 1, true);
    const m = new THREE.Mesh(geo, mat);
    m.matrixAutoUpdate = false; m.frustumCulled = false;
    group.add(m);
  }
  group.matrixAutoUpdate = false;
  R.scene.add(group);
  return group;
}

/* ---- the shaders ---- */
/* armour's colour: the piece in its dye, and where it has an undyed overlay
   (leather's), the overlay on top as it is */
const ARMOR_OVERLAY = /* glsl */`
in vec2 vUv3; in vec3 vTrimC;
vec4 armorColour(vec4 t) {
  vec4 c = vec4(t.rgb * vTint, t.a);
  if (vUv2.x >= 0.0) { vec4 o = texture(uSkin, vUv2); if (o.a >= 0.1) c = vec4(o.rgb, 1.0); }
  // a trim, in its material's colour, wherever it lands on the armour
  if (vUv3.x >= 0.0 && c.a >= 0.1) { vec4 m = texture(uSkin, vUv3); if (m.a >= 0.1) c = vec4(m.rgb * vTrimC, 1.0); }
  return c;
}`;
export { ARMOR_OVERLAY };
const HEAD = `precision highp float; precision highp int; precision highp sampler2DShadow;\n`;
const VS = /* glsl */`
uniform mat4 viewMatrix, projectionMatrix;
uniform vec3 cameraPosition;
uniform mat4 uParts[6];
uniform int uShow;
in vec3 position; in vec3 normal; in vec2 uv; in vec2 aPart;
out vec3 vWorld; out vec3 vN; out vec2 vUv; flat out int vLayer;
#ifdef ARMOR
// per piece (helmet, chestplate, leggings, boots, an elytra): its row's first pixel in the sheet, worn, glint, its overlay's row (or -1); and its colour
uniform vec4 uPiece[5];
uniform vec3 uTint[5];
uniform vec4 uTrim[5];   // per piece: its trim's row (or -1) and colour
uniform vec2 uSheet;
out vec3 vTint; out vec3 vG; out vec2 vUv2; out vec2 vUv3; out vec3 vTrimC;
#endif
void main() {
  int layer = int(aPart.y + 0.5);
#ifdef ARMOR
  vec4 pc = uPiece[layer];
  vLayer = 1; vUv = (uv + vec2(0.0, pc.x)) / uSheet;
  vTint = uTint[layer]; vG = vec3(uv, pc.z);
  vUv2 = pc.w < 0.0 ? vec2(-1.0) : (uv + vec2(0.0, pc.w)) / uSheet;
  vec4 tr = uTrim[layer];
  vUv3 = tr.x < 0.0 ? vec2(-1.0) : (uv + vec2(0.0, tr.x)) / uSheet; vTrimC = tr.yzw;
  // a piece not worn goes behind the far plane
  if (pc.y < 0.5) { vWorld = vec3(0.0); vN = vec3(0.0, 1.0, 0.0); gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
#else
  vLayer = layer; vUv = uv;
  // a layer switched off goes behind the far plane
  if (((uShow >> layer) & 1) == 0) { vWorld = vec3(0.0); vN = vec3(0.0, 1.0, 0.0); gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
#endif
  mat4 M = uParts[int(aPart.x + 0.5)];
  vec4 w = M * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = mat3(M) * normal;
  // (from the eye, never viewMatrix on the place in the world: vanilla.js TERRAIN_VS)
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * (w.xyz - cameraPosition), 1.0);
}`;
/* Glowing: the game draws an outline round the body, through walls too, and nothing over the body itself. Here the body's
   shape (its boxes grown to cover armour) is marked in the stencil, through everything, and a shell a little bigger is
   drawn in one flat colour only outside the mark. The shader looks that draw into their own target (High, RIP Computer)
   have no stencil there, so the shell shows as a see-through silhouette instead. */
const GLOW_VS = /* glsl */`
uniform mat4 viewMatrix, projectionMatrix;
uniform vec3 cameraPosition;
uniform mat4 uParts[6];
in vec3 position; in vec2 aPart;
void main() {
  vec4 w = uParts[int(aPart.x + 0.5)] * vec4(position, 1.0);
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * (w.xyz - cameraPosition), 1.0);
}`;
const GLOW_FS = /* glsl */`
uniform vec4 uGlow;
out vec4 o;
void main() { o = uGlow; }`;
const GLOW_MASK = 1.1, GLOW_GROW = 1.9;
let glowSeq = 0;
// Leon Network hides an invisible player's armour too, as the Hypixel games do (net/hub.js sets it while you are there)
export const invisLook = { hideArmor: false };
// no capes drawn while this is on (Chameleon on Leonpixel: a cape would give a painted hider away; net/hub.js sets it)
export const capeRule = { off: false };
const FS = /* glsl */`
uniform sampler2D uSkin, uAmbient;
uniform vec3 cameraPosition, uLightDir;
uniform float uFrame;
uniform vec2 uLightLv;   // sky and block light where the player stands, 0..1
uniform float uTime;
uniform float uHurt;     // 1 while hurt: the game's red overlay
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
in vec3 vWorld; in vec3 vN; in vec2 vUv; flat in int vLayer;
#ifdef ARMOR
in vec3 vTint; in vec3 vG; in vec2 vUv2;
uniform float uClock;
#ifndef LDR
uniform sampler2D uExpoTex;     // the eye's exposure, the last frame's (render/post.js)
#define GLINT_TONE
#endif
` + GLINT + `
` + ARMOR_OVERLAY + `
#endif
layout(location = 0) out vec4 outColor;
vec3 ambientAt(vec3 n) {
  vec3 up = texelFetch(uAmbient, ivec2(0, 0), 0).rgb;
  vec3 side = texelFetch(uAmbient, ivec2(1, 0), 0).rgb;
  vec3 down = texelFetch(uAmbient, ivec2(2, 0), 0).rgb;
  return n.y > 0.0 ? mix(side, up, n.y) : mix(side, down, -n.y);
}
void main() {
  vec4 t = texture(uSkin, vUv);
#ifdef ARMOR
  // armour is cut out and seen from both sides (the inside of a helmet from below); leather takes its dye; it never flashes red
  vec4 dyed = armorColour(t);
  if (dyed.a < 0.1) discard;
  vec3 albedo = toLinear(dyed.rgb);
#else
  // the base layer is solid and one-sided (a camera pushed into the head sees out); the outer layers are cut out
  if (vLayer == 0 ? !gl_FrontFacing : t.a < 0.5) discard;
  vec3 albedo = toLinear(t.rgb);
  albedo = mix(albedo, vec3(0.75, 0.0, 0.0), uHurt * 0.55);
#endif
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  float sky = uLightLv.x, block = uLightLv.y;
  vec3 L = uLightDir;
  float NoL = dot(N, L);
  // (no sun or moon in the other dimensions, and no shadow map drawn there)
  float gate = uDim > 0.5 ? 0.0 : smoothstep(0.03, 0.2, sky);
  float shadow = 0.0;
#if SHADOWS > 0
  if (gate > 0.0 && NoL > 0.0) {
    vec3 sc = shadowCoord(vWorld, N, NoL, length(cameraPosition - vWorld));
#if SHADOWS > 1
    shadow = shadowSoft(sc, ign(gl_FragCoord.xy, uFrame), uShadowSoft);
#else
    shadow = shadowHard(sc);
#endif
    shadow = mix(shadow, smoothstep(0.85, 0.95, sky), shadowFade(sc));
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
  // (the sky's light as the block it stands in gets it, no less: materials.js)
  amb *= sky * sky;
  // the Nether's even light and the End's dim sky light, as the blocks round you have it (materials.js); the
  // sky table is left at midnight there, so its light would have been none in the Nether and the Overworld's in the End
  if (uDim > 0.5) amb = uDimAmb * (uDim < 1.5 ? 1.0 : 0.3 + 0.7 * sky * sky);
  block = max(block, heldLight(vWorld, N));
  vec3 blockL = block > 0.0 ? blockLight(block, uDim > 0.5 ? 0.0 : sky * sky * sat(lum(sunC) * 0.3)) : vec3(0.0);
  vec3 light = (diffuse * PI + amb + blockL + lightFloor() + fullbrightFill(diffuse * PI + amb + blockL)) / PI;
  vec3 col = albedo * light;
#ifdef ARMOR
  /* the glint added unlit on the screen's own colour, as the game draws it (Fast: AVATAR_FS below), so
     it is as bright in a cave as in the sun. It went by the light the piece was in (a dazzle in the sun
     and next to nothing at night), then in as light, which the tone curve flattened in the sun */
  vec3 g = vG.z > 0.5 ? glintAt(vG.xy, uClock) : vec3(0.0);
#ifndef LDR
  if (vG.z > 0.5) col = glintOver(col, g, max(texture(uExpoTex, vec2(0.5)).r, 0.02));
#endif
#endif
#ifdef LDR
  col = finishLDR(col, vWorld);
#ifdef ARMOR
  col = min(col + g, vec3(1.0));
#endif
#endif
  outColor = vec4(col, 1.0);
}`;
/* The armour in Fast graphics: as the skin there (render/vanilla.js
   AVATAR_FS), cut out, dyed, and the glint added on top unlit, as the
   game does it. */
const ARMOR_FS_VANILLA = /* glsl */`
uniform sampler2D uSkin, uNoise;
uniform vec3 cameraPosition;
uniform vec2 uLightLv;
uniform float uClock;
in vec3 vWorld; in vec3 vN; in vec2 vUv; flat in int vLayer; in vec3 vTint; in vec3 vG; in vec2 vUv2;
layout(location = 0) out vec4 outColor;
` + GLINT + ARMOR_OVERLAY + `
void main() {
  vec4 t = armorColour(texture(uSkin, vUv));
  if (t.a < 0.1) discard;
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 c = t.rgb * entityShade(N) * lightmapAt(uLightLv.x, uLightLv.y);
  if (vG.z > 0.5) c += glintAt(vG.xy, uClock);
  outColor = vec4(linearFog(c, fogDistance(vWorld - cameraPosition)), 1.0);
}`;
// the model's vertex shader (with ARMOR, the armour's), for the figure in the inventory too (render/figure.js)
export { HEAD as AVATAR_HEAD, VS as AVATAR_VS };
// into the body's own small shadow map (render/shadows.js): the blocks' view, a small window, no squeeze
const SHADOW_VS = /* glsl */`
uniform mat4 uBodyMat;
uniform mat4 uParts[6];
uniform int uShow;
in vec3 position; in vec2 uv; in vec2 aPart;
out vec2 vUv; flat out int vLayer;
#ifdef ARMOR
uniform vec4 uPiece[5];
uniform vec2 uSheet;
#endif
void main() {
  int layer = int(aPart.y + 0.5);
#ifdef ARMOR
  vec4 pc = uPiece[layer];
  vLayer = 1; vUv = (uv + vec2(0.0, pc.x)) / uSheet;
  if (pc.y < 0.5) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
#else
  vLayer = layer; vUv = uv;
  if (((uShow >> layer) & 1) == 0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
#endif
  vec4 c = uBodyMat * (uParts[int(aPart.x + 0.5)] * vec4(position, 1.0));
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
  /* remote: another player on a server (net/players.js), drawn the same way but
     never the one the skin settings belong to, with no first-person arm and no
     body shadow (the small body map is only round you) */
  constructor(renderer, remote) {
    if (!remote) current = this;
    this.remote = !!remote;
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
    this.uShow = { value: remote ? 0x7f : settings.show | 1 };
    this.uLight = { value: new THREE.Vector2(1, 0) };
    this.uHurt = { value: 0 };
    const uni = Object.assign({}, U, { uSkin: { value: tex }, uParts: { value: this.parts }, uShow: this.uShow, uLightLv: this.uLight, uHurt: this.uHurt });
    // made again for each look, Shaders ON or OFF (render/looks.js)
    const definesFor = (o, armor) => Object.assign({ SHADOWS: o.shadows === undefined ? 2 : o.shadows }, o.ldr ? { LDR: 1 } : {}, lightDefines(o), armor ? { ARMOR: 1 } : {});
    const mk = (vs, fs, uniforms, extra, fsVanilla, armor) => renderer.looked(o => new THREE.RawShaderMaterial(Object.assign({
      glslVersion: THREE.GLSL3, vertexShader: HEAD + COMMON + vs,
      fragmentShader: o.vanilla ? HEAD + VANILLA + (fsVanilla || AVATAR_FS) : HEAD + COMMON + SHADOW + TONEMAP + fs,
      uniforms: renderer.withU(uniforms), defines: definesFor(o, armor), side: THREE.DoubleSide,
    }, extra || {})));
    this.mat = mk(VS, FS, uni);
    // the first-person arm: drawn by the hand's own camera, in front of the world (render/held.js)
    this.armMat = mk(VS, FS, Object.assign({}, uni, { uParts: { value: this.armParts }, uHurt: { value: 0 } }), { side: THREE.FrontSide });
    this.shadowMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: HEAD + SHADOW_VS, fragmentShader: HEAD + SHADOW_FS, uniforms: uni, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(buildGeometry(this.slim), this.mat);
    this.shadowMesh = new THREE.Mesh(this.mesh.geometry, this.shadowMat);
    // both arms: the right always, the left when it holds something
    this.arm = new THREE.Mesh(buildGeometry(this.slim, [2, 3]), this.armMat);
    // the armour: one more mesh on the same parts, its pieces switched on as they are worn
    const sheet = armorSheet();
    const atex = this.armorTex = new THREE.Texture(sheet.canvas);
    atex.magFilter = atex.minFilter = THREE.NearestFilter;
    atex.generateMipmaps = false; atex.flipY = false; atex.needsUpdate = true;
    this.armorV = sheet.version;
    this.uPiece = { value: [0, 1, 2, 3, 4].map(() => new THREE.Vector4()) };
    this.uTint = { value: [0, 1, 2, 3, 4].map(() => new THREE.Vector3(1, 1, 1)) };
    this.uTrim = { value: [0, 1, 2, 3, 4].map(() => new THREE.Vector4(-1, 1, 1, 1)) };
    const auni = Object.assign({}, uni, { uSkin: { value: atex }, uPiece: this.uPiece, uTint: this.uTint, uTrim: this.uTrim, uSheet: { value: new THREE.Vector2(SHEET_W, SHEET_H) } });
    this.armorMat = mk(VS, FS, auni, null, ARMOR_FS_VANILLA, true);
    this.armorShadowMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: HEAD + SHADOW_VS, fragmentShader: HEAD + SHADOW_FS, uniforms: auni, defines: { ARMOR: 1 }, side: THREE.DoubleSide,
    });
    const ageo = avatarArmorGeometry();
    this.armor = new THREE.Mesh(ageo, this.armorMat);
    this.armorShadow = new THREE.Mesh(ageo, this.armorShadowMat);
    this.wearing = false;
    // Glowing's outline and silhouette (set glowing to show them; invisible hides the body, as the game does)
    // the cape: its picture (64 x 32), its one matrix, a mesh drawn with the body's shader and a shadow
    this.capeCanvas = document.createElement('canvas');
    this.capeCanvas.width = 64; this.capeCanvas.height = 32;
    const ctex = this.capeTex = new THREE.Texture(this.capeCanvas);
    ctex.magFilter = ctex.minFilter = THREE.NearestFilter; ctex.generateMipmaps = false; ctex.flipY = false;
    this.capeParts = Array.from({ length: 6 }, () => new THREE.Matrix4());
    const cuni = Object.assign({}, uni, { uSkin: { value: ctex }, uParts: { value: this.capeParts }, uShow: { value: 1 } });
    this.capeMat = mk(VS, FS, cuni);
    this.capeShadowMat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: HEAD + SHADOW_VS, fragmentShader: HEAD + SHADOW_FS, uniforms: cuni, side: THREE.DoubleSide });
    const cgeo = capeGeometry();
    this.capeMesh = new THREE.Mesh(cgeo, this.capeMat);
    this.capeShadow = new THREE.Mesh(cgeo, this.capeShadowMat);
    this.capeOn = false;
    // a hat of Leonpixel's lobby (render/hats.js): its own picture, on the head's own matrix (the body's parts), drawn with the
    // body's shader and casting a shadow; in the hat layer whatever the skin's own Hat setting is
    this.hatCanvas = document.createElement('canvas');
    this.hatCanvas.width = this.hatCanvas.height = HAT_TEX;
    const htex = this.hatTex = new THREE.Texture(this.hatCanvas);
    htex.magFilter = htex.minFilter = THREE.NearestFilter; htex.generateMipmaps = false; htex.flipY = false;
    const huni = Object.assign({}, uni, { uSkin: { value: htex }, uShow: { value: 0x7f } });
    this.hatMat = mk(VS, FS, huni);
    this.hatShadowMat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: HEAD + SHADOW_VS, fragmentShader: HEAD + SHADOW_FS, uniforms: huni, side: THREE.DoubleSide });
    this.hatMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.hatMat);
    this.hatShadow = new THREE.Mesh(this.hatMesh.geometry, this.hatShadowMat);
    this.hatOn = false;
    // where the cape's free end is (the game's xCloak: it chases the player a quarter of the way each tick), the bob and walk
    this.cloak = new THREE.Vector3(); this.cloakO = new THREE.Vector3(); this.cloakSet = false;
    this.bob = 0; this.oBob = 0; this.walkDist = 0; this.walkDistO = 0;
    this.tA = new THREE.Matrix4(); this.tB = new THREE.Matrix4();
    this.uGlow = { value: new THREE.Vector4(1, 1, 1, 1) };
    const gmat = extra => new THREE.RawShaderMaterial(Object.assign({ glslVersion: THREE.GLSL3, vertexShader: HEAD + GLOW_VS, fragmentShader: HEAD + GLOW_FS,
      uniforms: { uParts: { value: this.parts }, uGlow: this.uGlow }, side: THREE.FrontSide, depthTest: false, depthWrite: false, transparent: true, stencilWrite: true }, extra));
    // the mark first, then the outline (each avatar its own pair, so one's mark never hides another's outline)
    this.glowBehind = new THREE.Mesh(buildGeometry(this.slim, null, GLOW_MASK), gmat({ colorWrite: false, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp }));
    this.glowRim = new THREE.Mesh(buildGeometry(this.slim, null, GLOW_GROW), gmat({ stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc, stencilWriteMask: 0, stencilZPass: THREE.KeepStencilOp }));
    this.glowBehind.renderOrder = 100000 + glowSeq; this.glowRim.renderOrder = 100001 + glowSeq; glowSeq = (glowSeq + 2) % 100000;
    this.glowBehind.onBeforeRender = r => {
      const S = r.state.buffers.stencil; S.setMask(0xff); r.clearStencil();
      const t = r.getRenderTarget(), lit = t && !t.stencilBuffer;
      // (the full chain's colours go through the eye and the tone curve after: white there comes out grey, so it is sent brighter)
      this.uGlow.value.set(lit ? 3 : 1, lit ? 3 : 1, lit ? 3 : 1, lit ? 0.7 : 1);
    };
    this.glowing = false; this.invisible = false;
    for (const m of [this.mesh, this.shadowMesh, this.arm, this.armor, this.armorShadow, this.glowRim, this.glowBehind, this.capeMesh, this.capeShadow, this.hatMesh, this.hatShadow]) { m.frustumCulled = false; m.matrixAutoUpdate = false; m.visible = false; }
    renderer.scene.add(this.mesh);
    renderer.scene.add(this.armor);
    renderer.scene.add(this.glowRim); renderer.scene.add(this.glowBehind); renderer.scene.add(this.capeMesh); renderer.scene.add(this.hatMesh);
    // (only drawn while there are shadows: render/shadows.js; another player's model has no first-person arm)
    if (!remote) { renderer.shadowScene.add(this.shadowMesh); renderer.shadowScene.add(this.armorShadow); renderer.shadowScene.add(this.capeShadow); renderer.shadowScene.add(this.hatShadow); renderer.handScene.add(this.arm); }
    // what is in each hand (0 main, 1 off), in the model's hand in third person
    this.held = [null, null];
    this.heldGlint = [false, false];
    // your own cape, as you left it
    if (!remote && settings.cape && settings.capeShown !== false) this.setCape(settings.cape);
    this.heldRot = new THREE.Matrix3();
    // pose state, per tick (o... is the tick before)
    this.started = false;
    this.speed = 0; this.oSpeed = 0; this.limb = 0;
    this.body = 0; this.oBody = 0;
    this.swinging = false; this.swingT = 0; this.attack = 0; this.oAttack = 0;
    this.swim = 0; this.oSwim = 0; this.glide = 0;
    this.age = 0; this.acc = 0;
    this.pose = REST.map(() => ({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }));
    this.cur = { attack: 0 };
    // light around the player, and the chunks near it (so looking blocks up allocates nothing)
    this.lightT = 0; this.skyLv = 15; this.blockLv = 0; this.sky = 1; this.block = 0;
    this.cache = new Array(9).fill(null); this.cacheX = 1e9; this.cacheZ = 1e9; this.world = null;
    // scratch
    this.m = new THREE.Matrix4(); this.t = new THREE.Matrix4(); this.root = new THREE.Matrix4();
    this.e = new THREE.Euler(); this.handPos = new THREE.Vector3(); this.vs = new THREE.Vector3(MODEL_SCALE, MODEL_SCALE, MODEL_SCALE); this.size = 1; this.sizeV = new THREE.Vector3(1, 1, 1);
    if (remote) this.setSkin(defaultSkin, false).catch(() => {});
    else this.setSkin(settings.skin || defaultSkin, settings.slim === null ? undefined : settings.slim).catch(() => this.setSkin(defaultSkin, false));
  }

  /* ---- skins ----
     urlOrImage: a URL (data: and blob: too), an Image, an ImageBitmap or a canvas.
     slim: true for 3 pixel arms, false for 4, left out to tell from the skin. */
  // a lobby hat (net/cosdata.js HATS entry), or null for none
  setHat(def) {
    if (!def) { this.hatOn = false; this.hatDef = null; return; }
    if (def === this.hatDef) { this.hatOn = true; return; }
    const old = this.hatMesh.geometry, { geometry, paint } = hatParts(def);
    paint(this.hatCanvas.getContext('2d'));
    this.hatTex.needsUpdate = true;
    this.hatMesh.geometry = geometry; this.hatShadow.geometry = geometry;
    old.dispose();
    this.hatDef = def; this.hatOn = true;
  }
  async setCape(url) {
    if (!url) { this.capeOn = false; return; }
    let img;
    try { img = await loadImage(url); } catch (e) { this.capeOn = false; return; }
    const g = this.capeCanvas.getContext('2d');
    g.clearRect(0, 0, 64, 32);
    g.imageSmoothingEnabled = false;
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (w * 17 === h * 22) g.drawImage(img, 0, 0, 22, 17);       // only the cape's own corner, in its own size
    else g.drawImage(img, 0, 0, 64, 32);
    this.capeTex.needsUpdate = true;
    this.capeOn = true;
  }
  async setSkin(urlOrImage, slim) {
    // a later call wins: the default a model starts with must not land over a skin asked for after it
    const n = this.skinGen = (this.skinGen | 0) + 1;
    const img = typeof urlOrImage === 'string' ? await loadImage(urlOrImage) : urlOrImage;
    if (n !== this.skinGen) return;
    drawSkin(this.canvas, img);
    const s = slim === undefined || slim === null ? looksSlim(this.canvas) : !!slim;
    if (s !== this.slim) {
      this.slim = s;
      const old = this.mesh.geometry, oldArm = this.arm.geometry;
      this.mesh.geometry = this.shadowMesh.geometry = buildGeometry(s);
      this.arm.geometry = buildGeometry(s, [2, 3]);
      const oldGlow = [this.glowRim.geometry, this.glowBehind.geometry];
      this.glowRim.geometry = buildGeometry(s, null, GLOW_GROW); this.glowBehind.geometry = buildGeometry(s, null, GLOW_MASK);
      old.dispose(); oldArm.dispose(); for (const g of oldGlow) g.dispose();
    }
    this.tex.needsUpdate = true;
    this.ready = true;
    if (this.remote) return;
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

  /* ---- what is in a hand (0 main, 1 off), for third person: the block or
     the item picture as in first person, with its own light attribute so
     it darkens in a cave ---- */
  setHeld(side, d) {
    const R = this.R, old = this.held[side];
    if (old) { R.scene.remove(old.mesh); old.mesh.geometry.dispose(); this.held[side] = null; }
    if (!d || !d.faces) return;
    const { geometry: g, cutout } = heldGeometry(d);
    const m = new THREE.Mesh(g, cutout ? R.mats.cutout : R.mats.opaque);
    m.frustumCulled = false; m.matrixAutoUpdate = false; m.visible = false;
    this.held[side] = { mesh: m, kind: heldKind(d), light: -1 };
    // the shader's face frames turn with the block (as the hand in first person does)
    const U = R.U, rot = this.heldRot;
    m.onBeforeRender = () => { rot.setFromMatrix4(m.matrixWorld); rot.multiplyScalar(1 / m.matrixWorld.getMaxScaleOnAxis()); U.uFaceRot.value.copy(rot); m.material.uniformsNeedUpdate = true; };
    m.onAfterRender = () => { U.uFaceRot.value.identity(); m.material.uniformsNeedUpdate = true; };
    R.scene.add(m);
    setGlint(m, this.heldGlint[side], R);
  }
  // whether what a hand holds shimmers (enchanted)
  glintHeld(side, on) {
    if (this.heldGlint[side] === on) return;
    this.heldGlint[side] = on;
    if (this.held[side]) setGlint(this.held[side].mesh, on, this.R);
  }

  /* ---- what is worn: the four armour stacks, helmet to boots ---- */
  setArmor(stacks) {
    let any = false;
    for (let i = 0; i < 4; i++) {
      const look = pieceLook(stacks && stacks[i]), p = this.uPiece.value[i], tr = look && look.trim;
      this.uTrim.value[i].set(tr ? tr.row * 64 : -1, tr ? ((tr.colour >> 16) & 255) / 255 : 1, tr ? ((tr.colour >> 8) & 255) / 255 : 1, tr ? (tr.colour & 255) / 255 : 1);
      if (!look) { p.set(0, 0, 0, 0); continue; }
      any = true;
      p.set(look.row * 64, 1, look.glint ? 1 : 0, look.overlay >= 0 ? look.overlay * 64 : -1);
      const c = look.tint;
      this.uTint.value[i].set(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255);
    }
    // an elytra in the chest slot: its wings on the back
    const el = elytraLook(stacks && stacks[1]);
    this.uPiece.value[4].set(el ? el.row * 64 : 0, el ? 1 : 0, el && el.glint ? 1 : 0, -1);
    this.wearing = any || !!el;
    this.headWorn = this.uPiece.value[0].y > 0;
  }
  /* ---- on the head but not armour: a carved pumpkin, a mob head, any
     block (renderer.js gives its draw data, or null). The game's head layer:
     a block 10 pixels a side about the middle of the head (0.625 of a
     block); a mob head 1.1875 times its size, standing on the neck. ---- */
  setHeadItem(d) {
    const R = this.R, old = this.headItem;
    if (old) { R.scene.remove(old.mesh); old.mesh.geometry.dispose(); this.headItem = null; }
    if (!d || !d.faces || isFlatItem(d)) return;
    const { geometry: g, cutout } = blockGeometry(d, 0);
    const m = new THREE.Mesh(g, cutout ? R.mats.cutout : R.mats.opaque);
    m.frustumCulled = false; m.matrixAutoUpdate = false; m.visible = false;
    const U = R.U, rot = this.heldRot;
    m.onBeforeRender = () => { rot.setFromMatrix4(m.matrixWorld); rot.multiplyScalar(1 / m.matrixWorld.getMaxScaleOnAxis()); U.uFaceRot.value.copy(rot); m.material.uniformsNeedUpdate = true; };
    m.onAfterRender = () => { U.uFaceRot.value.identity(); m.material.uniformsNeedUpdate = true; };
    this.headItem = { mesh: m, skull: d.shape === 'head', light: -1 };
    R.scene.add(m);
  }
  // where the head item goes, from the parts' matrices into m (held.js placeOnHead)
  placeHead(skull, parts, m) { return placeOnHead(m, parts[0], skull, this.t); }

  startSwing(ago) {
    // as the game: a click in the second half of a swing starts it again
    if (!this.swinging || this.swingT >= 3 || this.swingT < 0) {
      this.swingT = -1; this.swinging = true;
      /* a click (interact.js) swings from the moment it happened, `ago` ticks before this frame, so
         the arm is already moving in the first frame after it: the swing's clock is set back by that
         much, as if it had begun then (the game shows a click's swing only from the tick after next) */
      if (ago !== undefined) { const s = this.alpha - Math.max(0, Math.min(1, ago)); this.oAttack = -s / 6; this.swingT = 1 - s; this.attack = this.swingT / 6; }
    }
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
    // in a boat the body faces the way the boat does (the head turns up to 105 degrees from it)
    if (P.riding && P.riding.constructor.RIDER_BODY) this.body = P.riding.yaw;
    // the arm swing: 6 ticks
    this.oAttack = this.attack;
    if (this.swinging) { if (++this.swingT >= 6) { this.swingT = 0; this.swinging = false; } } else this.swingT = 0;
    this.attack = this.swingT / 6;
    // swimming (and crawling) lays the body down; gliding on an elytra is a pose of its own, counted in ticks
    this.oSwim = this.swim;
    const sw = P.pose === 'swim' && !P.flying && !P.gliding ? 1 : 0;
    this.swim = sw > this.swim ? Math.min(1, this.swim + 0.09) : Math.max(0, this.swim - 0.09);
    this.glide = P.gliding ? this.glide + 1 : 0;
    this.spin = P.spinning && !P.gliding ? (this.spin || 0) + 1 : 0;
    this.wingTick(P);
    // the cape's free end chases where you are, a quarter of the way a tick (straight there after a jump of over 10)
    this.cloakO.copy(this.cloak);
    if (!this.cloakSet) { this.cloak.copy(P.pos); this.cloakO.copy(P.pos); this.cloakSet = true; }
    for (const k of ['x', 'y', 'z']) {
      const d = P.pos[k] - this.cloak[k];
      if (Math.abs(d) > 10) { this.cloak[k] = P.pos[k]; this.cloakO[k] = P.pos[k]; }
      else this.cloak[k] += d * 0.25;
    }
    this.oBob = this.bob;
    this.bob += ((P.onGround && P.pose !== 'swim' && !(P.dying > 0) ? Math.min(0.1, Math.sqrt(d2)) : 0) - this.bob) * 0.4;
    this.walkDistO = this.walkDist; this.walkDist += Math.sqrt(d2) * 0.6;
    this.age++;
  }

  /* The elytra's wings, as the game's ElytraModel works them out: folded
     (15 degrees back, 15 out) standing; gliding, spread 20 degrees back and
     90 out, folding back in as the dive steepens (by 1 - (down share of the
     velocity)^1.5); crouching, 40 back, 45 out, 5 degrees round and 3 pixels
     lower. Eased 0.3 of the way a tick (our reading of the 26.x elytra
     animation state; the older game eased 0.1 a frame). Remote players get
     this too, since their gliding and sneaking come in the position flags. */
  wingTick(P) {
    let x = 0.2617994, z = -0.2617994, y = 0, ry = 0;
    if (P.gliding) {
      const v = P.vel; let f = 1;
      if (v.y < 0) { const l = Math.hypot(v.x, v.y, v.z); if (l > 1e-9) f = 1 - Math.pow(-v.y / l, 1.5); }
      x = f * 0.34906584 + (1 - f) * x;
      z = f * -PI / 2 + (1 - f) * z;
    } else if (P.sneaking && !P.flying) { x = 0.6981317; z = -0.7853982; y = 3; ry = 0.08726646; }
    const W = this.wing || (this.wing = { x: 0.2617994, z: -0.2617994, ry: 0, y: 0, ox: 0.2617994, oz: -0.2617994, ory: 0, oy: 0 });
    W.ox = W.x; W.oz = W.z; W.ory = W.ry; W.oy = W.y;
    W.x += (x - W.x) * 0.3; W.z += (z - W.z) * 0.3; W.ry += (ry - W.ry) * 0.3; W.y = y;
  }
  wingPose(a) {
    const W = this.wing;
    if (!W || this.uPiece.value[4].y <= 0) return;
    const x = W.ox + (W.x - W.ox) * a, z = W.oz + (W.z - W.oz) * a, ry = W.ory + (W.ry - W.ory) * a;
    if (this.wingSet && Math.abs(this.wingSet[0] - x) + Math.abs(this.wingSet[1] - z) + Math.abs(this.wingSet[2] - ry) + Math.abs(this.wingSet[3] - W.y) < 1e-4) return;
    this.wingSet = [x, z, ry, W.y];
    poseWings(this.armor.geometry, x, ry, z, W.y);
  }

  /* Riptide's swirl round a spinning player: our own drawing of the game's
     spin attack layer, two open wind sleeves round the body's axis (the
     inner one smaller), turning the other way at different speeds; seen in
     third person and on other players. */
  placeSwirl(root, a) {
    const on = this.spin > 0 && this.view !== 0 && this.ready;
    if (!on) { if (this.swirl) this.swirl.visible = false; return; }
    if (!this.swirl) this.swirl = makeSwirl(this.R);
    const S = this.swirl, t = this.t, age = this.age + a;
    S.visible = true;
    for (let i = 0; i < 2; i++) {
      const c = S.children[i];
      c.matrix.copy(root).multiply(t.makeTranslation(0, 0.9 - i * 0.1, 0)).multiply(t.makeRotationY(age * (55 + i * 10) * DEG * (i ? 1 : -1)));
      c.matrixWorldNeedsUpdate = true;
    }
  }
  dropSwirl() {
    const S = this.swirl;
    if (!S) return;
    if (S.parent) S.parent.remove(S);
    S.children[0].geometry.dispose(); S.children[1].geometry.dispose(); S.children[0].material.map.dispose(); S.children[0].material.dispose();
    this.swirl = null;
  }

  /* ---- every frame: ticks since the last one, light, pose, camera ---- */
  update(state, dt, cam) {
    const P = state.player, R = this.R;
    this.uHurt.value = state.hurt ? 1 : 0;
    // what the use button is doing with your hands, for the poses (hands.js handBob)
    this.useNow = state.bob && state.bob.use || null;
    // a swing from a click is set going after this frame's ticks, below; any other one now, so a tick takes it up
    let ago;
    if (R.swing >= 1) {
      if (R.swingAt !== undefined) ago = (performance.now() - R.swingAt) / 50; else this.startSwing();
      R.swingAt = undefined; R.swing = 0.999;
    }
    if (!P) {
      this.mesh.visible = this.shadowMesh.visible = this.armor.visible = this.armorShadow.visible = false;
      this.hatMesh.visible = this.hatShadow.visible = false;
      for (const h of this.held) if (h) h.mesh.visible = false;
      if (this.headItem) this.headItem.mesh.visible = false;
      return;
    }
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
    if (ago !== undefined) { this.alpha = al; this.startSwing(ago); }
    const feet = state.feet || P.pos;
    // the light around you, a few times a second, eased so it never pops
    this.lightT -= dt;
    if (this.lightT <= 0) { this.lightT = 0.25; this.refreshCache(feet.x, feet.z); this.sampleLight(feet); }
    const k = Math.min(1, dt * 6);
    this.sky += (this.skyLv / 15 - this.sky) * k; this.block += ((this.burning ? 15 : this.blockLv) / 15 - this.block) * k;
    this.uLight.value.set(this.sky, this.block);
    this.posed(P, al, feet);
    // (hidden: drawn as something else, a Prop Hunt disguise)
    const third = (this.view !== 0 || !!this.orbit) && this.ready && !this.hidden;
    // (invisible: only what you wear and hold shows, as in the game; on Leon Network not what you wear either)
    const armorShows = this.wearing && !(this.invisible && invisLook.hideArmor);
    this.mesh.visible = third && !this.invisible;
    this.shadowMesh.visible = this.ready && !this.invisible;
    this.glowRim.visible = this.glowBehind.visible = third && this.glowing;
    this.capeMesh.visible = this.capeShows(third);
    this.capeShadow.visible = this.capeShows(this.ready && !this.hidden);
    // the armour, its pictures taken up again whenever another file has landed in the sheet
    this.armor.visible = third && armorShows;
    this.armorShadow.visible = this.ready && armorShows;
    if (this.wearing) { const sh = armorSheet(); if (sh.version !== this.armorV) { this.armorV = sh.version; this.armorTex.needsUpdate = true; } this.wingPose(al); }
    const lv = (Math.round(this.sky * 255) << 8) | Math.round(this.block * 255);
    for (const h of this.held) {
      if (!h) continue;
      h.mesh.visible = third;
      if (third && lv !== h.light) { h.light = lv; setLight(h.mesh.geometry, lv); }
    }
    // in third person the light in your hand is where the model's hand is (the renderer reads state.handPos)
    if (third && !state.handPos) state.handPos = this.handPos.set(-1, -10, 0).applyMatrix4(this.parts[2]);
    if ((this.view || this.orbit) && cam) this.placeCamera(cam, state);
    // a camera pulled right in to the head (a wall just behind you) would see the inside of the helmet: it is left off then
    const close = this.view !== 0 && cam && cam.position.distanceToSquared(state.eye) < 0.36;
    this.uPiece.value[0].y = this.headWorn && !close ? 1 : 0;
    this.hatMesh.visible = third && this.hatOn && !this.invisible && !close;
    this.hatShadow.visible = this.ready && this.hatOn && !this.invisible && !this.hidden;
    const hi = this.headItem;
    if (hi) {
      hi.mesh.visible = third && !close;
      if (hi.mesh.visible && lv !== hi.light) { hi.light = lv; setLight(hi.mesh.geometry, lv); }
    }
  }

  /* the pose for this frame, then the matrices: at the feet, turned with the
     body, lowered when sneaking, laid down when swimming */
  posed(P, a, feet) {
    const bodyYaw = this.oBody + wrap(this.body - this.oBody) * a;
    this.poseFor(P, a, P.pitch, wrap(P.yaw - bodyYaw));
    const root = this.root, t = this.t;
    root.makeRotationY(bodyYaw + PI);
    root.setPosition(feet.x, feet.y - (this.cur.sneak ? 0.125 : 0), feet.z);
    this.layDown(root, P, a, P.pitch);
    if (this.glide > 0) {
      // and rolled into a turn, by the angle between where you look and where you fly
      const v = P.vel, lx = -Math.sin(P.yaw), lz = -Math.cos(P.yaw), d0 = v.x * v.x + v.z * v.z;
      if (d0 > 1e-8) {
        const c = (v.x * lx + v.z * lz) / Math.sqrt(d0), s = v.x * lz - v.z * lx;
        root.multiply(t.makeRotationY(Math.sign(s) * Math.acos(Math.max(-1, Math.min(1, c)))));
      }
    }
    this.placeSwirl(root, a);
    root.scale(this.vs);
    // (a smaller or bigger player: Leon Network's Chameleon plays at half size)
    if (this.size && this.size !== 1) root.scale(this.sizeV.set(this.size, this.size, this.size));
    this.matrices(root, this.parts);
    if (this.capeOn) this.placeCape(root, a, feet, bodyYaw);
    for (let side = 0; side < 2; side++) {
      const h = this.held[side];
      if (!h) continue;
      this.placeHeld(side, this.heldKindNow(side), this.parts, h.mesh.matrix);
      h.mesh.matrixWorldNeedsUpdate = true;
    }
    if (this.headItem) { this.placeHead(this.headItem.skull, this.parts, this.headItem.mesh.matrix); this.headItem.mesh.matrixWorldNeedsUpdate = true; }
  }

  /* Swimming, crawling and gliding lay the model down about its feet, as the
     game's renderer does: swimming along the look (pitch, up positive),
     crawling flat, then moved back a block and up 0.3 so it lies along its
     0.6 high box; gliding tips over along the look over its first ten ticks.
     Used by the figure in the inventory too, with the mouse's look. */
  layDown(root, P, a, pitch) {
    const t = this.t, swim = this.cur.swim;
    /* Riptide's spin: laid along the look at once and turning about it 75 degrees a tick, as the
       game's player renderer does with an auto spin attack */
    if (this.spin > 0) root.multiply(t.makeRotationX(PI / 2 - pitch)).multiply(t.makeRotationY(-(this.age + a) * 75 * DEG));
    else if (this.glide > 0) root.multiply(t.makeRotationX(Math.min(1, (this.glide + a) ** 2 / 100) * (PI / 2 - pitch)));
    else if (swim > 0) {
      root.multiply(t.makeRotationX(swim * (P.inWater ? PI / 2 - pitch : PI / 2)));
      if (P.pose === 'swim') root.multiply(t.makeTranslation(0, -1, -0.3));
    }
  }

  /* The parts' turns and places, in the game's model space (y down, -z
     forward), for a look: pitch (up positive) and the head's turn from the
     body. Also used for the figure in the inventory (render/figure.js), which
     looks at the mouse instead. */
  poseFor(P, a, pitch, headYaw) {
    const S = this.pose;
    for (let i = 0; i < 6; i++) { const p = S[i], r = REST[i]; p.x = r[0]; p.y = r[1]; p.z = r[2]; p.rx = p.ry = p.rz = 0; }
    if (this.slim) S[2].y = S[3].y = 2.5;
    const head = S[0], body = S[1], armR = S[2], armL = S[3], legR = S[4], legL = S[5];
    // sitting on something, the legs do not walk however fast it goes
    const amt = P.riding ? 0 : Math.min(1, this.oSpeed + (this.speed - this.oSpeed) * a);
    const ls = this.limb - this.speed * (1 - a);
    const age = this.age + a;
    let att = this.attack - this.oAttack;
    if (att < 0) att += 1;
    att = this.swinging || this.oAttack > 0 ? this.oAttack + att * a : 0;
    this.cur.attack = att;
    const swim = this.cur.swim = this.oSwim + (this.swim - this.oSwim) * a;
    const sneak = this.cur.sneak = P.sneaking && !P.flying && swim === 0;

    // gliding: the head looks ahead along the body once it has tipped over, and the faster you fly
    // the stiller the limbs hang (the game divides their swing by (speed squared / 0.2) cubed, at least 1)
    let stiff = 1;
    if (this.glide > 0) { const v = P.vel, f = (v.x * v.x + v.y * v.y + v.z * v.z) / 0.2; stiff = Math.max(1, f * f * f); }
    head.rx = this.glide > 4 ? -PI / 4 : -pitch;
    head.ry = -headYaw;
    // walking: opposite arm and leg together
    const c = Math.cos(ls * 0.6662);
    armR.rx = -c * amt / stiff; armL.rx = c * amt / stiff;
    legR.rx = c * 1.4 * amt / stiff; legL.rx = -c * 1.4 * amt / stiff;
    // riding (a boat, a horse: js/entities): sitting, legs forward and a little apart, arms forward a little
    if (P.riding) {
      armR.rx -= PI / 5; armL.rx -= PI / 5;
      legR.rx = -1.4137167; legR.ry = PI / 10; legR.rz = 0.07853982;
      legL.rx = -1.4137167; legL.ry = -PI / 10; legL.rz = -0.07853982;
    }
    // holding something: the arm comes up a little
    if (this.held[0]) armR.rx = armR.rx * 0.5 - PI / 10;
    if (this.held[1]) armL.rx = armL.rx * 0.5 - PI / 10;
    /* what the use button is doing (state.bob.use): a bow drawn or a loaded
       crossbow aimed with both arms out where the head looks, the other arm
       across to the string; a crossbow loading held forward and down while
       the other hand pulls; a shield arm up across the chest; a trident arm
       raised over the head to throw */
    const use = this.useNow;
    let still = false;
    if (use) {
      const s = use.side ? -1 : 1, main = use.side ? armL : armR, other = use.side ? armR : armL;
      if (use.kind === 'bow' || use.kind === 'aim') {
        const across = use.kind === 'aim' ? 0.6 : 0.5;
        main.rx = other.rx = -PI / 2 + head.rx;
        main.ry = -0.1 * s + head.ry; other.ry = (across - 0.1) * s + head.ry;
        if (use.kind === 'aim') { main.ry = -0.3 * s + head.ry; main.rx -= 0.05; other.rx -= 0.1; }
        still = true;
      } else if (use.kind === 'crossbow') {
        const p = Math.min(1, use.t / use.total);
        main.rx = -0.97; main.ry = -0.4 * s;
        other.rx = mix(-0.97, -0.6, p); other.ry = mix(0.4, 0.85, p) * s;
        still = true;
      } else if (use.kind === 'block') {
        main.rx = main.rx * 0.5 - 0.94; main.ry = -PI / 6 * s;
      } else if (use.kind === 'trident') {
        main.rx = main.rx * 0.5 - PI; main.ry = 0;
      } else if (use.kind === 'spear') {
        // a spear charged: the arm out along the look, the spear level under it
        main.rx = head.rx - PI / 2 + 0.2; main.ry = head.ry - 0.1 * s;
      } else if (use.kind === 'horn') {
        // a goat horn to the mouth: the head's pitch (kept within 1.2) less 85 degrees, turned 30 in
        main.rx = Math.max(-1.2, Math.min(1.2, head.rx)) - 1.4835298; main.ry = head.ry - PI / 6 * s;
      } else if (use.kind === 'spyglass') {
        // a spyglass to the eye: the head's pitch less 110 degrees (15 more crouching), turned 15 in
        main.rx = Math.max(-2.4, Math.min(3.3, head.rx - 1.9198622 - (P.sneaking && !P.flying ? 0.2617994 : 0))); main.ry = head.ry - 0.2617994 * s;
      }
    }
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
    // sneaking: lean in, legs back, everything lower
    if (sneak) {
      body.rx = 0.5; body.y = 3.2;
      armR.rx += 0.4; armL.rx += 0.4; armR.y += 3.2; armL.y += 3.2;
      legR.z = legL.z = 4; legR.y = legL.y = 12.2;
      head.y = 4.2;
    }
    // the arms' idle sway (not while aiming)
    if (!still) {
      const sz = Math.cos(age * 0.09) * 0.05 + 0.05, sx = Math.sin(age * 0.067) * 0.05;
      armR.rz += sz; armL.rz -= sz; armR.rx += sx; armL.rx -= sx;
    }
    // swimming: arms reach past the head and pull back, legs flutter, the head looks ahead
    if (swim > 0) {
      const st = 0.5 + 0.5 * Math.cos(ls * 0.22);
      armR.rx = mix(armR.rx, -PI * st, swim); armL.rx = mix(armL.rx, -PI * st, swim);
      armR.rz = mix(armR.rz, 0.5 * Math.sin(st * PI), swim); armL.rz = mix(armL.rz, -0.5 * Math.sin(st * PI), swim);
      legR.rx = mix(legR.rx, 0.3 * Math.cos(ls * 0.333), swim); legL.rx = mix(legL.rx, -0.3 * Math.cos(ls * 0.333), swim);
      head.rx = mix(head.rx, -PI / 4, swim);
    }
    // a pose of a minigame's over the walk (Leon Network's Chameleon: a hider's pose, a seeker aiming)
    if (this.poseOverride) this.poseOverride(S, sneak);
  }
  // the parts' matrices from the pose, under a root (the model's own space to the world's)
  /* The game's cape layer: 2 pixels behind the neck (1.1 more and 0.85 up over a chestplate), lifted 6 degrees, then
     more the faster its free end trails behind (up to 150 / 2), up and down with your vertical speed and the walk's
     bob, 25 more sneaking, and swung sideways (up to 20 / 2) as you turn or strafe. */
  placeCape(root, a, feet, bodyYaw) {
    const c = this.cloak, o = this.cloakO, S = this.pose[1];
    const d0 = o.x + (c.x - o.x) * a - feet.x, d1 = o.y + (c.y - o.y) * a - feet.y, d2 = o.z + (c.z - o.z) * a - feet.z;
    const sb = Math.sin(bodyYaw), cb = Math.cos(bodyYaw);
    let f1 = Math.max(-6, Math.min(32, d1 * 10));
    const f2 = Math.max(0, Math.min(150, (d0 * sb + d2 * cb) * 100));
    const f3 = Math.max(-20, Math.min(20, (d0 * cb - d2 * sb) * 100));
    const bob = this.oBob + (this.bob - this.oBob) * a, walk = this.walkDistO + (this.walkDist - this.walkDistO) * a;
    f1 += Math.sin(walk * 6) * 32 * bob;
    if (this.cur.sneak) f1 += 25;
    const chest = this.uPiece.value[1].y > 0.5;
    const m = this.capeParts[0];
    m.makeTranslation(S.x, 24 - S.y + (chest ? 0.85 : 0), -S.z - 2 - (chest ? 1.1 : 0));
    m.multiply(this.tA.makeRotationX((6 + f2 / 2 + f1) * DEG));
    m.multiply(this.tA.makeRotationZ(-(f3 / 2) * DEG));
    m.multiply(this.tA.makeRotationY((f3 / 2 - 180) * DEG));
    m.premultiply(root);
  }
  // shown in third person with a cape on, not while invisible, hidden (a disguise) or wearing an elytra (as in the game)
  capeShows(third) { return third && this.capeOn && !this.invisible && !capeRule.off && this.uPiece.value[4].y < 0.5; }
  matrices(root, out) {
    const S = this.pose;
    for (let i = 0; i < 6; i++) {
      const p = S[i], m = out[i];
      // the game's model space to this one: y and z flip, so do the y and z turns
      m.makeRotationFromEuler(this.e.set(p.rx, -p.ry, -p.rz, 'ZYX'));
      m.setPosition(p.x, 24 - p.y, -p.z);
      m.premultiply(root);
    }
  }

  /* what is in a hand, in the model's hand: the game's third-person item
     placing (at the hand, turned down the arm, then the item model's own
     third-person turn: 75 and 45 degrees and 0.375 of a block for a block, a
     tool leaning forward, a flat item upright), from the parts' matrices into m */
  // a shield up to block, and a trident raised to throw, have places of their own
  heldKindNow(side) {
    const h = this.held[side], u = this.useNow;
    if (!u || (u.side | 0) !== side) return h.kind;
    if (h.kind === 'shield' && u.kind === 'block') return 'shieldBlock';
    if (h.kind === 'trident' && u.kind === 'trident') return 'tridentThrow';
    return h.kind;
  }
  placeHeld(side, kind, parts, m) {
    // a slim arm's hand is half a pixel further in, as the game holds it
    return placeInHand(m, parts[2 + side], side, kind, this.slim ? 0.5 : 0, this.t, this.e);
  }

  /* ---- the first-person arms: the game's arm placing in front of the
     camera, with its swing. side 0 is the right arm, 1 the left (the game's
     placing mirrored); sp the swing (0..1), (bx, by) the bob, eq how far the
     hand has dropped out of sight (0 up, 1 gone). camM null is the camera's
     own space. ---- */
  armMatrix(m, camM, side, sp, bx, by, eq) {
    const f = side ? -1 : 1, sq = Math.sqrt(sp), t = this.t;
    if (camM) m.copy(camM); else m.identity();
    m.multiply(t.makeTranslation(f * (0.64 - 0.3 * Math.sin(sq * PI)) + bx, -0.6 + 0.4 * Math.sin(sq * 2 * PI) - 0.6 * eq + by, -0.72 - 0.4 * Math.sin(sp * PI)));
    m.multiply(t.makeRotationY(f * (45 * DEG + Math.sin(sq * PI) * 70 * DEG)));
    m.multiply(t.makeRotationZ(f * Math.sin(sp * sp * PI) * -20 * DEG));
    m.multiply(t.makeTranslation(f * -1, 3.6, 3.5));
    m.multiply(t.makeRotationZ(f * 120 * DEG));
    m.multiply(t.makeRotationX(200 * DEG));
    m.multiply(t.makeRotationY(f * -135 * DEG));
    m.multiply(t.makeTranslation(f * 5.6, 0, 0));
    // the arm at its shoulder, in the game's model space (pixels, y down)
    m.multiply(t.makeTranslation(f * -5 / 16, (this.slim ? 2.5 : 2) / 16, 0));
    m.multiply(t.makeRotationZ(f * 0.1));
    m.multiply(t.makeScale(1 / 16, -1 / 16, -1 / 16));
    return m;
  }
  /* both arms for this frame, from their places in the camera's space
     (render/held.js works them out, the items with them); the left one is
     drawn only when it holds something */
  setArms(camW, armR, armL, right, left) {
    const R = this.armParts[2], L = this.armParts[3];
    R.multiplyMatrices(camW, armR);
    L.multiplyMatrices(camW, armL);
    this.arm.visible = (right || left) && this.ready && this.started;
    // an arm with nothing to do is squeezed to nothing (only ever the empty left one)
    if (!left) L.makeScale(0, 0, 0);
    if (!right) R.makeScale(0, 0, 0);
  }

  /* ---- third person: 4 blocks back along the look (or in front, looking
     back), pulled in by eight rays from just around the eye ---- */
  placeCamera(cam, state) {
    const e = state.eye;
    // painting yourself (Leon Network's Chameleon, ui/paint.js): the camera swings round your middle at orbit's yaw, pitch and
    // distance, straight through whatever is in the way, as the first Leoncraft's Mecha has it (a hider paints against a
    // wall: stopped by it, the camera sat on the wall and the wheel did nothing until you turned away)
    if (this.orbit) {
      const O = this.orbit, k = this.size || 1, cx = e.x, cy = e.y - 0.72 * k, cz = e.z, cp = Math.cos(O.pitch);
      const fx = Math.sin(O.yaw) * cp, fy = Math.sin(O.pitch), fz = Math.cos(O.yaw) * cp;
      const d = O.dist * k;
      cam.position.set(cx + fx * d, cy + fy * d, cz + fz * d);
      cam.rotation.set(-O.pitch, O.yaw, 0, 'YXZ');
      return;
    }
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
  /* the skin pixel a ray (world space) meets on your body, nearest first: { tx, ty, rect [x, y, w, h], part, t },
     or null. The base layer's boxes, through each part's matrix as the model was last drawn. */
  skinHit(o, d) {
    const inv = this._inv || (this._inv = new THREE.Matrix4()), a = this._ha || (this._ha = new THREE.Vector3()), b = this._hb || (this._hb = new THREE.Vector3());
    let best = null;
    for (const [part, layer, c, size, uv] of boxList(this.slim)) {
      if (layer !== 0) continue;
      inv.copy(this.parts[part]).invert();
      a.set(o.x, o.y, o.z).applyMatrix4(inv); b.set(o.x + d.x, o.y + d.y, o.z + d.z).applyMatrix4(inv).sub(a);
      const h = [size[0] / 2, size[1] / 2, size[2] / 2], lo = [c[0] - h[0], c[1] - h[1], c[2] - h[2]], hi = [c[0] + h[0], c[1] + h[1], c[2] + h[2]];
      const A = [a.x, a.y, a.z], D = [b.x, b.y, b.z];
      let t0 = -Infinity, t1 = Infinity, ax = -1, sg = 0;
      for (let i = 0; i < 3; i++) {
        if (Math.abs(D[i]) < 1e-9) { if (A[i] < lo[i] || A[i] > hi[i]) { t0 = Infinity; break; } continue; }
        let u = (lo[i] - A[i]) / D[i], v = (hi[i] - A[i]) / D[i], s0 = -1;
        if (u > v) { const w = u; u = v; v = w; s0 = 1; }
        if (u > t0) { t0 = u; ax = i; sg = s0; }
        if (v < t1) t1 = v;
      }
      if (!(t0 <= t1) || t0 < 0 || ax < 0 || (best && t0 >= best.t)) continue;
      // which side: the normal along ax, pointing back at the ray
      const n = [0, 0, 0]; n[ax] = sg;
      const F = faceList(uv[0], uv[1], size[0], size[1], size[2]).find(f => f[0][0] === n[0] && f[0][1] === n[1] && f[0][2] === n[2]);
      if (!F) continue;
      const P = [A[0] + D[0] * t0, A[1] + D[1] * t0, A[2] + D[2] * t0];
      const at = k => [c[0] + F[1][k][0] * h[0], c[1] + F[1][k][1] * h[1], c[2] + F[1][k][2] * h[2]];
      const tl = at(0), tr = at(1), bl = at(3), r = F[2];
      const ux = [tr[0] - tl[0], tr[1] - tl[1], tr[2] - tl[2]], vy = [bl[0] - tl[0], bl[1] - tl[1], bl[2] - tl[2]], q = [P[0] - tl[0], P[1] - tl[1], P[2] - tl[2]];
      const fu = (q[0] * ux[0] + q[1] * ux[1] + q[2] * ux[2]) / (ux[0] * ux[0] + ux[1] * ux[1] + ux[2] * ux[2]);
      const fv = (q[0] * vy[0] + q[1] * vy[1] + q[2] * vy[2]) / (vy[0] * vy[0] + vy[1] * vy[1] + vy[2] * vy[2]);
      const W = r[2] - r[0], Hh = r[3] - r[1];
      best = { t: t0, part, rect: [r[0], r[1], W, Hh],
        tx: r[0] + Math.max(0, Math.min(W - 1, Math.floor(fu * W))), ty: r[1] + Math.max(0, Math.min(Hh - 1, Math.floor(fv * Hh))) };
    }
    return best;
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
  /* The game lights a player by the sky and block light in the block its
     eyes are in (1.62 up, 1.27 sneaking, 0.4 swimming or gliding): the
     chunk's own light (js/lightlevel.js), which reaches under an overhang
     and into a cave's mouth as the game spreads it. (This used to be a guess
     from the columns open to the sky within three blocks, so three blocks
     under a roof the model, the arm and what you hold went pitch black.) */
  sampleLight(feet) {
    const w = this.world;
    const c = w ? this.chunkAt(feet.x, feet.z) : null;
    if (c && c.light) {
      const eye = this.cur.sneak ? 1.27 : this.swim > 0.5 || this.glide > 0 ? 0.4 : 1.62;
      const v = lightNear(this, Math.floor(feet.x), Math.floor(feet.y + eye), Math.floor(feet.z), !!w.noSky);
      this.skyLv = v >> 4; this.blockLv = v & 15;
      return;
    }
    this.guessLight(feet);
  }
  /* Where the chunk has no light yet: sky light from the best of the nearby
     columns open to the sky, less a level a block away; block light from the
     brightest emitter within 7 blocks, less a level a block. */
  guessLight(feet) {
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
    this.skyLv = this.world && this.world.noSky ? 0 : Math.max(0, sky); this.blockLv = bl;
  }
}
