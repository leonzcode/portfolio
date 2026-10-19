// Cars: the catalogue, loading, and the rig that animates a model (wheels, steering wheel, lights).
// Models are prepared offline (scratchpad tools/process.py in Blender): every file has the same layout:
//   body                       everything that does not move (interior included in the player files)
//   wheel_FL/FR/RL/RR          one node per wheel, origin at the hub (extras.radius)
//   steer                      the steering wheel, origin at its hub (extras.axis = column axis, towards the driver)
//   lamp_<role>_<L|R|C>        light lenses: head, tail, brake, signal, reverse
// Frame: forward -z, right +x, up +y, origin on the ground midway between the axles.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const MODELS = new URL('../models/', import.meta.url).href;
const DRACO = new URL('../vendor/three/addons/libs/draco/gltf/', import.meta.url).href;

// physics keys match vehicle.js DEFAULTS
export const CARS = [
  {
    id: 'volvos90', name: 'Volvo S90', kind: 'sedan', file: 'volvos90.glb', npcFile: 'volvos90_npc.glb', mass: 2000,
    paint: 0x1c2733, paints: [0x1c2733, 0xd9dcdf, 0x0d0d0f, 0x5b6770, 0x7a1d22, 0x2c3e57],
    cabinDark: 0.84,
    physics: { power: 233e3, torque: 400, drive: 'awd', comHeight: 0.55, maxSteer: 33, steerRatio: 15.8, brake: 15000 },
    credit: '"Volvo S90 Recharge (Free)" by lazercar, CC BY 4.0',
  },
  {
    id: 'porsche930', name: 'Porsche 911 Turbo (1975)', kind: 'sports', file: 'porsche930.glb', npcFile: 'porsche930_npc.glb', mass: 1195,
    eye: [-0.35, 1.02, 0.18], cabinDark: 0.55,
    // the model has no steering wheel of its own: a simple one is built in front of the driver
    wheel: { pos: [-0.35, 0.75, -0.30], tilt: 24, r: 0.19 },
    paint: 0xb8babd, paints: [0xb8babd, 0x9b1b1e, 0x101012, 0xd7cfae, 0x1f3a2c, 0x2a4a7a],
    physics: { power: 191e3, torque: 330, drive: 'rwd', comHeight: 0.46, maxSteer: 32, steerRatio: 16.5, gears: [3.18, 1.83, 1.21, 0.89], final: 4.0, mu: 1.0, redline: 6500 },
    credit: '"FREE 1975 Porsche 911 (930) Turbo" by Lionsharp Studios, CC BY 4.0',
  },
  {
    id: 's10', name: 'Chevrolet S-10 pickup', kind: 'pickup', file: 's10.glb', npcFile: 's10_npc.glb', mass: 1450, cabinDark: 0.15,
    // the model's cabin is pure black: give it the dark grey plastic of the real truck
    recolor: { interior: { color: 0x3a3834, roughness: 0.8, metalness: 0 }, black: { color: 0x161616, roughness: 0.6, metalness: 0.1 } },
    paint: 0xb3261e, paints: [0xb3261e, 0xe8e8e4, 0x1b1d22, 0x2f4f7f, 0x6d6f70, 0x2d4a33],
    physics: { power: 134e3, torque: 340, drive: 'rwd', comHeight: 0.62, maxSteer: 35, steerRatio: 17, gears: [3.06, 1.63, 1.0, 0.7], final: 3.42, redline: 5200 },
    credit: '"Chevrolet S10" by Luquita (speedmodel), CC BY 4.0',
  },
  {
    id: 'fairheaven', name: "Fairheaven LT '80", kind: 'sedan', file: 'fairheaven.glb', npcFile: 'fairheaven_npc.glb', mass: 1600, cabinDark: 0.35,
    paint: 0x6e1f24, paints: [0x6e1f24, 0xc9c3b4, 0x2b3a55, 0x3b4a3a, 0x8c8f91, 0x1a1a1c, 0x9a7b4f],
    physics: { power: 100e3, torque: 300, drive: 'rwd', comHeight: 0.55, maxSteer: 36, steerRatio: 18, gears: [2.46, 1.46, 1.0], final: 2.73, redline: 4600, mu: 0.95 },
    credit: "\"Fairheaven LT '80 - Low poly model\" by Daniel Zhabotinsky, CC BY 4.0",
  },
  {
    id: 'milano', name: "Milano '95", kind: 'hatchback', file: 'milano.glb', npcFile: 'milano_npc.glb', mass: 1000, cabinDark: 0.4,
    paint: 0x1f3a3a, paints: [0x1f3a3a, 0xc8ccd0, 0x8a1c1c, 0x23324f, 0xe0d9c6, 0x505357, 0x3d5f2e],
    physics: { power: 66e3, torque: 130, drive: 'fwd', comHeight: 0.5, maxSteer: 36, steerRatio: 16, gears: [3.4, 1.9, 1.3, 0.95, 0.76], final: 4.1, redline: 6200, mu: 0.95 },
    credit: "\"Milano '95 - Low poly model\" by Daniel Zhabotinsky, CC BY 4.0",
  },
  {
    id: 'shvan', name: "Shvan '92 van", kind: 'van', file: 'shvan_npc.glb', npcFile: 'shvan_npc.glb', mass: 2100, npcOnly: true,
    paint: 0xe6e6e2, paints: [0xe6e6e2, 0x1b1d22, 0x6b7378, 0x2b3f63, 0x7d2a22, 0xb9ad8f],
    credit: "\"Shvan '92 - Low poly model\" by Daniel Zhabotinsky, CC BY 4.0",
  },
  {
    id: 'conquer', name: "Conquer '89 pickup", kind: 'pickup', file: 'conquer_npc.glb', npcFile: 'conquer_npc.glb', mass: 1800, npcOnly: true,
    paint: 0xd8d2c0, paints: [0xd8d2c0, 0x3a4b5e, 0x7b2020, 0x2a2b2d, 0x4f5f45, 0x98999b],
    credit: "\"Conquer '89 Pickup - Low poly model\" by Daniel Zhabotinsky, CC BY 4.0",
  },
];

// traffic: the cheap versions of every car, weighted towards ordinary ones
export const TRAFFIC = ['fairheaven', 'milano', 'shvan', 'conquer', 'volvos90', 's10', 'fairheaven', 'milano', 'volvos90', 'porsche930'];

const byId = id => CARS.find(c => c.id === id);

// ---------------------------------------------------------------------------------------------------------
// loading

let _loader = null;
function loader() {
  if (_loader) return _loader;
  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO);
  _loader = new GLTFLoader();
  _loader.setDRACOLoader(draco);
  return _loader;
}

const templates = new Map(); // file -> Promise<{ scene, info }>
function loadTemplate(file) {
  if (!templates.has(file)) {
    templates.set(file, loader().loadAsync(MODELS + file + '?v=9').then(g => prepareTemplate(g.scene)).catch(e => { templates.delete(file); throw e; }));
  }
  return templates.get(file);
}

// tuned materials by role; the originals keep their textures where the look depends on them
const ROLE = /^(paint|glass|chrome|tire|rim|mirror)__/;
function roleOf(m) { const r = ROLE.exec(m.name || ''); return r ? r[1] : null; }

let _flakes = null;
function flakeNormal() {
  // fine random normals, tiled: the sparkle of metallic paint under the clear coat
  if (_flakes) return _flakes;
  const n = 128, data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    const x = Math.random() * 2 - 1, y = Math.random() * 2 - 1;
    data[i * 4] = 128 + x * 60; data[i * 4 + 1] = 128 + y * 60; data[i * 4 + 2] = 255; data[i * 4 + 3] = 255;
  }
  _flakes = new THREE.DataTexture(data, n, n);
  _flakes.wrapS = _flakes.wrapT = THREE.RepeatWrapping;
  _flakes.repeat.set(30, 30);
  _flakes.magFilter = THREE.LinearFilter; _flakes.minFilter = THREE.LinearMipmapLinearFilter; _flakes.generateMipmaps = true;
  _flakes.needsUpdate = true;
  return _flakes;
}

function makePaint(color, src, hasUV) {
  const m = new THREE.MeshPhysicalMaterial({
    name: 'paint', color, metalness: 0.55, roughness: 0.32,
    clearcoat: 1, clearcoatRoughness: 0.035, envMapIntensity: 1.0,
  });
  if (src && src.normalMap) { m.normalMap = src.normalMap; m.normalScale.copy(src.normalScale); }
  else if (hasUV) { m.normalMap = flakeNormal(); m.normalScale.set(0.12, 0.12); }
  if (src && src.aoMap) m.aoMap = src.aoMap;
  return m;
}

function tuneMaterial(m) {
  const role = roleOf(m);
  if (role === 'glass') {
    const g = new THREE.MeshPhysicalMaterial({
      name: 'glass', color: 0x0e1418, metalness: 0, roughness: 0.02, transparent: true, opacity: 0.5,
      envMapIntensity: 1.6, depthWrite: false, side: THREE.DoubleSide, specularIntensity: 1, ior: 1.5,
    });
    g.userData.outsideOpacity = 0.5; g.userData.insideOpacity = 0.08;
    return g;
  }
  if (role === 'chrome') return new THREE.MeshStandardMaterial({ name: 'chrome', color: 0xf2f2f2, metalness: 1, roughness: 0.06 });
  if (role === 'mirror') return new THREE.MeshStandardMaterial({ name: 'mirror', color: 0xffffff, metalness: 1, roughness: 0.0 });
  if (role === 'tire') {
    const t = m.clone(); t.name = 'tire';
    t.metalness = 0; t.roughness = Math.max(0.8, t.roughness ?? 0.9); if (!t.map) t.color.setHex(0x1b1b1b);
    if (t.roughnessMap) t.roughness = 1;
    t.envMapIntensity = 0.6;
    return t;
  }
  if (role === 'rim') {
    const r = m.clone(); r.name = 'rim';
    if (!r.metalnessMap && r.metalness < 0.5 && !r.map) { r.metalness = 0.9; r.roughness = Math.min(r.roughness, 0.3); }
    return r;
  }
  // everything else keeps the source material, made a little more physical
  // transmission makes three.js draw the whole opaque scene a second time: use plain transparency instead
  if (m.transmission > 0) { m.transmission = 0; m.transparent = true; m.opacity = Math.min(m.opacity, 0.3); m.depthWrite = false; if (!m.map) m.color.multiplyScalar(0.55); }
  if (m.transparent && m.opacity < 0.98 && !m.map) { m.depthWrite = false; }
  if (m.isMeshStandardMaterial && !m.metalnessMap && m.metalness > 0.95 && m.roughness < 0.05 && !m.map) m.roughness = 0.08;
  return m;
}

function prepareTemplate(scene) {
  const info = {};
  const mats = new Map();
  scene.traverse(o => {
    if (!o.isMesh) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const out = list.map(m => {
      if (!mats.has(m)) mats.set(m, roleOf(m) === 'paint' ? { paintSrc: m } : tuneMaterial(m));
      return mats.get(m);
    });
    o.material = Array.isArray(o.material) ? out : out[0];
  });
  scene.updateMatrixWorld(true);
  return { scene, info };
}

// ---------------------------------------------------------------------------------------------------------
// glow sprites for lamps

let _glowTex = null;
function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.75)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  _glowTex = new THREE.CanvasTexture(c); _glowTex.colorSpace = THREE.SRGBColorSpace;
  return _glowTex;
}
const glowMats = new Map();
function glowMaterial(hex) {
  if (!glowMats.has(hex)) {
    glowMats.set(hex, new THREE.SpriteMaterial({ map: glowTexture(), color: hex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
  }
  return glowMats.get(hex);
}

const _gv = new THREE.Vector3(), _gc = new THREE.Vector3(), _gq = new THREE.Quaternion();
function faceGlow(sprite, dirZ) {
  sprite.onBeforeRender = (renderer, scene, camera) => {
    sprite.getWorldPosition(_gv);
    _gc.setFromMatrixPosition(camera.matrixWorld).sub(_gv).normalize();
    sprite.parent.getWorldQuaternion(_gq);
    const f = _gc.dot(_gv.set(0, 0, dirZ).applyQuaternion(_gq));
    const k = Math.min(1, Math.max(0, (f + 0.05) / 0.4));
    sprite.scale.setScalar((sprite.userData.cur || sprite.userData.base) * k + 1e-4);
  };
}

const LAMP = {
  head: { color: 0xfff4e0, on: 6, glow: 0xfff1d8, glowSize: 0.55 },
  tail: { color: 0xff1a10, dim: 1.2, on: 5, glow: 0xff2010, glowSize: 0.42 },
  brake: { color: 0xff1a10, on: 5, glow: 0xff2010, glowSize: 0.4 },
  signal: { color: 0xff8a00, on: 7, glow: 0xff9a10, glowSize: 0.45 },
  reverse: { color: 0xffffff, on: 4, glow: 0xffffff, glowSize: 0.35 },
};

// shared lamp materials per source material and state, so NPC cars do not each need their own
const lampMatCache = new Map();
function lampMaterial(src, role, level) {
  const key = src.uuid + '|' + role + '|' + level;
  if (!lampMatCache.has(key)) {
    const m = src.clone();
    const L = LAMP[role] || LAMP.tail;
    m.name = 'lamp_' + role + '_' + level;
    if (level > 0) {
      m.emissive = new THREE.Color(L.color);
      m.emissiveIntensity = level;
      if (m.emissiveMap === null && m.map) m.emissiveMap = m.map;
      if (role !== 'reverse' && role !== 'head') m.color.lerp(new THREE.Color(L.color), 0.5);
      m.toneMapped = true;
    } else {
      if (m.emissive) m.emissive.setHex(0);
      m.emissiveIntensity = 0;
    }
    if (level === 0 && role === 'signal') {
      // unlit amber lens, as a real indicator looks by day
      m.color.lerp(new THREE.Color(0xd08020), 0.35);
    } else if (level === 0 && (role === 'tail' || role === 'brake')) {
      m.color.lerp(new THREE.Color(0x8a0d08), 0.35);
    }
    lampMatCache.set(key, m);
  }
  return lampMatCache.get(key);
}

// ---------------------------------------------------------------------------------------------------------
// environment

// A PMREM environment for the cars: a CC0 street HDRI from Poly Haven (wide_street_01, 1K), or the
// RoomEnvironment if that fails. Resolves to the texture; set it as scene.environment or pass it to rig.setEnvMap.
export async function makeEnvironment(renderer, { file = 'env/wide_street_01_1k.hdr' } = {}) {
  const pm = new THREE.PMREMGenerator(renderer);
  try {
    const hdr = await new HDRLoader().loadAsync(MODELS + file + '?v=9');
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const env = pm.fromEquirectangular(hdr).texture;
    env.userData.source = hdr; // the garage shows it as a backdrop
    pm.dispose();
    return env;
  } catch (e) {
    console.warn('car env: HDRI failed, using RoomEnvironment', e);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    return env;
  }
}
export function makeRoomEnvironment(renderer) {
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  pm.dispose();
  return env;
}

// ---------------------------------------------------------------------------------------------------------
// traffic lamps: the atlas body carries a per-vertex lamp code (_lamp: 1 + role * 3 + side, roles head, tail,
// brake, signal, reverse; sides L, R, C). One shared material per lamp state lights the right lenses, so a
// traffic car's body stays one draw whatever its lights are doing.

const atlasLampCache = new Map();
const LAMP_VS = `
attribute float _lamp;
varying float vLampCode;`;
const LAMP_FS = `
varying float vLampCode;
uniform vec4 uLampA;
uniform vec2 uLampB;`;
const LAMP_EMIT = `
{
  float code = floor(vLampCode + 0.5);
  if (code > 0.5) {
    float role = floor((code - 1.0) / 3.0);
    float side = code - 1.0 - role * 3.0;
    vec3 e = vec3(0.0);
    if (role < 0.5) e = vec3(1.0, 0.93, 0.8) * uLampA.x;
    else if (role < 1.5) e = vec3(1.0, 0.05, 0.02) * uLampA.y;
    else if (role < 2.5) e = vec3(1.0, 0.05, 0.02) * uLampA.z;
    else if (role < 3.5) e = vec3(1.0, 0.42, 0.0) * (side < 0.5 ? uLampB.x : (side < 1.5 ? uLampB.y : max(uLampB.x, uLampB.y)));
    else e = vec3(1.0) * uLampA.w;
    totalEmissiveRadiance += e;
  }
}`;
function lampMask(s, blink) {
  let m = 0;
  if (s.headlights) m |= 1 | 2;
  if (s.brake > 0.05) m |= 4;
  if (blink && (s.signal === 2 || s.signal === -1)) m |= 8;
  if (blink && (s.signal === 2 || s.signal === 1)) m |= 16;
  if (s.reverse) m |= 32;
  return m;
}
function atlasLampMaterial(src, mask) {
  const key = src.uuid + ':' + mask;
  let m = atlasLampCache.get(key);
  if (m) return m;
  m = src.clone();
  m.name = 'atlas_lamps_' + mask;
  const U = {
    uLampA: { value: new THREE.Vector4(mask & 1 ? 4 : 0, mask & 4 ? 3 : (mask & 2 ? 0.9 : 0), mask & 4 ? 3 : 0, mask & 32 ? 2.5 : 0) },
    uLampB: { value: new THREE.Vector2(mask & 8 ? 4 : 0, mask & 16 ? 4 : 0) },
  };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>' + LAMP_VS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vLampCode = _lamp;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>' + LAMP_FS)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>' + LAMP_EMIT);
  };
  m.customProgramCacheKey = () => 'car-atlas-lamps';
  atlasLampCache.set(key, m);
  return m;
}

// ---------------------------------------------------------------------------------------------------------
// the cabin: a real one is much darker than outside. Inside the glasshouse (a soft box from the glass) the
// sky and ambient light are cut, so the view out of the windscreen is the brightest thing on screen. The sun
// still comes in through the windows, and the roof shadows the seats (materials cast shadows from both sides).

const CABIN_VS = `
uniform mat4 uWorldToCar;
varying vec3 vCabinPos;`;
const CABIN_FS = `
uniform vec3 uCabinMin;
uniform vec3 uCabinMax;
uniform vec3 uCabinSoft;
uniform float uCabinK;
varying vec3 vCabinPos;`;
const CABIN_LIGHT = `
{
  vec3 cq = smoothstep(uCabinMin, uCabinMin + uCabinSoft, vCabinPos) * (1.0 - smoothstep(uCabinMax - uCabinSoft, uCabinMax, vCabinPos));
  float inside = cq.x * cq.y * cq.z;
  float occ = 1.0 - uCabinK * inside;
  reflectedLight.indirectDiffuse *= occ;
  reflectedLight.indirectSpecular *= occ;
#ifndef CABIN_PAINT
  // the roof and pillars are far thinner than a shadow-map texel, so the sun's shadow on the lining comes and
  // goes in streaks: inside the glasshouse the sun is cut by half, and on the lining and pillars almost wholly
  vec3 e = vec3(0.10, 0.0, 0.10), s2 = vec3(0.06, uCabinSoft.y, 0.10);
  vec3 cq2 = smoothstep(uCabinMin - e, uCabinMin - e + s2, vCabinPos) * (1.0 - smoothstep(uCabinMax + e - s2, uCabinMax + e, vCabinPos));
  float upper = smoothstep(uCabinMax.y - 0.42, uCabinMax.y - 0.22, vCabinPos.y);
  float dk = clamp(inside * 0.45 * min(1.0, uCabinK / 0.6) + cq2.x * cq2.y * cq2.z * upper * 0.92, 0.0, 0.95);
  reflectedLight.directDiffuse *= 1.0 - dk;
  reflectedLight.directSpecular *= 1.0 - dk;
#endif
}`;
function cabinPatch(m, U) {
  if (m.userData.cabin || !(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial)) return;
  m.userData.cabin = true;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(m, sh, r);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>' + CABIN_VS)
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vCabinPos = (uWorldToCar * modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>' + CABIN_FS)
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>' + CABIN_LIGHT);
  };
  const key = m.customProgramCacheKey ? m.customProgramCacheKey() : '';
  m.customProgramCacheKey = () => key + '|car-cabin';
  m.needsUpdate = true;
}

// ---------------------------------------------------------------------------------------------------------
// shadows from a cheap stand-in: the detailed meshes never cast; a low-poly copy does. Its material writes no
// colour and no depth, so the main pass shows nothing, while the shadow pass draws it with its own depth
// material. The player's car uses its traffic model (shrunk 1.2 cm along the normals, so it does not shade the
// detailed paint it sits inside); a traffic car uses its far LOD.

const proxyMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, name: 'shadow_proxy' });
proxyMaterial.shadowSide = THREE.DoubleSide;
function shrunkGeometry(g, d) {
  if (!d) return g;
  const key = 'shrunk' + d;
  if (g.userData[key]) return g.userData[key];
  if (!g.attributes.normal) g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal, a = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    a[i * 3] = p.getX(i) - n.getX(i) * d; a[i * 3 + 1] = p.getY(i) - n.getY(i) * d; a[i * 3 + 2] = p.getZ(i) - n.getZ(i) * d;
  }
  const s = new THREE.BufferGeometry();
  s.setAttribute('position', new THREE.BufferAttribute(a, 3));
  if (g.index) s.setIndex(g.index);
  s.boundingSphere = null;
  g.userData[key] = s;
  return s;
}
function proxyMeshes(node, d) {
  const out = [];
  if (!node) return out;
  node.updateWorldMatrix(true, true);
  node.traverse(o => {
    if (!o.isMesh) return;
    const m = new THREE.Mesh(shrunkGeometry(o.geometry, d), proxyMaterial);
    m.name = 'shadow_proxy';
    // relative to the node (body parts sit at the model origin; wheels at their hub)
    m.matrix.copy(node.matrixWorld).invert().multiply(o.matrixWorld);
    m.matrix.decompose(m.position, m.quaternion, m.scale);
    m.castShadow = true; m.receiveShadow = false;
    out.push(shadowOnly(m));
  });
  return out;
}
// the stand-in is skipped by the main pass (an empty draw range) and drawn in full by the shadow pass
function shadowOnly(m) {
  m.onBeforeRender = () => { m.geometry.drawRange.count = -1; }; // negative: the renderer returns before binding anything
  m.onBeforeShadow = () => { m.geometry.drawRange.count = Infinity; };
  return m;
}
function positionsOnly(g) {
  if (!g.userData.shadowGeo) {
    const s = new THREE.BufferGeometry();
    s.setAttribute('position', g.attributes.position);
    if (g.index) s.setIndex(g.index);
    g.userData.shadowGeo = s;
  }
  return g.userData.shadowGeo;
}
function neverCasts(o) {
  Object.defineProperty(o, 'castShadow', { get: () => false, set: () => {}, configurable: true });
}

// a plain three-spoke steering wheel in dark leather, for models that have none. Its group's +z is the column,
// pointing back and up at the driver; extras.axis says the same for the rig.
function buildSteeringWheel(w) {
  // its own materials: the player's cabin shading gives each car's materials that car's uniforms
  const leather = new THREE.MeshStandardMaterial({ name: 'steer_leather', color: 0x16130f, roughness: 0.62, metalness: 0 });
  const metal = new THREE.MeshStandardMaterial({ name: 'steer_metal', color: 0x2a2a2a, roughness: 0.35, metalness: 0.6 });
  const r = w.r || 0.19, g = new THREE.Group();
  g.name = 'steer';
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.016, 12, 64), leather);
  g.add(rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.045, 24), leather);
  hub.rotation.x = Math.PI / 2; hub.position.z = -0.01; g.add(hub);
  const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.004, 20), metal);
  badge.rotation.x = Math.PI / 2; badge.position.z = 0.014; g.add(badge);
  for (const a of [0, Math.PI, -Math.PI / 2]) { // right, left, down
    const len = r - 0.045;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(len, 0.032, 0.012), leather);
    spoke.position.set(Math.cos(a) * (0.045 + len / 2), Math.sin(a) * (0.045 + len / 2), -0.006);
    spoke.rotation.z = a;
    g.add(spoke);
  }
  const t = THREE.MathUtils.degToRad(w.tilt ?? 24);
  g.position.fromArray(w.pos);
  g.rotation.x = -t;
  g.userData.axis = [0, Math.sin(t), Math.cos(t)];
  g.userData.diameter = 2 * r;
  return g;
}

// ---------------------------------------------------------------------------------------------------------
// the rig

const ORDER = ['FL', 'FR', 'RL', 'RR'];
const _box = new THREE.Box3(), _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const paintCache = new Map(); // npc paints shared by colour

export async function loadCar(id, opts = {}) {
  const spec = byId(id);
  if (!spec) throw new Error('unknown car ' + id);
  const npc = !!opts.npc;
  const file = npc ? (spec.npcFile || spec.file) : spec.file;
  const tpl = await loadTemplate(file);
  let proxyTpl = null;
  if (!npc && spec.npcFile && spec.npcFile !== file && opts.shadowProxy !== false) proxyTpl = await loadTemplate(spec.npcFile).catch(() => null);
  return new CarRig(spec, tpl, { ...opts, npc, proxyTpl });
}

class CarRig {
  constructor(spec, tpl, opts) {
    this.spec = spec; this.npc = opts.npc; this.id = spec.id;
    this.hasInterior = !opts.npc && spec.interior !== false;
    this._owned = []; // materials made for this rig only
    this._beams = [];
    this._t = 0;
    const object = this.object = new THREE.Group();
    object.name = 'car:' + spec.id;
    const model = tpl.scene.clone(true); // shares geometry and (template) materials
    object.add(model);
    this.model = model;
    // traffic files carry a far version (far_body, far_paint): near and far under a THREE.LOD
    const farNodes = model.children.filter(o => /^far_/.test(o.name));
    if (farNodes.length) {
      const far = new THREE.Group(); far.name = 'far';
      for (const n of farNodes) far.add(n);
      const lod = this.lod = new THREE.LOD(); lod.name = 'lod';
      object.remove(model);
      lod.addLevel(model, 0); lod.addLevel(far, opts.farDistance ?? 60);
      object.add(lod);
    }
    // the player's car owns its materials (the cabin shading needs this car's own uniforms)
    if (!this.npc) {
      const own = new Map();
      model.traverse(o => {
        if (!o.isMesh) return;
        const fix = m => { if (m.paintSrc) return m; if (!own.has(m)) own.set(m, m.clone()); return own.get(m); };
        o.material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material);
      });
      this._owned.push(...own.values());
      if (spec.recolor) for (const m of own.values()) {
        const r = spec.recolor[m.name];
        if (!r) continue;
        if (r.color !== undefined) m.color.setHex(r.color);
        if (r.roughness !== undefined) m.roughness = r.roughness;
        if (r.metalness !== undefined) m.metalness = r.metalness;
      }
    }
    this.state = { brake: 0, reverse: false, signal: 0, headlights: false };

    // paint: one material per rig for the player, shared by colour for traffic
    const paintColor = opts.color ?? spec.paint ?? 0x888888;
    this._paintMeshes = [];
    let paintSrc = null;
    object.traverse(o => {
      if (!o.isMesh) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      list.forEach((m, i) => { if (m.paintSrc) { paintSrc = m.paintSrc; this._paintMeshes.push([o, i, !!o.geometry.attributes.uv]); } });
    });
    this._paintSrc = paintSrc;
    this.setPaint(paintColor);

    // wheels: pivot (suspension, steering) > spin > model node
    this.wheels = []; this._w = [];
    for (const k of ORDER) {
      const n = model.getObjectByName('wheel_' + k);
      if (!n) throw new Error(spec.id + ': no wheel_' + k);
      const pos = n.position.clone();
      const pivot = new THREE.Group(); pivot.name = 'pivot_' + k; pivot.position.copy(pos);
      const spin = new THREE.Group(); spin.name = 'spin_' + k;
      n.parent.add(pivot); pivot.add(spin); spin.add(n); n.position.set(0, 0, 0);
      const radius = (n.userData && n.userData.radius) || this._radiusOf(n);
      this.wheels.push({ pos, radius, steer: k[0] === 'F' });
      this._w.push({ pivot, spin, rest: pos.y });
    }

    // dims from the body and wheels
    model.updateMatrixWorld(true);
    _box.makeEmpty();
    model.traverse(o => { if (o.isMesh && !o.name.startsWith('lamp_')) _box.expandByObject(o); });
    const size = _box.getSize(new THREE.Vector3());
    const W = this.wheels;
    // height without aerials and the like: a high percentile of the body's points
    if (tpl.height === undefined) {
      const ys = [];
      model.traverse(o => {
        if (!o.isMesh || o.name.startsWith('lamp_')) return;
        const p = o.geometry.attributes.position, e = o.matrixWorld.elements;
        for (let i = 0; i < p.count; i += 5) ys.push(e[1] * p.getX(i) + e[5] * p.getY(i) + e[9] * p.getZ(i) + e[13]);
      });
      ys.sort((a, b) => a - b);
      tpl.height = ys.length ? ys[Math.floor(ys.length * 0.997)] : _box.max.y;
    }
    this.dims = {
      length: size.z, width: size.x, height: tpl.height,
      wheelbase: Math.abs(W[0].pos.z - W[2].pos.z), track: Math.abs(W[0].pos.x - W[1].pos.x),
      front: -_box.min.z, rear: _box.max.z,
    };

    // steering wheel
    this._steer = null;
    let st = model.getObjectByName('steer');
    if (!st && spec.wheel && !this.npc) {
      st = buildSteeringWheel(spec.wheel); model.add(st);
      st.traverse(o => { if (o.isMesh && !this._owned.includes(o.material)) this._owned.push(o.material); });
    }
    if (st) {
      const ax = st.userData.axis ? new THREE.Vector3().fromArray(st.userData.axis).normalize() : new THREE.Vector3(0, 0.3, 1).normalize();
      this._steer = { node: st, axis: ax, q0: st.quaternion.clone() };
    }

    // mounts
    const d = this.dims;
    const sp = st ? st.position : new THREE.Vector3(-0.37, 0.85, -0.35);
    const eye = (spec.eye ? new THREE.Vector3().fromArray(spec.eye) : sp.clone().add(new THREE.Vector3(0, 0.3, 0.58)));
    this.mounts = {
      driver: eye,
      hood: new THREE.Vector3(0, Math.min(d.height - 0.12, sp.y + 0.38), sp.z - 0.35),
      bumper: new THREE.Vector3(0, 0.55, -d.front - 0.05),
      chase: new THREE.Vector3(0, d.height + 1.5, d.rear + 4.8),
    };

    // lamps
    this._lamps = [];
    this._glow = !this.npc || !!opts.glow;
    this._atlasBody = null;
    model.traverse(o => { if (o.isMesh && o.geometry.attributes._lamp) { this._atlasBody = o; this._atlasSrc = o.material; } });
    this._mask = -1;
    const glowSizeK = Math.max(0.6, Math.min(1.2, d.width / 1.8));
    model.traverse(o => {
      const mm = /^lamp_(head|tail|brake|signal|reverse)_([LRC])/.exec(o.name);
      if (!mm) return;
      const role = mm[1], side = mm[2];
      const meshes = [];
      o.traverse(c => { if (c.isMesh) meshes.push(c); });
      for (const me of meshes) {
        const srcs = Array.isArray(me.material) ? me.material : [me.material];
        me.userData.lampSrc = srcs;
        me.castShadow = false;
      }
      // glow points: per lamp, one per front/rear cluster
      _box.makeEmpty();
      o.updateMatrixWorld(true);
      const pts = { F: new THREE.Box3(), R: new THREE.Box3() };
      for (const me of meshes) {
        const pos = me.geometry.attributes.position;
        _m.copy(model.matrixWorld).invert().multiply(me.matrixWorld);
        for (let i = 0; i < pos.count; i += 3) {
          _v.fromBufferAttribute(pos, i).applyMatrix4(_m);
          pts[_v.z < 0 ? 'F' : 'R'].expandByPoint(_v);
        }
      }
      const glows = [];
      for (const fr of ['F', 'R']) {
        const b = pts[fr];
        if (b.isEmpty()) continue;
        const c = b.getCenter(new THREE.Vector3());
        // signals sit at the outer end of their lens, the rest in its middle
        if (role === 'signal' && side !== 'C') c.x = side === 'L' ? b.min.x + (b.max.x - b.min.x) * 0.3 : b.max.x - (b.max.x - b.min.x) * 0.3;
        c.z += fr === 'F' ? -0.03 : 0.03;
        const L = LAMP[role];
        if (!this._glow) continue;
        const s = new THREE.Sprite(glowMaterial(L.glow));
        s.position.copy(c); s.scale.setScalar(L.glowSize * glowSizeK); s.visible = false;
        s.renderOrder = 10; s.userData.base = L.glowSize * glowSizeK;
        faceGlow(s, fr === 'F' ? -1 : 1);
        model.add(s);
        glows.push(s);
      }
      this._lamps.push({ role, side, meshes, glows, level: -1 });
    });
    // no separate rear signal lens: blink a glow at the outer end of each tail lamp
    for (const side of (this._glow ? ['L', 'R'] : [])) {
      const hasRear = this._lamps.some(l => l.role === 'signal' && l.side === side && l.glows.some(g => g.position.z > 0));
      const tail = this._lamps.find(l => l.role === 'tail' && l.side === side);
      if (!hasRear && tail && tail.glows.length) {
        const t = tail.glows[0];
        const s = new THREE.Sprite(glowMaterial(LAMP.signal.glow));
        s.position.copy(t.position); s.position.x += side === 'L' ? -0.08 : 0.08;
        s.scale.setScalar(LAMP.signal.glowSize * glowSizeK); s.visible = false; s.renderOrder = 10;
        s.userData.base = LAMP.signal.glowSize * glowSizeK; faceGlow(s, 1);
        model.add(s);
        this._lamps.push({ role: 'signal', side, meshes: [], glows: [s], level: -1 });
      }
      // and the front, from the headlight, if the model has no front signal
      const hasFront = this._lamps.some(l => l.role === 'signal' && l.side === side && l.glows.some(g => g.position.z < 0));
      const head = this._lamps.find(l => l.role === 'head' && l.side === side);
      if (!hasFront && head && head.glows.length) {
        const h = head.glows[0];
        const s = new THREE.Sprite(glowMaterial(LAMP.signal.glow));
        s.position.copy(h.position); s.position.x += side === 'L' ? -0.12 : 0.12; s.position.y -= 0.05;
        s.scale.setScalar(LAMP.signal.glowSize * glowSizeK); s.visible = false; s.renderOrder = 10;
        s.userData.base = LAMP.signal.glowSize * glowSizeK; faceGlow(s, -1);
        model.add(s);
        this._lamps.push({ role: 'signal', side, meshes: [], glows: [s], level: -1 });
      }
    }
    // no reverse lens: a small glow inboard of each tail lamp
    if (this._glow && !this._lamps.some(l => l.role === 'reverse')) {
      for (const side of ['L', 'R']) {
        const tail = this._lamps.find(l => l.role === 'tail' && l.side === side);
        if (!tail || !tail.glows.length) continue;
        const s = new THREE.Sprite(glowMaterial(LAMP.reverse.glow));
        s.position.copy(tail.glows[0].position); s.position.x += side === 'L' ? 0.12 : -0.12; s.position.y -= 0.04;
        s.scale.setScalar(LAMP.reverse.glowSize * glowSizeK); s.visible = false; s.renderOrder = 10;
        s.userData.base = LAMP.reverse.glowSize * glowSizeK; faceGlow(s, 1);
        model.add(s);
        this._lamps.push({ role: 'reverse', side, meshes: [], glows: [s], level: -1 });
      }
    }
    // headlight beams for the player's car (two spot lights, always present so turning them on does not
    // change the light count and recompile every shader in the scene)
    if (!this.npc && opts.beams !== false) {
      for (const side of ['L', 'R']) {
        const head = this._lamps.find(l => l.role === 'head' && l.side === side);
        const p = head && head.glows.length ? head.glows[0].position.clone() : new THREE.Vector3(side === 'L' ? -0.6 : 0.6, 0.7, -d.front + 0.1);
        const sl = new THREE.SpotLight(0xfff2dd, 0, 90, 0.42, 0.55, 1.4);
        sl.position.copy(p);
        sl.target.position.set(p.x * 1.4, p.y - 1.2, p.z - 25);
        sl.castShadow = false;
        model.add(sl); model.add(sl.target);
        this._beams.push(sl);
      }
    }

    this._setLamps(true);

    // glass: see-through from the driver's seat, darker from outside (camera position checked as it draws)
    this._glass = [];
    model.traverse(o => {
      if (!o.isMesh) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      if (list.some(m => m.name === 'glass')) this._glass.push(o);
    });
    if (!this.npc && this._glass.length) {
      // own glass material for this rig so its opacity can change
      const own = new Map();
      for (const o of this._glass) {
        const fix = m => { if (m.name !== 'glass') return m; if (!own.has(m)) { const c = m.clone(); this._owned.push(c); own.set(m, c); } return own.get(m); };
        o.material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material);
      }
      this._glassMats = [...own.values()];
      const inside = new THREE.Box3(
        new THREE.Vector3(-d.width / 2 + 0.12, 0.3, -d.front * 0.55), new THREE.Vector3(d.width / 2 - 0.12, d.height - 0.08, d.rear * 0.6));
      const local = new THREE.Vector3();
      const first = this._glass[0];
      first.onBeforeRender = (renderer, scene, camera) => {
        local.setFromMatrixPosition(camera.matrixWorld);
        model.worldToLocal(local);
        const inCar = inside.containsPoint(local);
        for (const m of this._glassMats) m.opacity = inCar ? m.userData.insideOpacity : m.userData.outsideOpacity;
      };
    }

    // the dark cabin (player only)
    if (!this.npc && this._glass.length) {
      const gb = new THREE.Box3();
      for (const o of this._glass) gb.expandByObject(o);
      const U = this._cabinU = {
        uWorldToCar: { value: new THREE.Matrix4() },
        uCabinMin: { value: new THREE.Vector3(gb.min.x + 0.03, 0.12, gb.min.z + 0.02) },
        uCabinMax: { value: new THREE.Vector3(gb.max.x - 0.03, gb.max.y + 0.01, gb.max.z - 0.02) },
        uCabinSoft: { value: new THREE.Vector3(0.14, 0.07, 0.28) },
        uCabinK: { value: spec.cabinDark ?? 0.7 },
      };
      const done = new Set();
      object.traverse(o => {
        if (!o.isMesh || o.name.startsWith('lamp_')) return;
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
          if (done.has(m) || m.name === 'glass' || m.transparent || m.paintSrc) continue;
          done.add(m); cabinPatch(m, U);
          m.shadowSide = THREE.DoubleSide;
        }
      });
      if (this._paint) { this._paint.defines = { ...(this._paint.defines || {}), CABIN_PAINT: '' }; cabinPatch(this._paint, U); this._paint.shadowSide = THREE.DoubleSide; }
    }
    // glass lets the sun in: it never casts a shadow, whatever the game sets on the car's meshes
    for (const o of this._glass) Object.defineProperty(o, 'castShadow', { get: () => false, set: () => {}, configurable: true });

    // shadows: the detailed meshes never cast (whatever the game sets on them); a stand-in does
    object.traverse(o => {
      if (!o.isMesh) return;
      o.receiveShadow = !this.npc;
      neverCasts(o);
    });
    this._proxies = [];
    if (!this.npc && opts.proxyTpl) {
      const src = opts.proxyTpl.scene;
      for (const name of ['body', 'paint', 'chrome']) for (const m of proxyMeshes(src.getObjectByName(name), 0.012)) { model.add(m); this._proxies.push(m); }
      ORDER.forEach((k, i) => { for (const m of proxyMeshes(src.getObjectByName('wheel_' + k), 0.006)) { this._w[i].spin.add(m); this._proxies.push(m); } });
    } else if (this.npc && this.lod && opts.shadows !== false) {
      for (const name of ['far_body', 'far_paint']) {
        const n = object.getObjectByName(name);
        if (!n) continue;
        const ms = []; n.traverse(o => { if (o.isMesh && o.name !== 'shadow_proxy') ms.push(o); });
        for (const o of ms) {
          const m = shadowOnly(new THREE.Mesh(positionsOnly(o.geometry), proxyMaterial)); m.name = 'shadow_proxy';
          m.castShadow = true; m.receiveShadow = false;
          object.add(m); this._proxies.push(m);
        }
      }
    }
    if (!this._proxies.length) {
      // no stand-in: let the detailed body cast after all
      object.traverse(o => { if (o.isMesh && !(o.material && o.material.name === 'glass')) Object.defineProperty(o, 'castShadow', { value: !this.npc || !!opts.shadows, writable: true, configurable: true }); });
    }
    if (this.npc) object.traverse(o => { o.matrixAutoUpdate = true; });
  }

  _radiusOf(n) {
    _box.setFromObject(n);
    return (_box.max.y - _box.min.y) / 2;
  }

  // the lamp materials for the current state
  _setLamps(force) {
    const s = this.state;
    const blink = this._blinkOn || (this._t * 1.5) % 1 < 0.5;
    for (const L of this._lamps) {
      let level = 0;
      if (L.role === 'head') level = s.headlights ? 1 : 0;
      else if (L.role === 'tail') level = s.brake > 0.05 ? 2 : s.headlights ? 1 : 0;
      else if (L.role === 'brake') level = s.brake > 0.05 ? 2 : 0;
      else if (L.role === 'reverse') level = s.reverse ? 1 : 0;
      else if (L.role === 'signal') {
        const want = s.signal === 2 || (s.signal === -1 && L.side === 'L') || (s.signal === 1 && L.side === 'R');
        level = want && blink ? 1 : 0;
      }
      if (level === L.level && !force) continue;
      L.level = level;
      const P = LAMP[L.role];
      const k = L.role === 'tail' ? (level === 2 ? P.on : level === 1 ? P.dim : 0) : (level ? P.on : 0);
      for (const me of L.meshes) {
        const srcs = me.userData.lampSrc;
        const mats = srcs.map(m => lampMaterial(m, L.role, k));
        me.material = Array.isArray(me.material) ? mats : mats[0];
      }
      for (const g of L.glows) {
        g.visible = level > 0;
        const base = g.userData.base || g.scale.x;
        g.userData.base = base;
        g.userData.cur = L.role === 'tail' && level === 1 ? base * 0.6 : base;
        g.scale.setScalar(g.userData.cur);
      }
    }
    for (const b of this._beams) b.intensity = s.headlights ? 60 : 0;
    if (this._atlasBody) {
      const mask = lampMask(s, blink);
      if (mask !== this._mask || force) { this._mask = mask; this._atlasBody.material = atlasLampMaterial(this._atlasSrc, mask); }
    }
  }

  update(dt, s = {}) {
    dt = dt || s.dt || 0;
    this._t += dt;
    // wheels
    const steer = s.steer || 0;
    const W = this.wheels, L = this.dims.wheelbase, T = this.dims.track;
    let aL = steer, aR = steer;
    if (Math.abs(steer) > 1e-4 && L > 0) {
      // Ackermann: the inside wheel turns more
      const R = L / Math.tan(Math.abs(steer));
      const inner = Math.atan(L / Math.max(0.1, R - T / 2)), outer = Math.atan(L / (R + T / 2));
      const sg = Math.sign(steer);
      if (steer > 0) { aL = inner * sg; aR = outer * sg; } else { aR = inner * sg; aL = outer * sg; }
    }
    for (let i = 0; i < 4; i++) {
      const w = this._w[i];
      if (s.wheelSpin) w.spin.rotation.x = -(s.wheelSpin[i] || 0);
      w.pivot.rotation.y = W[i].steer ? (i === 0 ? aL : aR) : 0;
      w.pivot.position.y = w.rest + (s.susp ? (s.susp[i] || 0) : 0);
    }
    // steering wheel about its column
    if (this._steer) {
      _q.setFromAxisAngle(this._steer.axis, s.steeringWheel || 0);
      this._steer.node.quaternion.copy(_q).multiply(this._steer.q0);
    }
    if (this._cabinU) { this.object.updateWorldMatrix(true, false); this._cabinU.uWorldToCar.value.copy(this.object.matrixWorld).invert(); }
    // lights
    const st = this.state;
    this._blinkOn = !!s.blinkOn; // tests: hold the indicators on
    st.brake = s.brake || 0; st.reverse = !!s.reverse; st.signal = s.signal || 0; st.headlights = !!s.headlights;
    this._setLamps(false);
  }

  setPaint(color) {
    const c = new THREE.Color(color);
    this.paintColor = c.getHex();
    if (!this._paintMeshes.length) return;
    let mat;
    if (this.npc) {
      const key = this.id + ':' + c.getHex();
      if (!paintCache.has(key)) paintCache.set(key, makePaint(c, this._paintSrc, this._paintMeshes.some(p => p[2])));
      mat = paintCache.get(key);
    } else {
      if (!this._paint) { this._paint = makePaint(c, this._paintSrc, this._paintMeshes.some(p => p[2])); this._owned.push(this._paint); }
      this._paint.color.copy(c);
      mat = this._paint;
    }
    for (const [o, i] of this._paintMeshes) {
      if (Array.isArray(o.material)) { const a = o.material.slice(); a[i] = mat; o.material = a; } else o.material = mat;
    }
  }

  // a random ordinary colour from the car's list
  randomPaint(rand = Math.random) {
    const p = this.spec.paints || [this.spec.paint];
    this.setPaint(p[Math.floor(rand() * p.length)]);
  }

  // use a given environment on this car's materials (null: follow scene.environment)
  setEnvMap(tex) {
    this.object.traverse(o => {
      if (!o.isMesh) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if ('envMap' in m) { m.envMap = tex; m.needsUpdate = true; } });
    });
  }

  dispose() {
    if (this.object.parent) this.object.parent.remove(this.object);
    for (const m of this._owned) m.dispose();
    for (const b of this._beams) b.dispose();
    this._owned.length = 0;
  }
}

export function carInfo(id) { return byId(id); }
