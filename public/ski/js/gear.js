// Fewer draw calls for the rider: the bindings, boot shells, cuffs, poles and helmet are built from several small
// meshes each (rig.js); here each group becomes one mesh with its colours in the vertices. The goggle lens keeps its
// own mirrored material. About 35 meshes a rider become about 19, in the colour pass and again in the shadow pass.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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
  for (const o of drop) o.parent.remove(o);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough / n, metalness: Math.min(0.5, metal / n), side }));
  mesh.castShadow = true; mesh.name = group.name + '-merged';
  if (layer !== null) mesh.layers.mask = layer;
  group.add(mesh);
  return mesh;
}

export function mergeGear(rig) {
  if (!rig || !rig.ready || rig._merged) return;
  rig._merged = true;
  // each ski: its binding pieces into one (the ski itself keeps its three surfaces)
  for (const ski of [rig.skiL, rig.skiR]) {
    const g = new THREE.Group(); g.name = 'binding';
    for (const c of ski.children.slice()) if (c.isMesh) g.add(c);
    ski.add(g); mergeInto(g);
  }
  for (const b of [rig.bootL, rig.bootR]) { mergeInto(b.lower); mergeInto(b.cuff); }
  for (const p of [rig.poleL, rig.poleR]) mergeInto(p);
  // the helmet: everything but the mirrored lens
  const lens = [];
  rig.helmet.traverse(o => { if (o.isMesh && o.material && o.material.metalness >= 0.99) lens.push(o); });
  // (and the shell, which wears its painted picture: merged, it came out plain white)
  mergeInto(rig.helmet, o => lens.includes(o) || !!(o.material && o.material.map));
}
