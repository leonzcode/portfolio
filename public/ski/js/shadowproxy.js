// Things drawn only into the sun's shadow map, and the rider's shadow as one draw.
//
// (2026-11-09, the second lag pass.) three r180 draws an object into a shadow map only if it is on one of the *view*
// camera's layers (WebGLShadowMap tests object.layers against the camera the scene is rendered with, not the shadow
// camera's), so a stand-in put on a layer of its own was never drawn into it at all. A shadow-only object here is on
// layer 0 like everything else, and is hidden from the view's own draw list instead: hidden as each render of the scene
// starts (scene.onBeforeRender, before three sorts what it will draw), shown again as the shadow map is drawn (the
// light's shadow.updateMatrices, which three calls just before), so it goes into the shadow map and nowhere else.
//
// The rider (and every other rider in a room) was about twenty draws in the shadow pass: the body, the head and each
// piece of gear (skis, bindings, boots, poles, helmet, goggles; a board, a scooter, a bike, a sled). The two skinned
// meshes (body and head) still cast their own shadows; every other piece that cast one is now one mesh, skinned to a
// "bone" a piece that follows each piece's own place every frame (its matrix copied in as the shadow map is drawn),
// so the whole rider casts in three draws and the shadow is the same shape as before. A piece hidden (the poles put
// away, a part of another ride) or on a layer the view camera does not show (layer 1, the head's things, hidden in
// first person) is folded away to nothing for that frame, as three itself would leave it out.
import * as THREE from 'three';

export const shadowOnly = new Set();

// call once with the scene and the light whose shadow map the stand-ins go into
export function installShadowOnly(scene, light) {
  const before = scene.onBeforeRender;
  scene.onBeforeRender = function (...a) {
    for (const o of shadowOnly) o.visible = false;
    if (before) before.apply(this, a);
  };
  const sh = light.shadow, upd = sh.updateMatrices.bind(sh);
  let sorted = false;
  sh.updateMatrices = function (l, vp) {
    if (!sorted) { sorted = true; castLayer5(scene); sortDepth(scene); }
    // (shown only when it is in this scene: a rider still being made, before it is added, stays hidden)
    for (const o of shadowOnly) { let top = o; while (top.parent) top = top.parent; o.visible = top === scene; }
    return upd(l, vp);
  };
}

/* (2026-11-09) three draws every plain shadow caster with one depth material, and changes its program each time the
   next caster is of another kind (skinned, instanced, with morphs): a program look-up each change, two or three a
   frame (the rider's skinned meshes among the rest), each about as dear as a dozen draws' uniforms. Skinned and
   instanced casters get a depth material of their kind of their own (the same program three would use), so the shared
   one never changes. Done once for the scene at the first shadow map and for each rider as its shadow is made. */
const DEPTH = {};
export function sortDepth(root) {
  root.traverse(o => {
    if (!o.isMesh || !o.castShadow || o.customDepthMaterial) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || m.alphaTest > 0 || m.alphaToCoverage || m.displacementMap || (m.clippingPlanes && m.clippingPlanes.length)) return;   // (three makes its own copy for these)
    const morph = o.geometry && o.geometry.morphAttributes && o.geometry.morphAttributes.position ? 'M' : '';
    const k = o.isSkinnedMesh ? 'S' + morph : o.isInstancedMesh ? (o.instanceColor ? 'IC' : 'I') + morph : morph;
    if (!k) return;
    o.customDepthMaterial = DEPTH[k] || (DEPTH[k] = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
  });
}

/* The older shadow-only stand-ins (the park's fence and flag pieces, the trees near the rider on the medium and high
   tiers, the lifts' and T-bar's towers and stations: world.js, lift.js, tbar.js) were put on layer 5 for the shadow
   camera, so they had never cast a shadow (see the top). castLayer5(scene), at the first shadow map (above), puts them
   on layer 0 and among the shadow-only things, so they cast as they were meant to since v17 (2026-11-09: 2 to 5 more
   draws in the shadow pass). One made later on layer 5 can be handed to shadowOnly the same way. */
export function castLayer5(scene) {
  let n = 0;
  scene.traverse(o => { if (o.isMesh && o.castShadow && o.layers.mask === 32) { o.layers.set(0); shadowOnly.add(o); n++; } });
  return n;
}

const _I = new THREE.Matrix4();
// the side three draws a material's shadow with (its own shadowSide, else the other side of a one-sided one)
const shadowSideOf = o => {
  const ms = Array.isArray(o.material) ? o.material : [o.material];
  let side = THREE.BackSide;
  for (const m of ms) {
    const s = m.shadowSide != null ? m.shadowSide : m.side === THREE.DoubleSide ? THREE.DoubleSide : m.side === THREE.BackSide ? THREE.FrontSide : THREE.BackSide;
    if (s !== THREE.BackSide) side = s;
  }
  return side;
};
// the rider's shadow: every rigid piece that casts one, merged into one skinned mesh under the rider's root (one for
// each side the pieces' shadows are drawn from: usually one, two at most)
export function riderShadow(rig) {
  if (!rig || !rig.root || rig._shadowProxies) return null;
  rig.root.updateMatrixWorld(true);
  const bySide = new Map();
  rig.root.traverse(o => {
    if (!o.isMesh || o.isSkinnedMesh || !o.castShadow || !o.geometry || !o.geometry.attributes.position) return;
    if (o.isInstancedMesh || o.morphTargetInfluences || (Array.isArray(o.material) ? o.material : [o.material]).some(m => m.alphaTest > 0 || m.alphaMap)) return;
    const k = shadowSideOf(o); if (!bySide.has(k)) bySide.set(k, []); bySide.get(k).push(o);
  });
  let n = 0; for (const l of bySide.values()) n += l.length;
  if (n < 3) return null;
  rig._shadowProxies = [];
  for (const [side, parts] of bySide) rig._shadowProxies.push(proxyOf(rig, parts, side));
  sortDepth(rig.root);
  // (forgotten with the rider)
  const dispose = rig.dispose;
  rig.dispose = function (...a) { for (const p of rig._shadowProxies) shadowOnly.delete(p); return dispose ? dispose.apply(this, a) : undefined; };   // (Rig.dispose frees their geometry)
  return rig._shadowProxies;
}
function proxyOf(rig, parts, side) {
  let nv = 0, ni = 0;
  for (const o of parts) { const g = o.geometry; nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), sIdx = new Uint16Array(nv * 4), sW = new Float32Array(nv * 4), idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  parts.forEach((o, b) => {
    const g = o.geometry, P = g.attributes.position, n = P.count;
    for (let i = 0; i < n; i++) { pos[(vo + i) * 3] = P.getX(i); pos[(vo + i) * 3 + 1] = P.getY(i); pos[(vo + i) * 3 + 2] = P.getZ(i); sIdx[(vo + i) * 4] = b; sW[(vo + i) * 4] = 1; }
    if (g.index) { const I = g.index.array; for (let i = 0; i < I.length; i++) idx[io + i] = I[i] + vo; io += I.length; }
    else { for (let i = 0; i < n; i++) idx[io + i] = vo + i; io += n; }
    vo += n;
    o.castShadow = false;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(sIdx, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sW, 4));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  // (the "bones": one plain node a piece, never moved; their matrices are filled in from the pieces themselves)
  const bones = parts.map(() => new THREE.Bone());
  const skel = new THREE.Skeleton(bones, parts.map(() => new THREE.Matrix4()));
  skel.computeBoneTexture();
  skel.update = () => {};                    // (filled in before the shadow map is drawn, below; three never moves it)
  const mat = new THREE.MeshBasicMaterial({ colorWrite: false }); mat.shadowSide = side;
  const proxy = new THREE.SkinnedMesh(geo, mat);
  proxy.name = 'rider shadow'; proxy.castShadow = true; proxy.receiveShadow = false; proxy.frustumCulled = false;
  proxy.bindMode = 'detached'; proxy.bind(skel, _I);
  // (in the world's own frame: the pieces' matrices are world matrices, so it never takes the rider's root's)
  proxy.matrixAutoUpdate = false; proxy.matrix.identity(); proxy.matrixWorld.identity();
  proxy.updateMatrixWorld = () => {}; proxy.updateWorldMatrix = () => {};
  const shown = o => { for (let q = o; q && q !== rig.root; q = q.parent) if (!q.visible) return false; return true; };
  proxy.onBeforeShadow = (renderer, object, camera) => {
    const M = skel.boneMatrices;
    for (let b = 0; b < parts.length; b++) {
      const o = parts[b];
      if (o.parent && shown(o) && o.layers.test(camera.layers)) o.matrixWorld.toArray(M, b * 16);
      else M.fill(0, b * 16, b * 16 + 16);   // (folded to a point: nothing drawn)
    }
    skel.boneTexture.needsUpdate = true;
  };
  rig.root.add(proxy);
  proxy.visible = false;                     // (until the next shadow map: never in the view's own draw list)
  shadowOnly.add(proxy);
  return proxy;
}
