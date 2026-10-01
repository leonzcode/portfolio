/* ---------------------------------------------------------------------------
   The drivers.

   Each racer is one of Kenney's Mini Characters (CC0, kenney.nl, credited in
   models/chars/License.txt): chunky, big headed, cartoon people, which is the
   look of a kart racer's cast without borrowing anybody's.

   A character comes rigged and animated, and a kart only ever needs one pose
   of it: sitting at the wheel. So the "drive" animation is applied once, at
   load, and the posed skin is baked into plain meshes - no skeleton, no mixer,
   nothing per frame - split three ways by the bone each vertex belongs to:
   the head, which looks into the corner; the arms, which turn with the wheel;
   and everything else. Each part is centred on its joint so it can turn about
   it. Until the models arrive the karts keep the driver built in code, and a
   kart already on the road is re-dressed the moment they do.
--------------------------------------------------------------------------- */
import { GLTFLoader } from '/legacy/vendor/three-addons-0.163.0/loaders/GLTFLoader.js';
const THREE = window.THREE;

// which character each racer is, by racer id. A '#noglasses' after the file
// is the same character with the glasses taken off its face.
export const DRIVER_OF = {
  pip: 'character-male-a#noglasses', nib: 'character-female-a', wren: 'character-male-b', bram: 'character-female-b',
  coco: 'character-male-c', mox: 'character-female-c', juno: 'character-male-e', tock: 'character-female-e',
};
const baked = {};             // file -> { torso, head, arms, headAt, armsAt, hipAt, top, mat }
const waiting = [];           // callbacks for karts built before the models were in
let started = false;

export function driverFor(id) { return baked[DRIVER_OF[id]] || null; }
export function whenDrivers(fn) { waiting.push(fn); }

export function loadDrivers(base) {
  if (started) return;
  started = true;
  const loader = new GLTFLoader();
  const files = [...new Set(Object.values(DRIVER_OF))];
  let left = files.length;
  for (const f of files) {
    const [file, mod] = f.split('#');
    loader.load(base + file + '.glb', gltf => {
      try { baked[f] = bake(gltf, mod); } catch (e) { console.warn('driver', f, e); }
      if (--left === 0) for (const fn of waiting.splice(0)) { try { fn(); } catch (e) { console.warn(e); } }
    }, undefined, () => { if (--left === 0) for (const fn of waiting.splice(0)) { try { fn(); } catch (e) {} } });
  }
}

/* The glasses on character-male-a are part of its head, not a piece of their
   own: they are the head's faces painted from two columns of the shared colour
   strip, the frame and arms at u 0.469 and the lenses at u 0.594. Nothing else
   on that head uses either, so dropping those faces takes the glasses off and
   leaves the face, the ears and the hair as they were. Checked by rendering
   the head with and without each set. */
const GLASSES_U = [0.469, 0.594];
function isGlasses(U, a, b, c) {
  const u = (U.getX(a) + U.getX(b) + U.getX(c)) / 3;
  return GLASSES_U.some(g => Math.abs(u - g) < 0.02);
}

function bake(gltf, mod) {
  const scene = gltf.scene;
  const clip = gltf.animations.find(a => a.name === 'drive') || gltf.animations.find(a => a.name === 'sit');
  if (clip) {
    const mixer = new THREE.AnimationMixer(scene);
    mixer.clipAction(clip).play();
    mixer.update(0);
  }
  /* Turned round to face up the car: the characters look down +z and the
     front of a kart is -z, so every point is flipped across both. */
  scene.rotation.y = Math.PI;
  scene.updateMatrixWorld(true);
  const bonePos = name => {
    const b = scene.getObjectByName(name);
    return b ? new THREE.Vector3().setFromMatrixPosition(b.matrixWorld) : null;
  };
  const headAt = bonePos('head') || new THREE.Vector3(0, 1, 0);
  const la = bonePos('arm-left'), ra = bonePos('arm-right');
  const armsAt = la && ra ? la.clone().add(ra).multiplyScalar(0.5) : headAt.clone().setY(headAt.y * 0.8);
  const hipAt = bonePos('torso') || bonePos('root') || new THREE.Vector3();

  const out = { torso: { pos: [], uv: [] }, head: { pos: [], uv: [] }, arms: { pos: [], uv: [] } };
  let mat = null, top = -Infinity;
  const v = new THREE.Vector3();
  scene.traverse(o => {
    if (!o.isSkinnedMesh) return;
    mat = mat || o.material;
    const g = o.geometry, P = g.attributes.position, U = g.attributes.uv;
    const SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
    const bones = o.skeleton.bones;
    // where every vertex is in the pose, and which part it belongs to
    const world = new Float32Array(P.count * 3), part = new Array(P.count);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i);
      o.applyBoneTransform(i, v);
      v.applyMatrix4(o.matrixWorld);
      world[i * 3] = v.x; world[i * 3 + 1] = v.y; world[i * 3 + 2] = v.z;
      if (v.y > top) top = v.y;
      let best = 0, w = -1;
      for (let k = 0; k < 4; k++) { const wk = SW.getComponent(i, k); if (wk > w) { w = wk; best = SI.getComponent(i, k); } }
      const name = (bones[best] && bones[best].name) || '';
      part[i] = name === 'head' ? 'head' : name.startsWith('arm') ? 'arms' : 'torso';
    }
    const idx = g.index ? g.index.array : null;
    const tris = idx ? idx.length : P.count;
    for (let t = 0; t < tris; t += 3) {
      const a = idx ? idx[t] : t, b = idx ? idx[t + 1] : t + 1, c = idx ? idx[t + 2] : t + 2;
      if (mod === 'noglasses' && o.name === 'head-mesh' && U && isGlasses(U, a, b, c)) continue;
      const into = out[part[a]];
      for (const i of [a, b, c]) {
        into.pos.push(world[i * 3], world[i * 3 + 1], world[i * 3 + 2]);
        if (U) into.uv.push(U.getX(i), U.getY(i));
      }
    }
  });
  const geo = (p, at) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
    if (p.uv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(p.uv, 2));
    g.translate(-at.x, -at.y, -at.z);
    g.computeVertexNormals();
    return g;
  };
  const m = new THREE.MeshStandardMaterial({
    map: mat && mat.map, roughness: 0.62, metalness: 0,
  });
  if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
  return {
    torso: geo(out.torso, hipAt), head: geo(out.head, headAt), arms: geo(out.arms, armsAt),
    headAt, armsAt, hipAt, top, mat: m,
  };
}
