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
  thomas: 'character-male-b#buzz',
  // Leon's own model, one solid piece with no skeleton (see bakeStatic)
  nubert: 'nubert2',
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

/* A buzz cut: the skin on the top of the head, the band round the crown and
   the back of the head painted near black, so the
   bald character reads as having very short hair. Nothing is added or moved;
   only which texel those faces are coloured from. */
const BUZZ_UV = [0.094, 0.9];
function buzzFaces(o, P, U, idx, tris) {
  const out = new Set();
  if (!U) return out;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3();
  const cellOf = t => Math.floor(((U.getX(t[0]) + U.getX(t[1]) + U.getX(t[2])) / 3) * 8) + (U.getY(t[0]) < 0.7 ? 8 : 0);
  const list = [];
  let top = -1e9;
  for (let t = 0; t < tris; t += 3) {
    const a = idx ? idx[t] : t, b = idx ? idx[t + 1] : t + 1, c = idx ? idx[t + 2] : t + 2;
    A.fromBufferAttribute(P, a); B.fromBufferAttribute(P, b); C.fromBufferAttribute(P, c);
    N.subVectors(C, B).cross(A.clone().sub(B));
    const area = N.length() / 2;
    N.normalize();
    const cy = (A.y + B.y + C.y) / 3;
    top = Math.max(top, A.y, B.y, C.y);
    list.push({ t, tri: [a, b, c], area, n: N.clone(), cy });
  }
  // the skin is the colour covering the most of the head
  const area = {};
  for (const f of list) { const k = cellOf(f.tri); area[k] = (area[k] || 0) + f.area; }
  let skin = -1, best = 0;
  for (const k in area) if (area[k] > best) { best = area[k]; skin = +k; }
  for (const f of list) {
    if (cellOf(f.tri) !== skin) continue;            // the beard, the eyes, the ears' insides stay
    // the model looks down +z: the top, the crown band all round, and the back
    const crown = f.cy > top - 0.065;
    if (f.n.y > 0.7 || crown || (f.n.z < -0.7 && f.cy > top - 0.27)) out.add(f.t);
  }
  return out;
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

/* A model with no skeleton (Nubert, 2026-10-02): nothing to pose and no arms
   to turn, so the whole of it is the head, which the kart already turns into
   the corners, sat on the seat. The torso and arms are left empty. Its colours
   are its own: the character colours and the unique drivers do not repaint it,
   though a unique driver's metal, glow or ghost still goes on. */
function bakeStatic(scene) {
  scene.rotation.y = Math.PI;
  scene.updateMatrixWorld(true);
  const H = { pos: [], uv: [], leg: [] };
  let mat = null, top = -Infinity, bot = Infinity;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const v = new THREE.Vector3();
  scene.traverse(o => {
    if (!o.isMesh) return;
    mat = mat || o.material;
    const g = o.geometry, P = g.attributes.position, U = g.attributes.uv;
    const idx = g.index ? g.index.array : null;
    const n = idx ? idx.length : P.count;
    for (let t = 0; t < n; t++) {
      const i = idx ? idx[t] : t;
      v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld);
      H.pos.push(v.x, v.y, v.z);
      if (U) H.uv.push(U.getX(i), U.getY(i));
      H.leg.push(0);
      top = Math.max(top, v.y); bot = Math.min(bot, v.y);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); z0 = Math.min(z0, v.z); z1 = Math.max(z1, v.z);
    }
  });
  // sat a little down into the seat, the way a person's hips are
  const hipAt = new THREE.Vector3((x0 + x1) / 2, bot + (top - bot) * 0.1, (z0 + z1) / 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(H.pos, 3));
  if (H.uv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(H.uv, 2));
  g.translate(-hipAt.x, -hipAt.y, -hipAt.z);
  g.computeVertexNormals();
  const empty = () => { const e = new THREE.BufferGeometry(); e.setAttribute('position', new THREE.Float32BufferAttribute([], 3)); return e; };
  const m = new THREE.MeshStandardMaterial({ map: mat && mat.map, roughness: 0.62, metalness: 0 });
  if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
  // every vertex keeps the colour the texture gives it, whatever a look asks for
  const px = pixelsOf(mat && mat.map && mat.map.image);
  if (px && H.uv.length) {
    const count = H.pos.length / 3, base = new Float32Array(count * 3), col = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const x = Math.min(px.w - 1, Math.max(0, Math.floor(H.uv[i * 2] * px.w)));
      const y = Math.min(px.h - 1, Math.max(0, Math.floor(H.uv[i * 2 + 1] * px.h)));
      const o = (y * px.w + x) * 4;
      col.setRGB(px.d[o] / 255, px.d[o + 1] / 255, px.d[o + 2] / 255, THREE.SRGBColorSpace);
      base[i * 3] = col.r; base[i * 3 + 1] = col.g; base[i * 3 + 2] = col.b;
    }
    g.userData.base = base; g.userData.role = new Uint8Array(count); g.userData.shade = new Float32Array(count).fill(1);
  }
  return { torso: empty(), head: g, arms: empty(), headAt: hipAt.clone(), armsAt: hipAt.clone(), hipAt, top, mat: m };
}

function bake(gltf, mod) {
  const scene = gltf.scene;
  let skinned = false;
  scene.traverse(o => { if (o.isSkinnedMesh) skinned = true; });
  if (!skinned) return bakeStatic(scene);
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

  const out = { torso: { pos: [], uv: [], leg: [] }, head: { pos: [], uv: [], leg: [] }, arms: { pos: [], uv: [], leg: [] } };
  let mat = null, top = -Infinity;
  const v = new THREE.Vector3();
  scene.traverse(o => {
    if (!o.isSkinnedMesh) return;
    mat = mat || o.material;
    const g = o.geometry, P = g.attributes.position, U = g.attributes.uv;
    const SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
    const bones = o.skeleton.bones;
    // where every vertex is in the pose, and which part it belongs to
    const world = new Float32Array(P.count * 3), part = new Array(P.count), legOf = new Uint8Array(P.count);
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
      legOf[i] = name.startsWith('leg') ? 1 : 0;
    }
    const idx = g.index ? g.index.array : null;
    const tris = idx ? idx.length : P.count;
    const buzz = mod === 'buzz' && o.name === 'head-mesh' ? buzzFaces(o, P, U, idx, tris) : null;
    for (let t = 0; t < tris; t += 3) {
      const a = idx ? idx[t] : t, b = idx ? idx[t + 1] : t + 1, c = idx ? idx[t + 2] : t + 2;
      if (mod === 'noglasses' && o.name === 'head-mesh' && U && isGlasses(U, a, b, c)) continue;
      const into = out[part[a]];
      const hair = buzz && buzz.has(t);
      for (const i of [a, b, c]) {
        into.pos.push(world[i * 3], world[i * 3 + 1], world[i * 3 + 2]);
        if (U) { if (hair) into.uv.push(BUZZ_UV[0], BUZZ_UV[1]); else into.uv.push(U.getX(i), U.getY(i)); }
        into.leg.push(legOf[i]);
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
  const parts = { torso: geo(out.torso, hipAt), head: geo(out.head, headAt), arms: geo(out.arms, armsAt) };
  try { colourRoles(parts, out, mat && mat.map && mat.map.image, headAt); } catch (e) { console.warn('driver roles', e); }
  return Object.assign(parts, { headAt, armsAt, hipAt, top, mat: m });
}

/* ---- the character's own colours -----------------------------------------
   Every vertex is given the colour the texture paints it, so the model can be
   drawn without the texture at all, and a role: skin, shirt, trousers, hair,
   or something to be left alone (shoes, the eyes and mouth). A kart can then
   repaint any role in a colour of its own and keep the shading the texture
   had. The skin is whichever colour covers most of the front of the face;
   the hands are skin because they are the same colour, wherever they are. */
const ROLE = { keep: 0, skin: 1, shirt: 2, pants: 3, hair: 4 };
let pixelCache = null;
function pixelsOf(img) {
  if (!img) return null;
  if (pixelCache && pixelCache.img === img) return pixelCache;
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  pixelCache = { img, w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data };
  return pixelCache;
}
function colourRoles(parts, out, img, headAt) {
  const px = pixelsOf(img);
  if (!px) return;
  const col = new THREE.Color();
  const sample = (u, v) => {
    // glTF textures are not flipped: v runs down the image
    const x = Math.min(px.w - 1, Math.max(0, Math.floor(u * px.w)));
    const y = Math.min(px.h - 1, Math.max(0, Math.floor(v * px.h)));
    const o = (y * px.w + x) * 4;
    return col.setRGB(px.d[o] / 255, px.d[o + 1] / 255, px.d[o + 2] / 255, THREE.SRGBColorSpace);
  };
  const cell = (u, v) => Math.floor(u * 8) + (v < 0.7 ? 8 : 0);
  // the skin: the cell covering most of the front of the head
  const H = out.head;
  const n = H.pos.length / 9;
  let headTop = -1e9, headBot = 1e9, frontZ = 1e9;
  for (let i = 0; i < H.pos.length; i += 3) { headTop = Math.max(headTop, H.pos[i + 1]); headBot = Math.min(headBot, H.pos[i + 1]); frontZ = Math.min(frontZ, H.pos[i + 2]); }
  const area = {};
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3();
  const tri = (P, t) => { A.fromArray(P, t * 9); B.fromArray(P, t * 9 + 3); C.fromArray(P, t * 9 + 6);
    N.subVectors(C, B).cross(B.clone().sub(A)); return N; };
  for (let t = 0; t < n; t++) {
    const nn = tri(H.pos, t); const len = nn.length() || 1e-6;
    // after the turn the face looks down -z
    if (nn.z / len > -0.6) continue;
    const k = cell(H.uv[t * 6], H.uv[t * 6 + 1]);
    area[k] = (area[k] || 0) + len;
  }
  let skin = -1, best = 0;
  for (const k in area) if (area[k] > best) { best = area[k]; skin = +k; }
  for (const name of ['torso', 'head', 'arms']) {
    const P = out[name], g = parts[name];
    const count = P.pos.length / 3;
    const colours = new Float32Array(count * 3), role = new Uint8Array(count);
    let legBot = 1e9, legTop = -1e9;
    for (let i = 0; i < count; i++) if (P.leg[i]) { legBot = Math.min(legBot, P.pos[i * 3 + 1]); legTop = Math.max(legTop, P.pos[i * 3 + 1]); }
    for (let t = 0; t < count / 3; t++) {
      const u = P.uv[t * 6], v = P.uv[t * 6 + 1];
      const k = cell(u, v);
      let r = ROLE.keep;
      const cy = (P.pos[t * 9 + 1] + P.pos[t * 9 + 4] + P.pos[t * 9 + 7]) / 3;
      const cz = (P.pos[t * 9 + 2] + P.pos[t * 9 + 5] + P.pos[t * 9 + 8]) / 3;
      if (k === skin) r = ROLE.skin;
      else if (name === 'head') {
        // the eyes and mouth sit on the face plane below the hairline: left alone
        const nn = tri(P.pos, t); const len = nn.length() || 1e-6;
        const onFace = nn.z / len < -0.6 && cz < frontZ + 0.03 && cy < headTop - (headTop - headBot) * 0.22;
        r = onFace ? ROLE.keep : ROLE.hair;
      } else if (name === 'arms') r = ROLE.shirt;
      else {
        const leg = P.leg[t * 3];
        if (leg) r = cy < legBot + (legTop - legBot) * 0.2 ? ROLE.keep : ROLE.pants;
        else r = ROLE.shirt;
      }
      for (let j = 0; j < 3; j++) {
        const i = t * 3 + j;
        sample(P.uv[i * 2], P.uv[i * 2 + 1]);
        colours[i * 3] = col.r; colours[i * 3 + 1] = col.g; colours[i * 3 + 2] = col.b;
        role[i] = r;
      }
    }
    // how bright each vertex is against the average of its role: the shading to keep
    const sum = [0, 0, 0, 0, 0], cnt = [0, 0, 0, 0, 0];
    for (let i = 0; i < count; i++) { const l = colours[i * 3] + colours[i * 3 + 1] + colours[i * 3 + 2]; sum[role[i]] += l; cnt[role[i]]++; }
    const shade = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const l = colours[i * 3] + colours[i * 3 + 1] + colours[i * 3 + 2];
      const avg = cnt[role[i]] ? sum[role[i]] / cnt[role[i]] : l;
      shade[i] = Math.max(0.55, Math.min(1.4, avg > 1e-4 ? l / avg : 1));
    }
    g.userData.base = colours; g.userData.role = role; g.userData.shade = shade;
  }
}

/* The same character in other colours: a copy of each part's geometry that
   shares the shape and has its own colours. Kept per look, so a grid of
   karts dressed alike shares one set. `look` is { skin, shirt, pants, hair }
   as 0xRRGGBB numbers, any of them missing for "as the model has it". */
const tinted = new Map();
export function tintDriver(D, look, key) {
  const k = key + '|' + JSON.stringify(look);
  if (tinted.has(k)) return tinted.get(k);
  const c = new THREE.Color();
  const want = [null, look.skin, look.shirt, look.pants, look.hair].map(v => (v === null || v === undefined) ? null : new THREE.Color(v));
  const one = src => {
    const ud = src.userData;
    if (!ud || !ud.base) return src;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', src.attributes.position);
    g.setAttribute('normal', src.attributes.normal);
    const cols = new Float32Array(ud.base.length);
    for (let i = 0; i < ud.role.length; i++) {
      const w = want[ud.role[i]];
      if (w) { c.copy(w).multiplyScalar(ud.shade[i]); cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; }
      else { cols[i * 3] = ud.base[i * 3]; cols[i * 3 + 1] = ud.base[i * 3 + 1]; cols[i * 3 + 2] = ud.base[i * 3 + 2]; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    g.boundingSphere = src.boundingSphere;
    return g;
  };
  const out = { torso: one(D.torso), head: one(D.head), arms: one(D.arms) };
  tinted.set(k, out);
  return out;
}
const tintMats = new Map();
// the material for a tinted character: vertex colours, and for the special
// drivers a little metal, a glow, or a see-through ghost
export function tintMaterial(extra) {
  const k = JSON.stringify(extra || {});
  if (tintMats.has(k)) return tintMats.get(k);
  const e = extra || {};
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: e.metal ? 0.3 : 0.62, metalness: e.metal || 0 });
  if (e.glow) { m.emissive = new THREE.Color(e.skin || 0xffffff); m.emissiveIntensity = e.glow; }
  if (e.ghost) { m.transparent = true; m.opacity = e.ghost; m.depthWrite = false; }
  tintMats.set(k, m);
  return m;
}
// the top of the head, from the neck, in the model's own units, and how wide it is
export function headBox(D) {
  if (D._headBox) return D._headBox;
  D.head.computeBoundingBox();
  const b = D.head.boundingBox;
  D._headBox = { top: b.max.y, bottom: b.min.y, cx: (b.max.x + b.min.x) / 2, cz: (b.max.z + b.min.z) / 2,
                 w: b.max.x - b.min.x, d: b.max.z - b.min.z, front: b.min.z };
  return D._headBox;
}
