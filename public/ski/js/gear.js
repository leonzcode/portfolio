// Fewer draw calls for the rider: the bindings, boot shells, cuffs, poles and helmet are built from several small
// meshes each (rig.js); here each group becomes one mesh with its colours in the vertices. The goggle lens keeps its
// own mirrored material. About 35 meshes a rider become about 19, in the colour pass and again in the shadow pass.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { riderShadow } from './shadowproxy.js?v=21';   // (E: the rider's shadow in a few draws)

/* Downloaded gear (2026-11-05, models/gear/, credits in CREDITS.md): goggles, a beanie, a bike lid, two skis and a pole,
   loaded once each and shared by every rider (each rider gets its own copies of the materials, for its colours).
   One Draco decoder and one loader for the whole page (the riders too). */
let _loader = null;
export function gltfLoader() {
  if (_loader) return _loader;
  const draco = new DRACOLoader(); draco.setDecoderPath('/car/vendor/three/addons/libs/draco/');
  _loader = new GLTFLoader(); _loader.setDRACOLoader(draco);
  return _loader;
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
  if (!_gear.has(name)) _gear.set(name, gltfLoader().loadAsync('./models/gear/' + name + '.glb?v=21').then(g => { g.scene.updateMatrixWorld(true); return g.scene; }).catch(e => { console.warn('gear', name, e); return null; }));
  return _gear.get(name);
}
// the model's meshes as plain meshes in the model's own frame (the node transforms baked into copies of their
// geometry), each with its own copy of its material, keyed by the material's name
export async function gearParts(name) {
  const sc = await gearModel(name); if (!sc) return null;
  const out = {};
  sc.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
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
  let rough = 0, metal = 0, n = 0, layer = null, side = THREE.FrontSide;
  group.traverse(o => {
    if (!o.isMesh || o.isSkinnedMesh || o === group || keep(o)) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(_m.multiplyMatrices(_inv, o.matrixWorld));
    const c = (mat.color || new THREE.Color(1, 1, 1)).clone(), col = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < col.length; i += 3) { col[i] = c.r; col[i + 1] = c.g; col[i + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(g); drop.push(o);
    rough += mat.roughness ?? 0.6; metal += mat.metalness ?? 0; n++;
    if (layer === null) layer = o.layers.mask;
    if (mat.side === THREE.DoubleSide) side = THREE.DoubleSide;
  });
  if (parts.length < 2) return null;
  const geo = mergeGeometries(parts, false);
  if (!geo) return null;
  // (the pieces merged are freed: their copies are in the merged mesh)
  for (const o of drop) { o.parent.remove(o); o.geometry.dispose(); }
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough / n, metalness: Math.min(0.5, metal / n), side }));
  mesh.castShadow = true; mesh.name = group.name + '-merged';
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
