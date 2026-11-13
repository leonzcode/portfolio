// Fewer draw calls for the rider: the bindings, boot shells, cuffs, poles and helmet are built from several small
// meshes each (rig.js); here each group becomes one mesh with its colours in the vertices. The goggle lens keeps its
// own mirrored material. About 35 meshes a rider become about 19, in the colour pass and again in the shadow pass.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { riderShadow } from './shadowproxy.js?v=24';   // (E: the rider's shadow in a few draws)

/* Downloaded gear (2026-11-05, models/gear/, credits in CREDITS.md): goggles, a beanie, a bike lid, two skis and a pole,
   loaded once each and shared by every rider (each rider gets its own copies of the materials, for its colours).
   One Draco decoder and one loader for the whole page (the riders too). */
let _loader = null;
export function gltfLoader() {
  if (_loader) return _loader;
  const draco = new DRACOLoader(); draco.setDecoderPath('/car/vendor/three/addons/libs/draco/');
  // (C, 2026-11-11, loading: the decoder's two files come down at once, not after the first model has; and one worker
  // is enough for a few small models, a cheap Chromebook has two to four cores)
  draco.setWorkerLimit(2);
  try { draco.preload(); if (draco.decoderPending) draco.decoderPending.catch(() => { draco.decoderPending = null; }); } catch (e) {}   // (a decoder that failed to come is asked for again by the next model)
  _loader = new GLTFLoader(); _loader.setDRACOLoader(draco);
  return _loader;
}
/* (C, 2026-11-11, for "never loads on chromebook and takes too long to load") A file fetched once for the whole visit
   (a second rider of the same body, a look changed back, all use the one download), tried again twice when it fails
   (a school's or a train's Wi-Fi drops a request now and then: one lost file used to leave the game loading for ever),
   and given up after a time limit, so nothing waits on it for ever. Resolves to an ArrayBuffer, rejects on a failure. */
const _files = new Map();
export function fetchOnce(url, { tries = 3, ms = 45000 } = {}) {
  if (_files.has(url)) return _files.get(url);
  const go = async () => {
    let err = null;
    for (let i = 0; i < tries; i++) {
      const ac = typeof AbortController !== 'undefined' ? new AbortController() : null, t = ac ? setTimeout(() => ac.abort(), ms) : 0;
      try {
        const r = await fetch(url, ac ? { signal: ac.signal } : undefined);
        if (!r.ok) throw new Error(url + ': ' + r.status);
        const b = await r.arrayBuffer(); clearTimeout(t); return b;
      } catch (e) { clearTimeout(t); err = e; if (i < tries - 1) await new Promise(res => setTimeout(res, 600 * (i + 1))); }
    }
    throw err;
  };
  const p = go(); _files.set(url, p);
  p.catch(() => _files.delete(url));        // (a failure is not kept: the next ask tries again)
  return p;
}
// a GLB through fetchOnce, parsed for the caller (each caller gets its own copy of the scene)
export async function loadGLB(url, opts) {
  const buf = await fetchOnce(url, opts);
  return gltfLoader().parseAsync(buf, url.slice(0, url.lastIndexOf('/') + 1));
}
/* what a rider looks like (the locker, locker.js; saved as ski_look, sent to the room as the rider's look). Body: one
   of the five Rocketbox riders. head: 'lid' (the downloaded helmet), 'painted' (our own painted helmet) or 'beanie'.
   fit: how baggy the clothes are (baggy also wears the trousers low). ski: 'park' (our own twin tip), 'twin' or 'pow'
   (downloaded). (2026-11-08, for "steezier clothing") top: 'jacket', 'long' (an oversized jacket down over the seat) or
   'hoodie' (long, with its hood up over the helmet); jacket2 the sleeves' colour; gaiter: 'on' (a neck gaiter pulled up
   over the nose, in gaiterCol) or 'off'; gog: the goggles 'on' over the eyes or pushed 'up' onto the helmet. */
export const LOOK = {
  body: 'm_adult_10', head: 'lid', helmet: '#f2f2ef', lens: '#ff8a2a', frame: '#16181c', jacket: '#c8392b', pants: '#232b36', gloves: '#16181c',
  fit: 'baggy', boots: '#e9eaec', ski: 'park', skiA: '#0d1b2a', skiB: '#ff6a13', poles: 'on', poleCol: '#c9ccd1',
  top: 'hoodie', jacket2: '#c8392b', gaiter: 'on', gaiterCol: '#22252b', gog: 'on',
};
// the tops: how far down the jacket comes (its hem, as a share of the body's height up from the soles) and the hood
export const TOPS = { jacket: { hem: 0.545, hood: false }, long: { hem: 0.49, hood: false }, hoodie: { hem: 0.5, hood: true } };
// trousers worn low (a dropped crotch) by fit
export const LOW = { baggy: 1, regular: 0.4, slim: 0 };
export const FIT = { baggy: 1, regular: 0.7, slim: 0.45 };
const _gear = new Map();
export function gearModel(name) {
  if (!_gear.has(name)) _gear.set(name, loadGLB('./models/gear/' + name + '.glb?v=24').then(g => { g.scene.updateMatrixWorld(true); return g.scene; }).catch(e => { console.warn('gear', name, e); return null; }));   // (C: tried again, a time limit; a gear part that never comes is left out, our own stands in)
  return _gear.get(name);
}
/* (2026-11-12, loading) BufferGeometry.applyMatrix4 for plain float positions and normals: the same sums three does
   (Vector3.applyMatrix4, applyNormalMatrix), in one plain loop; three's own goes through its accessors a vertex at a
   time, about 170 ms of a rider's start on a slow processor (the helmet's and the goggles' thousands of points) */
const _nm = new THREE.Matrix3();
const plainVec3 = a => !!a && !a.isInterleavedBufferAttribute && !a.normalized && a.array instanceof Float32Array && a.itemSize === 3;
export function bake(g, m) {
  const P = g.attributes.position, N = g.attributes.normal;
  if (!plainVec3(P) || (N && !plainVec3(N)) || g.attributes.tangent) return g.applyMatrix4(m);
  const e = m.elements, p = P.array;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2], w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    p[i] = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w; p[i + 1] = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w; p[i + 2] = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
  }
  P.needsUpdate = true;
  if (N) {
    const f = _nm.getNormalMatrix(m).elements, n = N.array;
    for (let i = 0; i < n.length; i += 3) {
      const x = n[i], y = n[i + 1], z = n[i + 2];
      const a = f[0] * x + f[3] * y + f[6] * z, b = f[1] * x + f[4] * y + f[7] * z, c = f[2] * x + f[5] * y + f[8] * z, k = 1 / (Math.sqrt(a * a + b * b + c * c) || 1);
      n[i] = a * k; n[i + 1] = b * k; n[i + 2] = c * k;
    }
    N.needsUpdate = true;
  }
  if (g.boundingBox !== null) g.computeBoundingBox();
  if (g.boundingSphere !== null) g.computeBoundingSphere();
  return g;
}
// the model's meshes as plain meshes in the model's own frame (the node transforms baked into copies of their
// geometry), each with its own copy of its material, keyed by the material's name
export async function gearParts(name) {
  const sc = await gearModel(name); if (!sc) return null;
  const out = {};
  sc.traverse(o => {
    if (!o.isMesh) return;
    const g = bake(o.geometry.clone(), o.matrixWorld);
    const m = o.material.clone(), k = m.name || 'part';
    if (m.map) m.userData.sharedMaps = true;            // (the picture is the cached model's, shared by every rider)
    const mesh = new THREE.Mesh(g, m); mesh.castShadow = true; mesh.name = k;
    if (out[k]) { out[k].geometry = mergeGeometries([out[k].geometry.toNonIndexed(), g.toNonIndexed()], false) || out[k].geometry; } else out[k] = mesh;
  });
  return out;
}

const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4();
function mergeInto(group, keep = () => false) {
  group.updateMatrixWorld(true);
  _inv.copy(group.matrixWorld).invert();
  const parts = [], drop = [];
  let rough = 0, metal = 0, n = 0, layer = null, side = THREE.FrontSide, head = false;
  group.traverse(o => {
    if (!o.isMesh || o.isSkinnedMesh || o === group || keep(o)) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    bake(g, _m.multiplyMatrices(_inv, o.matrixWorld));   // (applyMatrix4's sums in one loop)
    const c = (mat.color || new THREE.Color(1, 1, 1)).clone(), col = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < col.length; i += 3) { col[i] = c.r; col[i + 1] = c.g; col[i + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(g); drop.push(o);
    rough += mat.roughness ?? 0.6; metal += mat.metalness ?? 0; n++;
    if (layer === null) layer = o.layers.mask;
    if (o.userData.head) head = true;
    if (mat.side === THREE.DoubleSide) side = THREE.DoubleSide;
  });
  if (parts.length < 2) return null;
  const geo = mergeGeometries(parts, false);
  if (!geo) return null;
  // (the pieces merged are freed: their copies are in the merged mesh)
  for (const o of drop) { o.parent.remove(o); o.geometry.dispose(); }
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough / n, metalness: Math.min(0.5, metal / n), side }));
  mesh.castShadow = true; mesh.name = group.name + '-merged';
  if (head) mesh.userData.head = true;               // (C: a piece of the head: hidden only from its own rider's eyes)
  if (layer !== null) mesh.layers.mask = layer;
  group.add(mesh);
  return mesh;
}

export function mergeGear(rig) {
  if (!rig || !rig.ready || rig._merged) return;
  rig._merged = true;
  // (another ride, a snowboard..., has no skis, boots or poles of ours: only the helmet is merged here)
  if (rig.skiL && rig.poleL) {
  // each ski: its binding pieces into one (the ski itself keeps its three surfaces)
  for (const ski of [rig.skiL, rig.skiR]) {
    const g = new THREE.Group(); g.name = 'binding';
    for (const c of ski.children.slice()) if (c.isMesh) g.add(c);
    ski.add(g); mergeInto(g);
  }
  for (const b of [rig.bootL, rig.bootR]) { mergeInto(b.lower); mergeInto(b.cuff); }
  for (const p of [rig.poleL, rig.poleR]) mergeInto(p);
  }
  // the helmet: everything but the mirrored lens
  const lens = [];
  rig.helmet.traverse(o => { if (o.isMesh && o.material && o.material.metalness >= 0.99) lens.push(o); });
  // (and the shell, which wears its painted picture: merged, it came out plain white)
  mergeInto(rig.helmet, o => lens.includes(o) || !!(o.material && o.material.map) || !!o.userData.keep);   // (keep: the hood, recoloured live)
  // (E, 2026-11-09: every rigid piece's shadow, skis, boots, poles, helmet, a board or a scooter..., in one draw)
  riderShadow(rig);
}
