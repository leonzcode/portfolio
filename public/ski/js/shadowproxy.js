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
    hideQuiet();                                 // (L, round 12: the riders' bones, walked for nothing: riderBatch below)
    if (before) before.apply(this, a);
  };
  const after = scene.onAfterRender;
  scene.onAfterRender = function (...a) { showQuiet(); if (after) after.apply(this, a); };   // (L, round 12)
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

/* ---- (L, round 12, for "less laggy": every draw call is about 0.3 ms of the page's own work a frame on a slow
   Chromebook processor) The rider's plain pieces in one draw. Each rider was about twenty draws in the view: the body
   and the head (skinned), the painted shell, the skis' three surfaces each (they bend, a shader of their own), and
   eleven plain pieces (the bindings, the boots' shells and cuffs, the poles, the helmet's merged parts, the hood, the
   goggles' lens). Those plain pieces are copied into one skinned mesh, as the shadow's stand-in above is: a "bone" a
   piece, filled each frame from the piece's own place (folded to nothing when the piece is hidden or on a layer the
   camera does not show: first person), each corner carrying the piece's colour, roughness and metalness, so the picture
   is the same. The pieces stay where they are (the rig moves them, the tracks and crashes read them), only their own
   draw is left out (their material's visible flag). A colour changed live (the locker: lens, hood) is copied in. */
const _rbBase = THREE.Material.prototype.onBeforeCompile;
const plainPiece = o => {
  if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || shadowOnly.has(o) || Array.isArray(o.material) || o.renderOrder) return false;
  const g = o.geometry, m = o.material;
  if (!g || !g.attributes.position || !g.attributes.normal || g.attributes.position.isInterleavedBufferAttribute || g.attributes.normal.isInterleavedBufferAttribute) return false;
  if (g.morphAttributes && Object.keys(g.morphAttributes).length) return false;
  if (!m || !m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || !m.visible || m.transparent || m.opacity < 1 || m.alphaTest > 0 || m.wireframe || m.flatShading || m.side === THREE.BackSide) return false;
  for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap', 'envMap', 'lightMap', 'bumpMap', 'displacementMap']) if (m[k]) return false;
  if (m.onBeforeCompile !== _rbBase || (m.emissive && (m.emissive.r || m.emissive.g || m.emissive.b))) return false;
  if (m.vertexColors && !g.attributes.color) return false;
  return true;
};
export function riderBatch(rig) {
  if (!rig || !rig.root || rig._viewBatch) return null;
  rig.root.updateMatrixWorld(true);
  const all = []; rig.root.traverse(o => { if (o !== rig.root && plainPiece(o)) all.push(o); });
  if (all.length < 3) return null;
  // (one batch for the pieces drawn from the front only, one for the two-sided: a one-sided piece drawn from both sides
  // showed its inside, the poles' baskets from above)
  const front = all.filter(o => o.material.side === THREE.FrontSide), both = all.filter(o => o.material.side !== THREE.FrontSide);
  // (both share one skeleton: its matrices filled and sent to the graphics card once a frame, by the first drawn)
  const lists = [front, both].filter(l => l.length), P = [], n = lists.reduce((a, l) => a + l.length, 0);
  const skel = new THREE.Skeleton(Array.from({ length: n }, () => new THREE.Bone()), Array.from({ length: n }, () => new THREE.Matrix4()));
  skel.computeBoneTexture();
  skel.update = () => {};                    // (filled in just before it is drawn, below)
  const shown = o => { for (let q = o; q && q !== rig.root; q = q.parent) if (!q.visible) return false; return true; };
  let last = -1;
  const fill = (renderer, scene, camera) => {
    const f = renderer.info.render.frame; if (f === last) return; last = f;
    const M = skel.boneMatrices;
    for (let b = 0; b < P.length; b++) {
      const p = P[b], o = p.o;
      if (o.parent && shown(o) && o.layers.test(camera.layers)) {
        const e = o.matrixWorld.elements, k = p.k, j = b * 16;
        M[j] = e[0] * k[0]; M[j + 1] = e[1] * k[0]; M[j + 2] = e[2] * k[0]; M[j + 3] = 0;
        M[j + 4] = e[4] * k[1]; M[j + 5] = e[5] * k[1]; M[j + 6] = e[6] * k[1]; M[j + 7] = 0;
        M[j + 8] = e[8] * k[2]; M[j + 9] = e[9] * k[2]; M[j + 10] = e[10] * k[2]; M[j + 11] = 0;
        M[j + 12] = e[12]; M[j + 13] = e[13]; M[j + 14] = e[14]; M[j + 15] = 1;
        const c = o.material.color;
        if (c.r !== p.c[0] || c.g !== p.c[1] || c.b !== p.c[2]) { p.paint(p); p.colA.needsUpdate = true; }
      } else M.fill(0, b * 16, b * 16 + 16);   // (folded to a point: nothing drawn)
    }
    skel.boneTexture.needsUpdate = true;
  };
  rig._viewBatch = lists.map(l => batchOf(rig, l, l === front ? THREE.FrontSide : THREE.DoubleSide, skel, P, fill));
  quietBones(rig);
  return rig._viewBatch;
}
function batchOf(rig, parts, side, skel, PS, fill) {
  let nv = 0, ni = 0;
  for (const o of parts) { const g = o.geometry; nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), rm = new Float32Array(nv * 2), sIdx = new Uint16Array(nv * 4), sW = new Float32Array(nv * 4), idx = new Uint32Array(ni);
  // each piece: its first corner, how many, its own scale (taken into its corners, so its "bone" turns and moves it only
  // and the normals stay true: the hood is scaled unevenly), the colour last copied in
  const P = [], base = PS.length;
  let vo = 0, io = 0, receive = false;
  parts.forEach((o, b) => {
    const g = o.geometry, A = g.attributes.position, N = g.attributes.normal, C = o.material.vertexColors ? g.attributes.color : null, n = A.count, e = o.matrixWorld.elements;
    const sx = Math.hypot(e[0], e[1], e[2]) || 1, sy = Math.hypot(e[4], e[5], e[6]) || 1, sz = Math.hypot(e[8], e[9], e[10]) || 1;
    for (let i = 0; i < n; i++) {
      const v = vo + i;
      pos[v * 3] = A.getX(i) * sx; pos[v * 3 + 1] = A.getY(i) * sy; pos[v * 3 + 2] = A.getZ(i) * sz;
      const nx = N.getX(i) / sx, ny = N.getY(i) / sy, nz = N.getZ(i) / sz, l = Math.hypot(nx, ny, nz) || 1;
      nor[v * 3] = nx / l; nor[v * 3 + 1] = ny / l; nor[v * 3 + 2] = nz / l;
      rm[v * 2] = o.material.roughness; rm[v * 2 + 1] = o.material.metalness;
      sIdx[v * 4] = base + b; sW[v * 4] = 1;
    }
    if (g.index) { const I = g.index.array; for (let i = 0; i < I.length; i++) idx[io + i] = I[i] + vo; io += I.length; }
    else { for (let i = 0; i < n; i++) idx[io + i] = vo + i; io += n; }
    P.push({ o, v0: vo, n, C, k: [1 / sx, 1 / sy, 1 / sz], c: [-1, -1, -1] });
    if (o.receiveShadow) receive = true;
    vo += n;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  const colA = new THREE.BufferAttribute(col, 3); geo.setAttribute('color', colA);
  geo.setAttribute('aRM', new THREE.BufferAttribute(rm, 2));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(sIdx, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sW, 4));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  // the colours: the piece's material colour times its own corner colours (the merged pieces carry theirs in them)
  const paint = p => {
    const c = p.o.material.color, C = p.C;
    for (let i = 0; i < p.n; i++) { const v = p.v0 + i; col[v * 3] = c.r * (C ? C.getX(i) : 1); col[v * 3 + 1] = c.g * (C ? C.getY(i) : 1); col[v * 3 + 2] = c.b * (C ? C.getZ(i) : 1); }
    p.c[0] = c.r; p.c[1] = c.g; p.c[2] = c.b;
  };
  for (const p of P) { paint(p); p.paint = paint; p.colA = colA; PS.push(p); }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side });
  mat.name = 'rider pieces';
  mat.onBeforeCompile = s => {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aRM; varying vec2 vRM;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvRM = aRM;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vRM;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRM.x;').replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vRM.y;');
  };
  mat.customProgramCacheKey = () => 'riderpieces';   // (one program: the side is not part of it)
  const batch = new THREE.SkinnedMesh(geo, mat);
  batch.name = 'rider pieces'; batch.castShadow = false; batch.receiveShadow = receive; batch.frustumCulled = false;
  batch.bindMode = 'detached'; batch.bind(skel, _I);
  batch.matrixAutoUpdate = false; batch.matrix.identity(); batch.matrixWorld.identity();
  batch.updateMatrixWorld = () => {}; batch.updateWorldMatrix = () => {};
  batch.onBeforeRender = fill;
  for (const o of parts) o.material.visible = false;   // (their own draw left out; they stay for the rig, the tracks, the crashes)
  rig.root.add(batch);
  return batch;
}
/* (L, round 12) The renderer walks every node of the scene twice a frame (the view and the shadow map), each rider's 80
   bones among them though they draw nothing. Bones whose whole subtree draws nothing are hidden while the scene is drawn
   (nothing reads their visible flag then: the skins read the bones' matrices) and shown again after (installShadowOnly). */
const QUIET = new Set(), _qOff = [];
const isUnder = (o, t) => { for (let q = o.parent; q; q = q.parent) if (q === t) return true; return false; };
function quietBones(rig) {
  const draws = o => { let d = false; o.traverse(c => { if (c.isMesh || c.isPoints || c.isLine || c.isSprite) d = true; }); return d; };
  const list = [];
  rig.root.traverse(o => { if (o.isBone && !draws(o)) list.push(o); });
  // (the top of each quiet subtree only)
  const tops = list.filter(o => !list.some(t => t !== o && isUnder(o, t)));
  for (const o of tops) QUIET.add(o);
  const dispose = rig.dispose;
  rig.dispose = function (...a) { for (const o of tops) QUIET.delete(o); return dispose ? dispose.apply(this, a) : undefined; };
}
function hideQuiet() { _qOff.length = 0; for (const o of QUIET) if (o.visible) { o.visible = false; _qOff.push(o); } }
function showQuiet() { for (const o of _qOff) o.visible = true; _qOff.length = 0; }
