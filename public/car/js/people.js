// People for Earth Drive: realistic rigged humans (the Microsoft Rocketbox avatar library, MIT licence: adults of
// both sexes, many builds, skin tones and outfits, and children), one Biped skeleton for all, motion-captured
// animations from the same library packed into one small file, and a few made here (drive, jump, get up...).
//
// API (other modules use only this):
//   await People.load(renderer?, camera?)   catalogue + animations + a first few models; shaders built if renderer given
//   People.createPerson(look, { kid, lod: 'auto'|'near'|'far', shadow, far }) -> Person (at once; if the look's model
//       is still loading, a loaded stand-in of the same kind shows until it arrives)
//   People.randomLook(rand = Math.random, { kid, sex }) -> look (plain JSON, storable)
//   People.DEFAULT_LOOK, People.anims (names play() takes), People.catalogue (the models: id, sex, kid, label...)
//   People.preload([looks]) -> Promise (those models loaded)
//   People.env = { ground(x, z, yHint) -> y, collide (collide.js world), cars() -> [{ x, y, z, yaw, len, wid, hgt, vx, vz }] }
//       what a ragdoll lands on and bounces off (peds.js sets it from the drive)
//   People.camera: the camera that decides each person's level of detail
//   People.compile(renderer, scene, camera) -> Promise: shaders for everything loaded so far
//
// A Person: { object (THREE.Group, origin at the feet, facing -z, add it to the scene yourself), look, height (m),
//   kid, play(name, { loop, fade, speed, once, onEnd, startAt }), update(dt) (call every frame), ragdoll(velocity
//   Vector3 m/s, spin Vector3 rad/s?, { low, car }), isRagdoll, restTime (s still while ragdolled), getUp(onDone),
//   setLook(look), setSeated(on), lookAt(worldPoint|null), ik { handL, handR, footL, footR } (world points or null:
//   reach for them after the animation), bone(name) (hips, spine, chest, neck, head, jaw, clavicleL/R, upperArmL/R,
//   forearmL/R, handL/R, thighL/R, calfL/R, footL/R, toeL/R, or a raw Biped name), bonePos(name, out),
//   capture(seconds) (blend from the pose now into what plays next), setLod('near'|'far'|'hidden'|'auto'), dispose() }
// A look: { base (model id), sex 'f'|'m', kid, height (scale, 1 = the model's own), build (-1 thin .. 1 heavy),
//   skin, hairColour, topColour, bottomColour, shoesColour ('#rrggbb' or null for the model's own) }
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { Person, BONES } from './person.js?v=19';
import { buildPoses } from './poses.js?v=19';

const V = '?v=19';
const DIR = new URL('../models/people/', import.meta.url).href;
const DRACO = new URL('../vendor/three/addons/libs/draco/gltf/', import.meta.url).href;

// names play() takes (sex variants are picked by the person)
const ANIMS = ['idle', 'idle2', 'breathe', 'walk', 'stroll', 'walk_fast', 'run', 'sprint', 'limp', 'jump', 'fall', 'stumble',
  'angry', 'angry2', 'shout', 'shout2', 'argue', 'fist', 'what', 'point', 'shrug', 'wave', 'cross_arms', 'phone', 'phone_call', 'talk', 'listen', 'wait', 'cheer', 'scratch_head', 'photo', 'dust_off',
  'sit', 'sit_breathe', 'drive', 'sit_down_L', 'sit_down_R', 'stand_up_L', 'stand_up_R', 'enter_L', 'enter_R', 'exit_L', 'exit_R', 'pulled_out',
  'crouch_in', 'crouch_out', 'crouch', 'getup_front', 'getup_back', 'lie_back', 'lie_front', 'open_door'];

let loader = null, catalogue = null, clips = null, loadP = null;
const bases = new Map(), baseP = new Map();

function gltf() {
  if (loader) return loader;
  const d = new DRACOLoader(); d.setDecoderPath(DRACO);
  loader = new GLTFLoader(); loader.setDRACOLoader(d);
  return loader;
}

export const People = {
  anims: ANIMS,
  catalogue: [],
  env: null,
  camera: null,
  nearDist: 22,
  DEFAULT_LOOK: { base: 'm_adult_08', sex: 'm', kid: false, height: 1, build: 0, skin: null, hairColour: null, topColour: null, bottomColour: null, shoesColour: null },
  ready: false,

  load(renderer, camera) {
    if (camera) this.camera = camera;
    if (loadP) return loadP;
    loadP = (async () => {
      const [cat, bin] = await Promise.all([
        fetch(DIR + 'people.json' + V).then(r => r.json()),
        fetch(DIR + 'anims.bin' + V).then(r => r.arrayBuffer())]);
      catalogue = cat.models; this.catalogue = catalogue;
      clips = parseAnims(bin);
      // a first few: the default look, and one of each kind
      const first = [this.DEFAULT_LOOK.base];
      for (const k of [['f', false], ['m', false], ['f', true], ['m', true]]) { const c = catalogue.find(m => m.sex === k[0] && !!m.kid === k[1] && !first.includes(m.id)); if (c) first.push(c.id); }
      await Promise.all(first.map(id => this.loadBase(id).catch(e => console.warn('people model', id, e))));
      makeClips(this);
      this.ready = true;
      if (renderer) await this.compile(renderer, null, camera).catch(() => {});
      return this;
    })();
    return loadP;
  },

  // shaders for every loaded model, built in the background (in the scene they will be drawn in)
  async compile(renderer, scene, camera) {
    if (!renderer || !renderer.compileAsync) return;
    const g = new THREE.Group();
    for (const b of bases.values()) { const m = this.instance(b, this.DEFAULT_LOOK); g.add(m.root); }
    const cam = camera || this.camera || new THREE.PerspectiveCamera();
    try { await Promise.race([renderer.compileAsync(g, cam, scene || undefined), new Promise(r => setTimeout(r, 8000))]); } catch (e) { console.warn('people compile', e); }
  },

  // Every shader a person can need, built before play: drive.start compiles the scene and then draws one frame behind
  // the loading card, which builds the shadow map's programs for what casts a shadow then (compileAsync does not
  // build those). A few people (one with hair cards, one without, each plain and recoloured, near and far meshes all
  // shown) go into the scene under the ground at `at` for that frame; dispose() takes them out after.
  warmup(scene, at) {
    const g = new THREE.Group(); g.name = 'people-warmup';
    const all = [...bases.values()];
    const hair = all.find(b => b.scene.getObjectByProperty('isSkinnedMesh', true) && hasKind(b, 'hair')) || all[0];
    const bare = all.find(b => !hasKind(b, 'hair')) || null;
    const colours = { skin: '#8a5636', hairColour: '#b48a58', topColour: '#2a4d7a', bottomColour: '#6d5a43', shoesColour: '#f0f0ee' };
    let i = 0;
    for (const b of [hair, bare]) {
      if (!b) continue;
      for (const look of [{ base: b.id }, { base: b.id, ...colours }]) {
        const m = this.instance(b, this.fixLook(look));
        for (const o of [...m.lod0, ...m.lod1]) { o.visible = true; o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
        m.root.position.set((at ? at.x : 0) + (i % 2) * 0.8, (at ? at.y : 0) - 4, (at ? at.z : 0) + (i >> 1) * 0.8);
        g.add(m.root); i++;
      }
    }
    scene.add(g);
    return { group: g, dispose: () => { if (g.parent) g.parent.remove(g); g.traverse(o => { if (o.isSkinnedMesh && o.skeleton && o.skeleton.boneTexture) o.skeleton.dispose(); }); } };
  },

  createPerson(look = this.DEFAULT_LOOK, opts = {}) {
    if (!catalogue) throw new Error('People.load() first');
    const l = { ...look };
    if (opts.kid !== undefined) l.kid = !!opts.kid;
    return new Person(this, l, opts);
  },

  async preload(looks) { await Promise.all((looks || []).map(l => this.loadBase(this.baseFor(this.fixLook(l))).catch(() => null))); },

  // a random person: rand() in [0, 1)
  randomLook(rand = Math.random, o = {}) {
    const kid = !!o.kid;
    let list = catalogue.filter(m => !!m.kid === kid && (!o.sex || m.sex === o.sex) && !m.rare);
    if (!list.length) list = catalogue.filter(m => !!m.kid === kid);
    // the rarer outfits now and then
    if (!kid && rand() < 0.08) { const r = catalogue.filter(m => m.rare && (!o.sex || m.sex === o.sex)); if (r.length) list = r; }
    const m = list[Math.floor(rand() * list.length) % list.length];
    const look = { base: m.id, sex: m.sex, kid: !!m.kid, height: 0.94 + rand() * 0.12, build: Math.round((rand() * 2 - 1) * (rand() < 0.5 ? 0.3 : 0.8) * 100) / 100,
      skin: null, hairColour: null, topColour: null, bottomColour: null, shoesColour: null };
    // some people in other colours than the model's own
    if (m.regions && rand() < 0.45) {
      const pick = a => a[Math.floor(rand() * a.length) % a.length];
      if (m.regions.top && rand() < 0.75) look.topColour = pick(TOPS);
      if (m.regions.bottom && rand() < 0.3) look.bottomColour = pick(BOTTOMS);
    }
    if (m.regions && m.regions.hair && rand() < 0.2) look.hairColour = HAIR[Math.floor(rand() * HAIR.length) % HAIR.length];
    return look;
  },

  // ---- used by Person ------------------------------------------------------------------------------------------
  fixLook(l) {
    const out = { ...this.DEFAULT_LOOK, ...l };
    let m = catalogue && catalogue.find(c => c.id === out.base);
    if (!m && catalogue) {
      const list = catalogue.filter(c => (!out.sex || c.sex === out.sex) && !!c.kid === !!out.kid);
      m = list[0] || catalogue[0];
      out.base = m.id;
    }
    if (m) { out.sex = m.sex; out.kid = !!m.kid; }
    out.height = Math.max(0.85, Math.min(1.15, +out.height || 1));
    out.build = Math.max(-1, Math.min(1, +out.build || 0));
    return out;
  },
  baseFor(look) { return look.base; },
  loaded(id) { return bases.get(id) || null; },
  standIn(look) {
    for (const b of bases.values()) if (b.meta.sex === look.sex && !!b.meta.kid === !!look.kid) return b;
    for (const b of bases.values()) if (!!b.meta.kid === !!look.kid) return b;
    return bases.values().next().value || null;
  },
  loadBase(id) {
    if (bases.has(id)) return Promise.resolve(bases.get(id));
    if (baseP.has(id)) return baseP.get(id);
    const meta = catalogue.find(c => c.id === id);
    if (!meta) return Promise.reject(new Error('no model ' + id));
    const p = gltf().loadAsync(DIR + meta.file + V).then(g => {
      const b = prepBase(meta, g);
      bases.set(id, b); baseP.delete(id);
      return b;
    });
    baseP.set(id, p);
    return p;
  },

  // a copy of a model with its own skeleton (geometry and, unless recoloured, materials shared)
  instance(base, look) {
    const root = cloneSkinned(base.scene);
    const byName = {}, lod0 = [], lod1 = [];
    root.traverse(o => {
      if (o.isBone || o.name === 'Bip01') byName[o.name] = o;
      if (o.isSkinnedMesh) {
        (o.userData.lod === 1 ? lod1 : lod0).push(o);
        o.castShadow = true; o.receiveShadow = true;
      }
    });
    const bones = {};
    for (const k in BONES) bones[k] = byName[BONES[k]] || null;
    const blendBones = base.blendNames.map(n => byName[n]).filter(Boolean);
    recolour(base, look, lod0, lod1);
    return { root, byName, bones, lod0, lod1, blendBones };
  },

  applyBuild(person, build) {
    // a heavier or slimmer build: the torso and limbs wider across (each bone's own across axes)
    const k = build || 0;
    for (const [n, s] of [['spine', 0.10], ['spine1', 0.13], ['chest', 0.09], ['thighL', 0.12], ['thighR', 0.12], ['upperArmL', 0.1], ['upperArmR', 0.1], ['neck', 0.06]]) {
      const b = person.bone(n), ax = person.base.along[BONES[n]];
      if (!b || ax === undefined) continue;
      const f = 1 + k * s;
      b.scale.set(ax === 0 ? 1 : f, ax === 1 ? 1 : f, ax === 2 ? 1 : f);
    }
    // the scaled bones' children back to their own size along (the limbs below keep their length)
    for (const n of ['calfL', 'calfR', 'forearmL', 'forearmR', 'neck', 'clavicleL', 'clavicleR']) {
      const b = person.bone(n); if (!b || !b.parent) continue;
      const ps = b.parent.scale;
      b.scale.set(1 / ps.x, 1 / ps.y, 1 / ps.z);
    }
  },

  clipFor(name, person) {
    if (!clips) return null;
    const sx = person.look.sex === 'f' ? '.f' : '.m';
    return clips.get(name + sx) || clips.get(name) || clips.get(name + (sx === '.f' ? '.m' : '.f')) || null;
  },
  clip(name, sex = 'm') { return clips ? (clips.get(name + '.' + sex) || clips.get(name)) : null; },
  release() {}
};

function hasKind(b, kind) { let f = false; b.scene.traverse(o => { if (o.isSkinnedMesh && o.userData.kind === kind) f = true; }); return f; }

// shirt, trouser and hair colours people really wear
const TOPS = ['#1d2433', '#f2f2ee', '#a01c22', '#2a4d7a', '#3d5a3a', '#6b6f75', '#c9a227', '#7a2e5a', '#d86a2b', '#101010', '#8fb4d9', '#e7c9c1', '#4b3a2a', '#2e8b88'];
const BOTTOMS = ['#1b2433', '#262626', '#3b4a63', '#6d5a43', '#8a8f96', '#1a1a1a', '#4a3a2c', '#c2b49a'];
const HAIR = ['#1a1410', '#2c1f16', '#4a3020', '#6e4a2c', '#a07850', '#c9a56a', '#8a8a86', '#d8d4cc', '#7a2c1c'];

// ---- models -----------------------------------------------------------------------------------------------------
function prepBase(meta, g) {
  const scene = g.scene;
  const byName = {};
  scene.traverse(o => { byName[o.name] = o; });
  // which meshes are the near and far versions (Blender's 'body' and 'lod1' objects)
  scene.traverse(o => {
    if (!o.isSkinnedMesh) return;
    let p = o, lod = 0;
    while (p) { if (p.name === 'lod1' || /^lod1/.test(p.name)) { lod = 1; break; } p = p.parent; }
    o.userData.lod = lod;
    const m = o.material;
    const kind = /hair/.test(m.name) ? 'hair' : /head/.test(m.name) ? 'head' : 'body';
    o.userData.kind = kind;
    if (!m.userData.prepped) {
      m.userData.prepped = true; m.userData.kind = kind;
      if (kind === 'hair') {
        m.transparent = false; m.alphaTest = 0.45; m.alphaToCoverage = true; m.side = THREE.DoubleSide; m.depthWrite = true;
      }
      m.envMapIntensity = kind === 'body' ? 0.5 : 0.35;
      if (m.map) m.map.anisotropy = 4;
    }
  });
  // which way each bone's length runs in its own frame (for the build): the axis to its first bone child
  const along = {};
  scene.traverse(o => {
    if (!o.isBone) return;
    const c = o.children.find(ch => ch.isBone);
    if (!c) return;
    const p = c.position, a = [Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)];
    along[o.name] = a.indexOf(Math.max(...a));
  });
  // the hips' height against the animations' (captured on adults: a man's hips 0.895 m up, a woman's 0.923 m)
  const root = byName.Bip01;
  const hipScale = root ? root.position.y / (meta.sex === 'f' ? 0.923 : 0.895) : 1;
  // the blink: the upper lids down and the lower lids up a little, as offsets of the lid bones' positions
  const blink = [];
  for (const s of ['L', 'R']) {
    const t = byName['Bip01_' + s + 'EyeBlinkTop'], b = byName['Bip01_' + s + 'EyeBlinkBottom'];
    if (t && b) {
      const d = new THREE.Vector3().subVectors(b.position, t.position);
      blink.push(['Bip01_' + s + 'EyeBlinkTop', d.clone().multiplyScalar(0.75)], ['Bip01_' + s + 'EyeBlinkBottom', d.clone().multiplyScalar(-0.1)]);
    }
  }
  const blendNames = [];
  scene.traverse(o => { if ((o.isBone || o.name === 'Bip01') && !/Finger|Eye|Mouth|lip|Lip|Cheek|brow|Caninus|Masseter|Tongue|Nose|Jaw/.test(o.name)) blendNames.push(o.name); });
  return { id: meta.id, meta, scene, along, hipScale, blink, blendNames, mats: new Map() };
}

// ---- recolouring --------------------------------------------------------------------------------------------------
// The models' textures with a region mask (red: top, green: bottom, blue: shoes, alpha: skin) and the hair's own
// picture: a chosen colour replaces a region's, keeping the cloth's folds and shading (its brightness against the
// region's mean). A look with no colours shares the model's own materials.
const COLOR_KEYS = ['skin', 'hairColour', 'topColour', 'bottomColour', 'shoesColour'];
function recolour(base, look, lod0, lod1) {
  const meta = base.meta;
  if (!meta.regions || !COLOR_KEYS.some(k => look[k])) return;
  const key = COLOR_KEYS.map(k => look[k] || '').join('|');
  let set = base.mats.get(key);
  if (!set) {
    set = new Map();
    base.mats.set(key, set);
    if (base.mats.size > 24) { const first = base.mats.keys().next().value; if (first !== key) base.mats.delete(first); }
  }
  for (const o of [...lod0, ...lod1]) {
    const src = o.material;
    let m = set.get(src);
    if (!m) { m = makeRecoloured(base, src, look); set.set(src, m); }
    o.material = m;
  }
}

let maskTex = new Map();
function makeRecoloured(base, src, look) {
  const meta = base.meta, kind = src.userData.kind;
  const R = meta.regions;
  const m = src.clone();
  m.userData = { ...src.userData, recol: true };
  const lin = hex => new THREE.Color(hex); // (three's colours are already in the linear working space)
  const u = {
    uMask: { value: null },
    uT0: { value: new THREE.Vector4(0, 0, 0, 0) }, uT1: { value: new THREE.Vector4(0, 0, 0, 0) }, uT2: { value: new THREE.Vector4(0, 0, 0, 0) }, uT3: { value: new THREE.Vector4(0, 0, 0, 0) },
    uA0: { value: new THREE.Vector3(1, 1, 1) }, uA1: { value: new THREE.Vector3(1, 1, 1) }, uA2: { value: new THREE.Vector3(1, 1, 1) }, uA3: { value: new THREE.Vector3(1, 1, 1) }
  };
  // channel i: 0 top, 1 bottom, 2 shoes, 3 skin (body); head: 3 skin, 0 hair painted on the scalp; hair: all hair
  const set = (i, want, avg) => { if (!want || !avg) return; const c = lin(want); u['uT' + i].value.set(c.r, c.g, c.b, 1); const a = lin(avg); u['uA' + i].value.set(Math.max(0.02, a.r), Math.max(0.02, a.g), Math.max(0.02, a.b)); };
  if (kind === 'body') { set(0, look.topColour, R.top); set(1, look.bottomColour, R.bottom); set(2, look.shoesColour, R.shoes); set(3, look.skin, R.skin); }
  else if (kind === 'head') { set(3, look.skin, R.skin); set(0, look.hairColour, R.hair); }
  else { set(0, look.hairColour, R.hair); }
  const maskFile = kind === 'body' ? meta.mask : kind === 'head' ? meta.headMask : null;
  if (maskFile) {
    let t = maskTex.get(maskFile);
    if (!t) { t = new THREE.TextureLoader().load(DIR + maskFile + V); t.flipY = false; t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = true; maskTex.set(maskFile, t); }
    u.uMask.value = t;
  }
  const hasMask = !!maskFile, whole = kind === 'hair';
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      {
        vec4 rm = ${hasMask ? 'texture2D(uMask, vMapUv)' : whole ? 'vec4(1.0, 0.0, 0.0, 1.0)' : 'vec4(0.0, 0.0, 0.0, 1.0)'};
        vec3 c = diffuseColor.rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        vec3 o = c;
        if (uT0.w > 0.5) o = mix(o, uT0.rgb * clamp(l / max(0.02, dot(uA0, vec3(0.2126, 0.7152, 0.0722))), 0.0, 3.0), rm.r);
        if (uT1.w > 0.5) o = mix(o, uT1.rgb * clamp(l / max(0.02, dot(uA1, vec3(0.2126, 0.7152, 0.0722))), 0.0, 3.0), rm.g);
        if (uT2.w > 0.5) o = mix(o, uT2.rgb * clamp(l / max(0.02, dot(uA2, vec3(0.2126, 0.7152, 0.0722))), 0.0, 3.0), rm.b);
        if (uT3.w > 0.5) o = mix(o, c * uT3.rgb / uA3, 1.0 - rm.a);
        diffuseColor.rgb = o;
      }`).replace('#include <common>', `#include <common>
      uniform sampler2D uMask; uniform vec4 uT0, uT1, uT2, uT3; uniform vec3 uA0, uA1, uA2, uA3;`);
  };
  m.customProgramCacheKey = () => 'person-recol-' + (hasMask ? 'm' : whole ? 'w' : 'n');
  return m;
}

// ---- animations ---------------------------------------------------------------------------------------------------
// anims.bin: u32 header length, header JSON { bones, clips: [{ name, dur, tracks: [[bone, 'q'|'p', frames, offset]] }] },
// then the keys: quaternions as int16 (x 32767), positions as float32, frames evenly spread over the clip
function parseAnims(buf) {
  const dv = new DataView(buf);
  const hl = dv.getUint32(0, true);
  const H = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl)));
  const base = 4 + hl;
  const out = new Map();
  for (const c of H.clips) {
    const tracks = [];
    for (const [bi, kind, n, off] of c.tracks) {
      const times = new Float32Array(n);
      for (let i = 0; i < n; i++) times[i] = n > 1 ? c.dur * i / (n - 1) : 0;
      const name = H.bones[bi];
      if (kind === 'q') {
        const src = new Int16Array(buf, base + off, n * 4), v = new Float32Array(n * 4);
        for (let i = 0; i < n * 4; i++) v[i] = src[i] / 32767;
        tracks.push(new THREE.QuaternionKeyframeTrack(name + '.quaternion', times, v));
      } else {
        const v = new Float32Array(buf.slice(base + off, base + off + n * 12));
        tracks.push(new THREE.VectorKeyframeTrack(name + '.position', times, v));
      }
    }
    const clip = new THREE.AnimationClip(c.name, c.dur, tracks);
    clip.userData = { once: !!c.once };
    out.set(c.name, clip);
  }
  return out;
}

// the clips made here from the captured ones: poses reached by turning bones in the body's own frame
function makeClips(P) {
  const ref = bases.values().next().value;
  if (!ref) return;
  const alias = (name, src, once) => { for (const s of ['.m', '.f']) { const c = clips.get(src + s) || clips.get(src); if (c && !clips.has(name + s)) { const k = c.clone(); k.name = name + s; k.userData = { once: once ?? c.userData.once }; clips.set(name + s, k); } } };
  try { buildPoses(P, bases, clips); } catch (e) { console.warn('people poses', e); }
  // anything not made falls back on a captured one
  alias('drive', 'sit'); alias('enter_L', 'sit_down_L', true); alias('enter_R', 'sit_down_R', true); alias('fall', 'stumble', true);
  alias('exit_L', 'stand_up_L', true); alias('exit_R', 'stand_up_R', true); alias('pulled_out', 'stand_up_L', true);
  alias('getup_front', 'crouch_out', true); alias('getup_back', 'crouch_out', true); alias('jump', 'idle'); alias('fall', 'idle'); alias('stumble', 'idle');
  alias('fist', 'shout'); alias('what', 'shrug'); alias('cross_arms', 'angry'); alias('lie_back', 'idle'); alias('lie_front', 'idle');
  alias('point', 'shout'); alias('open_door', 'idle', true);
}
