// The rider: a rigged Rocketbox person (MIT) in ski clothes, with skis, bindings, boots, poles, a helmet and goggles
// built here, posed every frame by a small inverse-kinematics solver:
//   - the skis are placed first (stance, edge angle, butter press, the grab or position's tweak), each a rigid frame
//   - the pelvis goes above the boots at the crouch's height, leaning into turns, the chest and head on top
//   - the legs reach the boots (two-bone IK, knees over the skis), the arms reach poles or the grab point on a ski
//     (palm on the edge, fingers round it), and a ski is pulled up to the hand when the hand cannot reach it
// Grabs are data (GRABS): which hand, which ski, where along it (tail -1 .. tip +1), which edge, and the skis' and
// body's shape, taken from how freeskiers define them (Backcountry Access "Ski Tricks 101", Red Bull, the NBC
// Olympics glossary). Positions without a grab (daffy, spread eagle...) are in the same table.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clamp } from './noise.js?v=5';

const V = () => new THREE.Vector3(), Q = () => new THREE.Quaternion();
const _p = V(), _s = V(), _q = Q(), _q2 = Q(), _m = new THREE.Matrix4(), _a = V(), _b = V(), _c = V();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

export const SKI = { len: 1.78, waist: 0.092, tip: 0.118, thick: 0.017, stack: 0.03 };

// ---- grabs and positions ------------------------------------------------------------------------------------------
// skier frame: +X left, +Y up, +Z forward. 'L'/'R' are the skier's left and right.
// hands: [hand, ski, at (-1 tail .. +1 tip), edge 'out' | 'in' | 'end']
// ski: { L: [dx, dy, dz, yaw, pitch, roll], R: [...] }  (pitch < 0 lifts the tip, yaw > 0 turns the tip left)
// tuck: how far the knees come up (0..1), lean: chest forward (rad), twist: chest yaw (+ left), side: chest roll (+ left)
export const GRABS = {
  safety:    { name: 'Safety', hands: [['R', 'R', 0, 'out']], arms: 'out', ski: { L: [-0.03, 0.04, 0.08, 0.02, -0.06, 0], R: [0.03, 0, 0.08, -0.02, -0.06, 0] }, tuck: 0.55, lean: 1.15, twist: 0.15, side: 0.3 },
  mute:      { name: 'Mute', hands: [['L', 'R', 0.3, 'out']], arms: 'out', ski: { L: [-0.04, -0.1, 0, -0.3, 0.1, 0], R: [0.14, 0.1, 0.1, 0.6, -0.7, -0.2] }, tuck: 0.55, lean: 0.95, twist: -0.4, side: -0.3 },
  japan:     { name: 'Japan', hands: [['R', 'L', 0, 'in']], arms: 'up', ski: { L: [-0.08, 0.22, -0.1, -0.4, 0.15, -0.15], R: [0.04, -0.15, 0.18, 0.3, 0.45, 0] }, tuck: 0.55, lean: 1.1, twist: 0.35, side: 0.3 },
  tail:      { name: 'Tail', hands: [['R', 'R', -0.85, 'out']], arms: 'up', ski: { L: [0, 0.05, -0.2, -0.05, 0.7, 0], R: [0, 0.05, -0.2, 0.05, 0.75, 0] }, tuck: 0.35, lean: 0.3, twist: -0.45, side: 0.3 },
  nose:      { name: 'Nose', hands: [['R', 'R', 0.94, 'end']], arms: 'out', ski: { L: [0, -0.03, 0.26, 0.04, -0.8, 0], R: [0, -0.03, 0.27, -0.04, -0.82, 0] }, tuck: 0.25, lean: 1.4, twist: 0.1, side: 0.25 },
  truck:     { name: 'Truck Driver', hands: [['L', 'L', 0.35, 'out'], ['R', 'R', 0.35, 'out']], ski: { L: [-0.02, 0, 0.08, 0.05, -0.95, 0], R: [0.02, 0, 0.08, -0.05, -0.95, 0] }, tuck: 0.6, lean: 0.7, twist: 0, side: 0 },
  critical:  { name: 'Critical', hands: [['L', 'R', 0.3, 'in']], arms: 'up', ski: { L: [-0.04, -0.18, -0.04, -0.15, 0.35, 0], R: [0.12, 0.1, 0.06, 0.35, -0.95, -0.1] }, tuck: 0.55, lean: 0.65, twist: -0.3, side: -0.25 },
  octo:      { name: 'Octograb', hands: [['R', 'R', 0.85, 'end'], ['L', 'L', -0.85, 'out']], ski: { L: [-0.04, -0.05, -0.3, -0.15, 0.45, 0], R: [0.04, 0, 0.2, 0.2, -0.85, 0] }, tuck: 0.45, lean: 0.5, twist: 0.1, side: 0 },
  blunt:     { name: 'Blunt', hands: [['R', 'R', -1, 'end']], arms: 'up', ski: { L: [0, 0.05, -0.2, -0.05, 0.8, 0], R: [0, 0.08, -0.22, 0.08, 0.85, 0] }, tuck: 0.35, lean: 0.25, twist: -0.55, side: 0.35 },
  stalefish: { name: 'Stalefish', hands: [['R', 'L', -0.75, 'out']], arms: 'out', ski: { L: [-0.02, 0, -0.15, 1.15, 0.35, 0], R: [-0.04, 0, 0.1, 1.15, 0.3, 0] }, tuck: 0.5, lean: 0.35, twist: -0.25, side: 0.35 },
  bowarrow:  { name: 'Bow and Arrow', hands: [['R', 'R', 0.9, 'end'], ['L', 'L', 0.4, 'out']], ski: { L: [0.12, 0.2, 0, 0.15, -1, -0.2], R: [-0.02, -0.12, 0.3, -0.08, -0.6, 0] }, tuck: 0.45, lean: 0.75, twist: 0.1, side: 0.1 },
  dubtail:   { name: 'Double Tail', hands: [['L', 'L', -0.85, 'out'], ['R', 'R', -0.85, 'out']], ski: { L: [0.02, 0.05, -0.2, -0.08, 0.7, 0], R: [-0.02, 0.05, -0.2, 0.08, 0.7, 0] }, tuck: 0.35, lean: 0.3, twist: 0, side: 0 },
  seatbelt:  { name: 'Seatbelt', hands: [['L', 'R', -0.85, 'out']], arms: 'up', ski: { L: [0.03, 0.02, -0.02, 0.05, 0.1, 0], R: [-0.08, 0, 0.2, 0.25, 0.65, 0] }, tuck: 0.4, lean: 0.55, twist: -0.8, side: -0.25 },
  // positions
  daffy:     { name: 'Daffy', pos: true, hands: [], arms: 'wide', ski: { L: [0, -0.05, 0.5, 0, -1, 0], R: [0, -0.12, -0.5, 0, 0.85, 0] }, tuck: 0.05, lean: 0.05, twist: 0, side: 0 },
  spread:    { name: 'Spread Eagle', pos: true, hands: [], arms: 'up', ski: { L: [0.48, 0.25, 0, 0.25, -0.85, 0.3], R: [-0.48, 0.25, 0, -0.25, -0.85, -0.3] }, tuck: 0.15, lean: 0.1, twist: 0, side: 0 },
  backscratch: { name: 'Backscratcher', pos: true, hands: [], arms: 'up', ski: { L: [0.04, 0.2, -0.38, 0, 1.2, 0], R: [-0.04, 0.2, -0.38, 0, 1.2, 0] }, tuck: 0.35, lean: -0.1, twist: 0, side: 0 },
  ironcross: { name: 'Iron Cross', pos: true, hands: [], arms: 'wide', ski: { L: [0.06, 0.05, -0.05, -0.75, 0.15, 0], R: [-0.06, 0, -0.05, 0.75, 0.15, 0] }, tuck: 0.5, lean: 0.6, twist: 0, side: 0 },
};

// ---- gear -------------------------------------------------------------------------------------------------------------
function skiGeometry() {
  // a lofted twin-tip: sidecut, rocker at both ends, a thin wedge-shaped core, base and top separate groups
  const N = 48, L = SKI.len, half = L / 2;
  const top = [], base = [], side = [];
  const prof = (t) => {                      // t in -1..1
    const a = Math.abs(t);
    const w = (SKI.waist + (SKI.tip - SKI.waist) * Math.pow(a, 2.2)) * (a > 0.93 ? Math.sqrt(Math.max(0, 1 - ((a - 0.93) / 0.07) ** 2)) * 0.95 + 0.05 : 1);
    const rise = a > 0.78 ? Math.pow((a - 0.78) / 0.22, 2.1) * 0.075 : 0;
    const th = SKI.thick * (0.45 + 0.55 * (1 - a * a));
    return { w: Math.max(0.006, w), rise, th };
  };
  const pos = [], uv = [], idx = [], grp = [];
  const ring = [];
  for (let i = 0; i <= N; i++) {
    const t = -1 + 2 * i / N, z = t * half, p = prof(t);
    const yb = p.rise, yt = p.rise + p.th, hw = p.w / 2;
    // 4 corners: base left, base right, top right, top left
    ring.push(pos.length / 3);
    pos.push(hw, yb, z, -hw, yb, z, -hw, yt, z, hw, yt, z);
    uv.push(0, i / N, 1, i / N, 1, i / N, 0, i / N);
  }
  for (let i = 0; i < N; i++) {
    const a = ring[i], b = ring[i + 1];
    // top (corners 2,3), base (0,1), then the two sides; wound to face outwards
    idx.push(a + 3, a + 2, b + 3, a + 2, b + 2, b + 3);
    idx.push(a + 0, b + 0, a + 1, a + 1, b + 0, b + 1);
    idx.push(a + 0, a + 3, b + 0, a + 3, b + 3, b + 0);
    idx.push(a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  // groups: top 0, base 1, sides 2 (6 indices each per kind per section)
  g.clearGroups();
  const tri = [];
  for (let i = 0; i < N; i++) tri.push([i * 24, 6, 0], [i * 24 + 6, 6, 1], [i * 24 + 12, 12, 2]);
  // reorder index by group
  const ix = g.index.array, sorted = [], counts = [0, 0, 0];
  for (const k of [0, 1, 2]) for (const [s, n, gk] of tri) if (gk === k) { for (let j = 0; j < n; j++) sorted.push(ix[s + j]); counts[k] += n; }
  g.setIndex(sorted);
  g.addGroup(0, counts[0], 0); g.addGroup(counts[0], counts[1], 1); g.addGroup(counts[0] + counts[1], counts[2], 2);
  g.computeVertexNormals();
  return g;
}
function topsheet(colA, colB) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 512;
  const x = c.getContext('2d');
  const gr = x.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, colA); gr.addColorStop(0.5, colB); gr.addColorStop(1, colA);
  x.fillStyle = gr; x.fillRect(0, 0, 64, 512);
  x.fillStyle = 'rgba(255,255,255,0.9)'; for (let i = 0; i < 7; i++) x.fillRect(0, 120 + i * 40, 64, 6 + (i % 3) * 3);
  x.fillStyle = 'rgba(10,10,14,0.85)'; x.fillRect(26, 40, 12, 432);
  x.save(); x.translate(32, 256); x.rotate(-Math.PI / 2); x.font = 'bold italic 34px "Barlow Condensed", Arial Narrow, sans-serif'; x.textAlign = 'center'; x.fillStyle = '#fff'; x.fillText('LZ  PARK  178', 0, 12); x.restore();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function makeSki(colA, colB) {
  const g = skiGeometry();
  const mats = [
    new THREE.MeshStandardMaterial({ map: topsheet(colA, colB), roughness: 0.35, metalness: 0.05 }),
    new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.25, metalness: 0.1 }),
    new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.3, metalness: 0.8 }),
  ];
  const ski = new THREE.Mesh(g, mats); ski.castShadow = true; ski.name = 'ski';
  // binding: toe piece and heel piece
  const bm = new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.45, metalness: 0.4 });
  const am = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.4, metalness: 0.3 });
  const toe = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.04, 0.09), bm); toe.position.set(0, SKI.thick + 0.022, 0.17);
  const heel = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.055, 0.11), bm); heel.position.set(0, SKI.thick + 0.03, -0.17);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, 0.42), am); plate.position.set(0, SKI.thick + 0.006, 0);
  const brk = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.01, 0.06), bm); brk.position.set(0, SKI.thick + 0.012, -0.1);
  for (const m of [toe, heel, plate, brk]) { m.castShadow = true; ski.add(m); }
  return ski;
}
function makeBoot(col) {
  // a ski boot's lower shell (on the ski) and its cuff (on the shin)
  const shellM = new THREE.MeshStandardMaterial({ color: col, roughness: 0.35, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.6 });
  const lower = new THREE.Group();
  const sole = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.03, 0.31), dark); sole.position.set(0, 0.015, 0.005);
  const shell = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.17, 4, 10), shellM); shell.rotation.x = Math.PI / 2; shell.scale.set(1, 1, 0.95); shell.position.set(0, 0.07, 0.02);
  const instep = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), shellM); instep.scale.set(0.95, 0.9, 1.2); instep.position.set(0, 0.1, -0.04);
  const buckle1 = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.012, 0.018), dark); buckle1.position.set(0, 0.125, 0.04);
  for (const m of [sole, shell, instep, buckle1]) { m.castShadow = true; lower.add(m); }
  const cuff = new THREE.Group();
  const c1 = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.062, 0.2, 12, 1, true), shellM); c1.castShadow = true; cuff.add(c1);
  const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.035, 12, 1, true), dark); strap.position.y = 0.085; cuff.add(strap);
  shellM.side = THREE.DoubleSide;
  return { lower, cuff };
}
function makePole() {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.006, 1.08, 8), new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 0.85, roughness: 0.3 }));
  shaft.position.y = -0.56; g.add(shaft);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.014, 0.14, 10), new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.7 }));
  grip.position.y = -0.03; g.add(grip);
  const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.008, 12), new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.6 }));
  basket.position.y = -1.0; g.add(basket);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
function makeHelmet(col, lens) {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.56), new THREE.MeshStandardMaterial({ color: col, roughness: 0.42, metalness: 0.05 }));
  shell.scale.set(0.118, 0.13, 0.142); g.add(shell);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 6, 24), new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.7 }));
  rim.rotation.x = Math.PI / 2; rim.scale.set(0.117, 0.141, 0.12); rim.position.y = -0.012; g.add(rim);
  // goggles: a curved lens with a mirror coating and a strap round the helmet
  const lensG = new THREE.SphereGeometry(1, 20, 8, -Math.PI * 0.34, Math.PI * 0.68, Math.PI * 0.39, Math.PI * 0.24);
  const lensM = new THREE.MeshStandardMaterial({ color: lens, metalness: 1.0, roughness: 0.08, envMapIntensity: 1.6 });
  const lensMesh = new THREE.Mesh(lensG, lensM); lensMesh.scale.set(0.118, 0.17, 0.108); lensMesh.rotation.y = 0; lensMesh.position.set(0, -0.02, 0.0); g.add(lensMesh);
  const frame = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 5, 26, Math.PI * 0.7), new THREE.MeshStandardMaterial({ color: 0x111215, roughness: 0.6 }));
  frame.rotation.set(Math.PI / 2, 0, Math.PI * 0.15 + Math.PI / 2); frame.scale.set(0.12, 0.11, 0.13); frame.position.y = -0.03; g.add(frame);
  const strap = new THREE.Mesh(new THREE.TorusGeometry(1, 0.08, 4, 28), new THREE.MeshStandardMaterial({ color: 0x23252a, roughness: 0.8 }));
  strap.rotation.x = Math.PI / 2; strap.scale.set(0.121, 0.146, 0.18); strap.position.y = 0.0; g.add(strap);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.layers.set(1); } });
  return g;
}

// ---- the outfit: recolour the model's clothes by its region mask, gloves found by skin weights -------------------------
async function regionMeans(tex, maskUrl) {
  const img = tex.image, m = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = maskUrl; });
  const S = 128, c = document.createElement('canvas'); c.width = S; c.height = S; const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, S, S); const a = x.getImageData(0, 0, S, S).data;
  x.clearRect(0, 0, S, S); x.drawImage(m, 0, 0, S, S); const b = x.getImageData(0, 0, S, S).data;
  const sum = [0, 0, 0], n = [0, 0, 0];
  for (let i = 0; i < a.length; i += 4) {
    const l = (0.2126 * (a[i] / 255) ** 2.2 + 0.7152 * (a[i + 1] / 255) ** 2.2 + 0.0722 * (a[i + 2] / 255) ** 2.2);
    for (let k = 0; k < 3; k++) if (b[i + k] > 128) { sum[k] += l; n[k]++; }
  }
  return sum.map((s, k) => n[k] ? s / n[k] : 0.2);
}

export class Rig {
  constructor() {
    this.root = new THREE.Group(); this.root.name = 'rider';          // stays at the origin: holds the body and the gear
    this.body = new THREE.Group(); this.body.name = 'body'; this.root.add(this.body);   // at the feet, in the body's frame
    this.ready = false;
    this.p = {};          // smoothed pose parameters
    this.skiL = null; this.skiR = null;
  }
  async load(id, opts = {}) {
    const loader = new GLTFLoader();
    const draco = new DRACOLoader(); draco.setDecoderPath('/car/vendor/three/addons/libs/draco/'); loader.setDRACOLoader(draco);
    const gl = await loader.loadAsync('./models/' + id + '.glb?v=5');
    const model = gl.scene; this.model = model;
    this.outfit = Object.assign({ jacket: '#d2462f', pants: '#1f2a36', gloves: '#16181c', helmet: '#f2f2ef', lens: '#ff8a2a', boots: '#e9eaec', skiA: '#0d1b2a', skiB: '#ff6a13' }, opts.outfit || {});
    this.wrap = new THREE.Group(); this.wrap.add(model); this.body.add(this.wrap);
    const bones = {};
    model.traverse(o => { if (o.isBone || /^Bip01/.test(o.name)) bones[o.name] = o; });
    this.bones = bones;
    const B = n => bones['Bip01_' + n] || bones['Bip01 ' + n] || bones[n];
    this.b = {
      root: bones.Bip01, pelvis: B('Pelvis'), spine: B('Spine'), spine1: B('Spine1'), chest: B('Spine2'), neck: B('Neck'), head: B('Head'),
      clL: B('L_Clavicle'), uaL: B('L_UpperArm'), faL: B('L_Forearm'), haL: B('L_Hand'),
      clR: B('R_Clavicle'), uaR: B('R_UpperArm'), faR: B('R_Forearm'), haR: B('R_Hand'),
      thL: B('L_Thigh'), caL: B('L_Calf'), ftL: B('L_Foot'), toL: B('L_Toe0'),
      thR: B('R_Thigh'), caR: B('R_Calf'), ftR: B('R_Foot'), toR: B('R_Toe0'),
    };
    // meshes: keep the detailed one, hide the far copy and the hair (under the helmet)
    const skinned = [];
    model.traverse(o => { if (o.isSkinnedMesh) skinned.push(o); });
    let bodyMat = null;
    for (const o of skinned) {
      o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
      let p = o; let far = false; while (p) { if (p.name === 'lod1') far = true; p = p.parent; }
      const mn = o.material && o.material.name;
      if (far || mn === 'hair') { o.visible = false; continue; }
      if (mn === 'head') o.layers.set(1);
      if (mn === 'body') { bodyMat = o.material; o.geometry.computeBoundingBox(); this.bodyH = o.geometry.boundingBox.max.y - o.geometry.boundingBox.min.y; }
      this.skel = o.skeleton;
    }
    if (bodyMat) { await this.dress(bodyMat, id); if (this.dressU) this.dressU.uPuff.value = 0.022 * (this.bodyH > 0.1 ? (this.bodyH > 10 ? this.bodyH / 1.75 : 1) : 1); }
    // face it along +Z, feet at y = 0
    this.root.updateMatrixWorld(true);
    const lr = this.wpos(this.b.thL).sub(this.wpos(this.b.thR));
    const fwd = V().crossVectors(lr, Y); fwd.y = 0;
    this.wrap.rotation.y = -Math.atan2(fwd.x, fwd.z);
    this.root.updateMatrixWorld(true);
    this.measure();
    // gear
    this.skiL = makeSki(this.outfit.skiA, this.outfit.skiB); this.skiR = makeSki(this.outfit.skiA, this.outfit.skiB);
    this.root.add(this.skiL, this.skiR);
    const bl = makeBoot(this.outfit.boots), br = makeBoot(this.outfit.boots);
    this.bootL = bl; this.bootR = br;
    bl.lower.position.y = SKI.thick + SKI.stack - 0.012; br.lower.position.y = SKI.thick + SKI.stack - 0.012;
    this.skiL.add(bl.lower); this.skiR.add(br.lower);
    this.root.add(bl.cuff, br.cuff);
    this.poleL = makePole(); this.poleR = makePole(); this.root.add(this.poleL, this.poleR);
    this.helmet = makeHelmet(this.outfit.helmet, this.outfit.lens); this.root.add(this.helmet);
    this.setPoles(opts.poles !== false);
    this.ready = true;
    return this;
  }
  setPoles(on) { this.poles = on; if (this.poleL) { this.poleL.visible = on; this.poleR.visible = on; } }
  async dress(mat, id) {
    const map = mat.map; if (!map) return;
    const maskUrl = './models/' + id + '_m.png?v=5';
    const means = await regionMeans(map, maskUrl).catch(() => [0.2, 0.2, 0.2]);
    const mask = await new THREE.TextureLoader().loadAsync(maskUrl);
    mask.flipY = map.flipY; mask.colorSpace = THREE.NoColorSpace;
    const col = c => new THREE.Color(c);
    const handBones = [];
    this.skelIndex = n => this.skel ? this.skel.bones.findIndex(b => b.name === n) : -1;
    const U = {
      uMask: { value: mask }, uMeans: { value: new THREE.Vector3(...means) },
      uTop: { value: col(this.outfit.jacket) }, uBottom: { value: col(this.outfit.pants) }, uShoe: { value: col('#202227') }, uGlove: { value: col(this.outfit.gloves) },
      uHandA: { value: new THREE.Vector4(-1, -1, -1, -1) }, uHandB: { value: new THREE.Vector4(-1, -1, -1, -1) },
      uMaskV: { value: mask }, uPuff: { value: 0 },
    };
    this.dressU = U;
    mat.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, U);
      s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>
uniform vec4 uHandA; uniform vec4 uHandB; varying float vGlove; uniform sampler2D uMaskV; uniform float uPuff;`)
        // ski clothes are puffier than street clothes: jacket and trousers pushed out along their normals
        .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_MAP
{ vec4 mkv = texture2D(uMaskV, uv); transformed += normal * uPuff * (mkv.r * 1.0 + mkv.g * 0.8); }
#endif`)
        .replace('#include <skinning_vertex>', `#include <skinning_vertex>
#ifdef USE_SKINNING
{ float g = 0.0;
  for (int k = 0; k < 4; k++) { float bi = skinIndex[k]; float w = skinWeight[k];
    if (abs(bi - uHandA.x) < 0.5 || abs(bi - uHandA.y) < 0.5 || abs(bi - uHandA.z) < 0.5 || abs(bi - uHandA.w) < 0.5 ||
        abs(bi - uHandB.x) < 0.5 || abs(bi - uHandB.y) < 0.5 || abs(bi - uHandB.z) < 0.5 || abs(bi - uHandB.w) < 0.5) g += w; }
  vGlove = g; }
#else
vGlove = 0.0;
#endif`);
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
uniform sampler2D uMask; uniform vec3 uMeans; uniform vec3 uTop; uniform vec3 uBottom; uniform vec3 uShoe; uniform vec3 uGlove; varying float vGlove;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
{ vec4 mk = texture2D(uMask, vMapUv);
  float l = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  if (mk.r > 0.5) diffuseColor.rgb = uTop * clamp(l / max(uMeans.x, 0.02), 0.35, 1.7);
  else if (mk.g > 0.5) diffuseColor.rgb = uBottom * clamp(l / max(uMeans.y, 0.02), 0.35, 1.7);
  else if (mk.b > 0.5) diffuseColor.rgb = uShoe * clamp(l / max(uMeans.z, 0.02), 0.4, 1.5);
  if (vGlove > 0.45) diffuseColor.rgb = uGlove * (0.75 + 0.5 * l);
}`);
    };
    mat.customProgramCacheKey = () => 'rider-dress';
    mat.needsUpdate = true;
    this.matDressed = mat;
  }
  wpos(b, out = V()) { return out.setFromMatrixPosition(b.matrixWorld); }
  wquat(o, out = Q()) { o.matrixWorld.decompose(_p, out, _s); return out; }
  // rest measurements in the rider's own frame (root at the origin, unrotated)
  measure() {
    const r = this.body;
    this.root.position.set(0, 0, 0); r.position.set(0, 0, 0); r.quaternion.identity(); this.root.updateMatrixWorld(true);
    const b = this.b, rest = {};
    for (const k in b) if (b[k]) rest[k] = { p: this.wpos(b[k]), q: this.wquat(b[k]) };
    this.rest = rest;
    const d = (a, c) => rest[c].p.distanceTo(rest[a].p);
    this.len = { th: d('thL', 'caL'), ca: d('caL', 'ftL'), ua: d('uaL', 'faL'), fa: d('faL', 'haL') };
    this.ankleH = rest.ftL.p.y;
    this.legLen = this.len.th + this.len.ca;
    this.hipY = rest.thL.p.y; this.pelvisY = rest.pelvis.p.y;
    this.ankleBack = 0.055;
    // which side is which: the model's left should be +X
    this.flipX = rest.thL.p.x < 0;
    // directions at rest
    const dir = (a, c) => rest[c].p.clone().sub(rest[a].p).normalize();
    this.restDir = {
      thL: dir('thL', 'caL'), caL: dir('caL', 'ftL'), thR: dir('thR', 'caR'), caR: dir('caR', 'ftR'),
      uaL: dir('uaL', 'faL'), faL: dir('faL', 'haL'), uaR: dir('uaR', 'faR'), faR: dir('faR', 'haR'),
    };
    // hands: finger direction and palm normal at rest
    const hand = (s) => {
      const hb = s === 'L' ? b.haL : b.haR;
      const f1 = this.bones['Bip01_' + s + '_Finger1'] || this.bones['Bip01 ' + s + ' Finger1'], f4 = this.bones['Bip01_' + s + '_Finger4'] || this.bones['Bip01 ' + s + ' Finger4'];
      const hp = rest[s === 'L' ? 'haL' : 'haR'].p;
      const p1 = f1 ? this.wpos(f1) : hp.clone().add(X), p4 = f4 ? this.wpos(f4) : hp.clone().add(X);
      const fd = p1.clone().add(p4).multiplyScalar(0.5).sub(hp).normalize();
      const across = p1.clone().sub(p4).normalize();
      let palm = V().crossVectors(fd, across).normalize();
      if (palm.y > 0) palm.negate();                      // a T- or A-pose: palms face down
      // fingers for curling: [bone, axis in the bone's local frame, sign]
      const fingers = [];
      for (let f = 0; f <= 4; f++) for (const seg of ['', '1', '2']) {
        const bn = this.bones['Bip01_' + s + '_Finger' + f + seg]; if (!bn) continue;
        const wq = this.wquat(bn), inv = wq.clone().invert();
        let axis = (f === 0 ? V().crossVectors(fd, palm).normalize().lerp(across, 0.4).normalize() : across.clone()).applyQuaternion(inv).normalize();
        // the sign that curls towards the palm
        const tip = fd.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis.clone().applyQuaternion(wq), 0.5));
        const sign = tip.dot(palm) > fd.dot(palm) ? 1 : -1;
        fingers.push({ bn, axis, sign, rest: bn.quaternion.clone(), thumb: f === 0 });
      }
      return { fd, palm, fingers };
    };
    this.hands = { L: hand('L'), R: hand('R') };
    // gloves: hand and finger bones by index in the skin
    if (this.dressU && this.skel) {
      const ids = n => this.skel.bones.findIndex(x => x.name === n);
      const a = ['Bip01_L_Hand', 'Bip01_L_Finger0', 'Bip01_L_Finger1', 'Bip01_L_Finger2'].map(ids);
      const c = ['Bip01_R_Hand', 'Bip01_R_Finger0', 'Bip01_R_Finger1', 'Bip01_R_Finger2'].map(ids);
      const a2 = ['Bip01_L_Finger3', 'Bip01_L_Finger4', 'Bip01_R_Finger3', 'Bip01_R_Finger4'].map(ids);
      // eight slots: L hand + three fingers, R hand + three fingers; the rest of the finger bones share them
      this.dressU.uHandA.value.set(...a); this.dressU.uHandB.value.set(...c);
      this.gloveExtra = a2;
    }
    // the eyes: where the goggles go and the first-person camera sits
    const le = this.bones.Bip01_LEye, re = this.bones.Bip01_REye;
    this.eyeOff = (le && re) ? this.wpos(le).add(this.wpos(re)).multiplyScalar(0.5).sub(rest.head.p) : V().set(0, 0.09, 0.09);
    this.restLocal = {}; for (const k in b) if (b[k]) this.restLocal[k] = b[k].quaternion.clone();
  }

  // ---- pose helpers (world space) ---------------------------------------------------------------------------------
  setWorldQ(bone, wq) {
    bone.parent.matrixWorld.decompose(_p, _q2, _s);
    bone.quaternion.copy(_q2.invert().multiply(wq));
    bone.updateWorldMatrix(false, false);
  }
  setWorldPos(bone, wp) {
    _m.copy(bone.parent.matrixWorld).invert();
    bone.position.copy(wp).applyMatrix4(_m);
    bone.updateWorldMatrix(false, false);
  }
  // the rotation taking frame (a, b) to frame (c, d): a and c are the main axes, b and d say where the twist goes
  static frameDelta(a, b, c, d, out = Q()) {
    const m1 = basis(a, b), m2 = basis(c, d);
    m1.transpose(); m2.multiply(m1); return out.setFromRotationMatrix(m2);
  }
  // point a bone (rest direction restD, rest twist restUp, both in the rider frame) along world dir with twist up
  aim(bone, restQ, restD, restUp, dir, up) {
    const R = this.rootQ;
    const a = _a.copy(restD).applyQuaternion(R), b = _b.copy(restUp).applyQuaternion(R);
    const dq = Rig.frameDelta(a, b, dir, up, _q);
    const wq = Q().copy(R).multiply(restQ);            // rest orientation in the world
    this.setWorldQ(bone, dq.multiply(wq));
  }
  twoBone(upper, lower, end, kU, kL, target, pole, restUpU) {
    upper.updateWorldMatrix(false, false);
    const H = this.wpos(upper), l1 = kU === 'th' ? this.len.th : this.len.ua, l2 = kU === 'th' ? this.len.ca : this.len.fa;
    const d = V().subVectors(target, H); let dist = d.length();
    const dn = d.clone().divideScalar(dist || 1);
    dist = clamp(dist, Math.abs(l1 - l2) + 0.01, (l1 + l2) * 0.999);
    const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const p = pole.clone().addScaledVector(dn, -pole.dot(dn));
    if (p.lengthSq() < 1e-6) p.copy(Y).addScaledVector(dn, -Y.dot(dn));
    p.normalize();
    const knee = H.clone().addScaledVector(dn, a).addScaledVector(p, h);
    const end2 = H.clone().addScaledVector(dn, dist);
    const ru = restUpU;
    this.aim(upper, this.rest[kU + this.side].q, this.restDir[kU + this.side], ru, knee.clone().sub(H).normalize(), p);
    this.aim(lower, this.rest[kL + this.side].q, this.restDir[kL + this.side], ru, end2.clone().sub(knee).normalize(), p);
    return end2;
  }

  // ---- the pose, every frame ---------------------------------------------------------------------------------------
  // S: { p, q (body), state, edge, crouch, tuck, brake, press, grab, pose, sw, speed, vel, railMode, balance, turn, t, land, crash }
  update(S, dt) {
    if (!this.ready) return;
    const P = this.p, k = (name, target, rate) => { P[name] = P[name] === undefined ? target : P[name] + (target - P[name]) * Math.min(1, dt * rate); return P[name]; };
    const air = S.state === 'air', rail = S.state === 'rail', crash = S.state === 'crash';
    const gdef = air && (S.grab || S.pose) ? GRABS[S.grab || S.pose] : null;
    // blend weight towards the grab's shape, and its definition kept while it blends out
    if (gdef) this.lastG = gdef;
    const gw = k('gw', gdef ? 1 : 0, gdef ? 9 : 7);
    const gid = air ? (S.grab || S.pose) : null;
    this.grabHeld = gid && gid === this.gid ? (this.grabHeld || 0) + dt : 0; this.gid = gid;
    // pole plants: at each change of edge at speed, on the new inside
    const eSign = Math.abs(S.edge) > 0.3 ? Math.sign(S.edge) : 0;
    if (S.state === 'ground' && eSign && this.lastE && eSign !== this.lastE && S.speed > 4 && this.poles) this.plant = { side: eSign > 0 ? 'R' : 'L', t: 0 };
    if (eSign) this.lastE = eSign;
    if (this.plant) { this.plant.t += dt; if (this.plant.t > 0.4) this.plant = null; }
    const G = this.lastG || GRABS.safety;
    const crouch = k('crouch', S.crouch, 12);
    const edge = k('edge', air || rail ? 0 : S.edge, 10);
    const press = k('press', S.press || 0, 10);
    const tuck = k('tuck', S.tuck || 0, 6);
    const brake = k('brake', S.brake || 0, 8);
    const crashW = k('crash', crash ? 1 : 0, 6);
    // place the root: the body's frame at the feet
    this.body.position.copy(S.p);
    this.body.quaternion.copy(S.q);
    this.body.updateMatrixWorld(false);
    this.rootQ = this.body.quaternion;
    const R = this.rootQ;
    const W = (x, y, z) => V().set(x, y, z).applyQuaternion(R).add(this.body.position);   // rider frame -> world
    const D = (x, y, z) => V().set(x, y, z).applyQuaternion(R);                            // rider frame direction -> world
    // ---- skis ----
    const stance = 0.115 + 0.03 * crouch;
    const skiPose = (side) => {
      const s = side === 'L' ? 1 : -1;
      const pos = V().set(s * stance, 0, 0);
      const q = Q();
      // on edge: both skis roll, lifted onto the edge
      const roll = edge * 0.95;
      q.multiply(_q.setFromAxisAngle(Z, roll));
      pos.y += Math.abs(Math.sin(roll)) * SKI.waist * 0.5;
      // in a turn the inside ski leads a little and rides higher (the inside leg is more bent)
      if (!air && !rail) { const inside = (edge > 0 && side === 'R') || (edge < 0 && side === 'L'); if (inside) { pos.z += 0.08 * Math.abs(edge); pos.y += 0.05 * Math.abs(edge); } }
      // butter: pitch about the pressed end
      const pitch = press * 0.26;
      pos.y += Math.abs(Math.sin(pitch)) * SKI.len * 0.36; pos.z += -Math.sign(pitch) * 0.04;
      q.multiply(_q.setFromAxisAngle(X, pitch));
      // in the air: the knees come up (tuck) and the grab's tweak
      if (air || gw > 0.01) {
        const t0 = G.ski[side], tw = 1 + 0.22 * Math.min(1, Math.max(0, (this.grabHeld - 0.5) / 0.7));
        const t = t0.map((v, i) => i < 3 ? v * tw : v * (1 + (tw - 1) * 0.8));
        const up = (air ? 0.12 + 0.35 * crouch : 0) * (1 - gw) + gw * (0.12 + 0.5 * G.tuck);
        pos.x += t[0] * gw; pos.y += up + t[1] * gw; pos.z += t[2] * gw;
        q.multiply(_q.setFromAxisAngle(Y, t[3] * gw)).multiply(_q.setFromAxisAngle(X, t[4] * gw)).multiply(_q.setFromAxisAngle(Z, t[5] * gw));
        if (!gdef && air) q.multiply(_q.setFromAxisAngle(X, -0.08));
      }
      if (crashW > 0.01) { pos.y += 0.2 * crashW; q.multiply(_q.setFromAxisAngle(Y, s * 0.6 * crashW)); }
      return { pos, q };
    };
    const sL = skiPose('L'), sR = skiPose('R');
    // ---- pelvis and torso ----
    const legK = 0.95 - (0.5 * crouch + 0.2 * tuck);
    let pelY = this.ankleH + SKI.thick + SKI.stack + this.legLen * (0.98 * legK) + (this.pelvisY - this.hipY);
    if (air) pelY = 0.92 * (1 - S.crouch * 0.35) + (this.pelvisY - this.hipY) * 0.5;
    const lean = k('lean', gw > 0 ? G.lean * gw + 0.2 * (1 - gw) : 0.22 + 0.42 * crouch + 0.55 * tuck - 0.4 * Math.max(0, -press) + 0.3 * Math.max(0, press), 8);
    const inc = edge * 0.38;                                   // the hips move inside the turn
    const pelX = -inc * 0.55 * Math.min(1, S.speed / 6);
    const pelZ = -0.08 - 0.12 * crouch + 0.14 * press - 0.05 * tuck;
    // counter-rotation: the upper body faces the travel (downhill), more in a hockey stop or a slide
    let face = 0;
    if (S.vel && S.speed > 1) {
      const v = S.vel.clone().applyQuaternion(R.clone().invert()); v.y = 0;
      if (v.lengthSq() > 0.01) { let a = Math.atan2(v.x, v.z); if (S.sw) a = Math.atan2(-v.x, -v.z); face = clamp(a, -1.3, 1.3); }
    }
    if (air) face = 0;
    const twist = k('twist', gw * G.twist + (1 - gw) * (rail ? face * 0.8 : face * (0.35 + 0.5 * brake)), 7);
    const side = k('side', gw * G.side + (1 - gw) * (-edge * 0.32), 7);
    const head = k('headTurn', S.sw && !air ? 1.0 : 0, 3);
    const pelvisQ = Q().copy(R).multiply(_q.setFromAxisAngle(Y, twist * 0.35)).multiply(_q2.setFromAxisAngle(Z, -inc * 0.6 + side * 0.2));
    // in the air the hips fold with the chest, so the shoulders come down over the knees (only the spine bent before)
    if (air && gw > 0.01) pelvisQ.multiply(_q.setFromAxisAngle(X, lean * 0.4 * gw));
    const chestQ = Q().copy(R).multiply(_q.setFromAxisAngle(Y, twist)).multiply(_q2.setFromAxisAngle(Z, side * 0.6)).multiply(Q().setFromAxisAngle(X, lean));
    const crashQ = crashW > 0.01 ? Q().setFromEuler(new THREE.Euler(Math.sin(S.t * 3.1) * 0.6 * crashW, Math.sin(S.t * 2.3) * 0.5 * crashW, Math.cos(S.t * 2.7) * 0.6 * crashW)) : null;
    if (crashQ) chestQ.multiply(crashQ);
    // root bone: put the pelvis where it goes
    const relRoot = Q().copy(this.rest.root.q);
    const pelvisTarget = W(pelX, pelY, pelZ);
    this.setWorldQ(this.b.root, Q().copy(pelvisQ).multiply(relRoot));
    // move so the pelvis bone lands on its target
    this.b.root.updateWorldMatrix(false, true);
    const off = this.wpos(this.b.pelvis).sub(this.wpos(this.b.root));
    this.setWorldPos(this.b.root, pelvisTarget.clone().sub(off));
    this.b.root.updateWorldMatrix(false, true);
    // spine: share the turn from the pelvis to the chest
    const spin = (bone, k2, t) => { if (!bone) return; const f = Q().copy(pelvisQ).slerp(chestQ, t); f.multiply(Q().copy(R).invert()); this.setWorldQ(bone, f.multiply(Q().copy(R).multiply(this.rest[k2].q))); };
    spin(this.b.pelvis, 'pelvis', 0.0);
    spin(this.b.spine, 'spine', 0.35); spin(this.b.spine1, 'spine1', 0.7); spin(this.b.chest, 'chest', 1.0);
    // head: looks where it goes; riding switch it looks back over the shoulder
    const headQ = Q().copy(chestQ).multiply(_q.setFromAxisAngle(Y, -twist * 0.6 + head * 1.25 * Math.sign(face || 1))).multiply(_q2.setFromAxisAngle(X, -lean * 0.65 + (air ? 0.1 : 0.05)));
    if (this.b.neck) { const f = Q().copy(chestQ).slerp(headQ, 0.5).multiply(Q().copy(R).invert()); this.setWorldQ(this.b.neck, f.multiply(Q().copy(R).multiply(this.rest.neck.q))); }
    if (this.b.head) { const f = Q().copy(headQ).multiply(Q().copy(R).invert()); this.setWorldQ(this.b.head, f.multiply(Q().copy(R).multiply(this.rest.head.q))); }
    for (const c of ['clL', 'clR']) if (this.b[c]) { const f = Q().copy(chestQ).multiply(Q().copy(R).invert()); this.setWorldQ(this.b[c], f.multiply(Q().copy(R).multiply(this.rest[c].q))); }
    // ---- grabs: pull the grabbed ski towards the hand's reach ----
    const grabPts = [];
    if (gw > 0.02) {
      for (const h of G.hands) {
        const [hand, ski, at, edgeK] = h;
        const sp = ski === 'L' ? sL : sR;
        const uab = hand === 'L' ? this.b.uaL : this.b.uaR; uab.updateWorldMatrix(false, false);
        const sh = this.wpos(uab);
        const gp = this.skiPoint(sp, ski, at, edgeK, W);
        const reach = (this.len.ua + this.len.fa) * 0.95 + 0.07;
        const dd = gp.pt.distanceTo(sh);
        if (dd > reach) {
          // bring the ski up to the hand (in the rider frame), at most 45 cm
          const pull = Math.min(0.45, dd - reach) * gw;
          const dirR = sh.clone().sub(gp.pt).normalize().applyQuaternion(R.clone().invert());
          sp.pos.addScaledVector(dirR, pull);
        }
        grabPts.push({ hand, ski, at, edgeK });
      }
    }
    // keep each ski within the leg's reach of its hip
    for (const [sp, side] of [[sL, 'L'], [sR, 'R']]) {
      const thb = side === 'L' ? this.b.thL : this.b.thR; thb.updateWorldMatrix(false, false);
      const hip = this.wpos(thb);
      const ank = this.ankleOf(sp, W);
      const lim = this.legLen * 0.995, dd = ank.distanceTo(hip);
      if (dd > lim) { const dirR = hip.clone().sub(ank).normalize().applyQuaternion(R.clone().invert()); sp.pos.addScaledVector(dirR, dd - lim); }
    }
    this.placeSki(this.skiL, sL, W); this.placeSki(this.skiR, sR, W);
    // ---- legs ----
    for (const side of ['L', 'R']) {
      this.side = side;
      const sp = side === 'L' ? sL : sR, ski = side === 'L' ? this.skiL : this.skiR;
      const ank = this.ankleOf(sp, W);
      const skiQ = Q().copy(R).multiply(sp.q);
      // knees point the way the ski points, levelled in the body's frame: a ski tipped tail-up must not fold the knee down
      const kf = V().set(0, 0, 1).applyQuaternion(skiQ).applyQuaternion(R.clone().invert()); kf.y = 0;
      if (kf.lengthSq() < 0.01) kf.set(0, 0, 1);
      kf.normalize().applyQuaternion(R);
      const kneeDir = kf.addScaledVector(D(side === 'L' ? 1 : -1, 0, 0), 0.12).addScaledVector(D(0, 1, 0), 0.25);
      const th = side === 'L' ? this.b.thL : this.b.thR, ca = side === 'L' ? this.b.caL : this.b.caR, ft = side === 'L' ? this.b.ftL : this.b.ftR;
      this.twoBone(th, ca, ft, 'th', 'ca', ank, kneeDir, Z);
      // foot flat in the boot, along the ski
      this.setWorldQ(ft, Q().copy(skiQ).multiply(this.rest['ft' + side].q));
      // the boot's cuff round the lower shin
      const cuff = side === 'L' ? this.bootL.cuff : this.bootR.cuff;
      const kp = this.wpos(ca), ap = this.wpos(ft);
      const shin = ap.clone().sub(kp).normalize();
      cuff.position.copy(ap).addScaledVector(shin, -0.1).addScaledVector(V().set(0, 0, 1).applyQuaternion(skiQ), 0.012);
      cuff.quaternion.setFromUnitVectors(Y, shin.clone().negate());
    }
    // ---- arms ----
    for (const side of ['L', 'R']) {
      this.side = side;
      const s = side === 'L' ? 1 : -1;
      const ua = side === 'L' ? this.b.uaL : this.b.uaR, fa = side === 'L' ? this.b.faL : this.b.faR, ha = side === 'L' ? this.b.haL : this.b.haR;
      const gp = grabPts.find(g => g.hand === side);
      let wrist, fingerDir, palm, curl = 0.9;
      // riding: hands forward of the hips, poles back
      const chestFwd = V().set(0, 0, 1).applyQuaternion(chestQ), chestLeft = V().set(1, 0, 0).applyQuaternion(chestQ), up = V().set(0, 1, 0).applyQuaternion(R);
      ua.updateWorldMatrix(false, false);
      const shoulder = this.wpos(ua);
      let free = shoulder.clone().addScaledVector(chestLeft, s * (0.2 + 0.04 * tuck)).addScaledVector(chestFwd, 0.4 - 0.08 * tuck).addScaledVector(up, -0.34 + 0.14 * tuck);
      // a pole plant on the new inside of a turn: the hand reaches forward and down, the tip goes into the snow
      const plantK = this.plant && this.plant.side === side ? Math.sin(Math.PI * Math.min(1, this.plant.t / 0.4)) : 0;
      if (plantK > 0 && !air) free.addScaledVector(chestFwd, 0.12 * plantK).addScaledVector(up, -0.12 * plantK).addScaledVector(chestLeft, s * 0.04 * plantK);
      if (air && !gdef) free = shoulder.clone().addScaledVector(chestLeft, s * 0.38).addScaledVector(chestFwd, 0.22).addScaledVector(up, -0.2 + Math.sin(S.t * 5 + s) * 0.04);
      if (rail) free = shoulder.clone().addScaledVector(chestLeft, s * 0.5).addScaledVector(chestFwd, 0.12).addScaledVector(up, -0.12 + S.balance * s * 0.15);
      if (gdef && gdef.arms === 'wide') free = shoulder.clone().addScaledVector(chestLeft, s * 0.58).addScaledVector(up, 0.05);
      if (gdef && gdef.arms === 'up') free = shoulder.clone().addScaledVector(chestLeft, s * 0.3).addScaledVector(up, 0.45).addScaledVector(chestFwd, 0.1);
      if (gdef && gdef.arms === 'out') free = shoulder.clone().addScaledVector(chestLeft, s * 0.45).addScaledVector(chestFwd, 0.25).addScaledVector(up, -0.05);
      if (crashW > 0.5) free = shoulder.clone().addScaledVector(chestLeft, s * 0.45).addScaledVector(up, 0.25 + Math.sin(S.t * 9 + s) * 0.2);
      wrist = free; fingerDir = chestFwd.clone().addScaledVector(up, -0.35).normalize(); palm = chestLeft.clone().multiplyScalar(-s); curl = this.poles ? 1.25 : 0.55;
      if (gp && gw > 0.02) {
        const sp = gp.ski === 'L' ? sL : sR;
        const g = this.skiPoint(sp, gp.ski, gp.at, gp.edgeK, W);
        // palm on the edge, fingers wrapped under it
        const gwrist = g.pt.clone().addScaledVector(g.fingers, -0.07).addScaledVector(g.palm, -0.03);
        wrist = free.clone().lerp(gwrist, gw);
        fingerDir = fingerDir.clone().lerp(g.fingers, gw).normalize();
        palm = palm.clone().lerp(g.palm, gw).normalize();
        curl = curl + (1.35 - curl) * gw;
      }
      const elbow = V().set(0, 0, -1).applyQuaternion(chestQ).addScaledVector(chestLeft, s * 0.7).addScaledVector(up, -0.6).normalize();
      this.twoBone(ua, fa, ha, 'ua', 'fa', wrist, elbow, V().set(0, 0, -1));
      // hand: fingers along fingerDir, palm towards palm
      const H = this.hands[side];
      this.aim(ha, this.rest['ha' + side].q, H.fd, H.palm, fingerDir, palm);
      this.curl(H, curl);
      // pole: from the grip down and back (or hanging from the strap while grabbing)
      const pole = side === 'L' ? this.poleL : this.poleR;
      if (this.poles) {
        const gripP = this.wpos(ha).addScaledVector(fingerDir, 0.06).addScaledVector(palm, 0.025);
        let tip = V().set(0, 0, -1).applyQuaternion(R).multiplyScalar(0.55).addScaledVector(up, -1).addScaledVector(D(s, 0, 0), 0.08).normalize();
        if (plantK > 0 && !air) tip.lerp(V().set(0, 0, 1).applyQuaternion(R).multiplyScalar(0.35).addScaledVector(up, -1).addScaledVector(D(s, 0, 0), 0.15).normalize(), plantK).normalize();
        if ((air || rail) && !gp) tip = V().set(0, 0, -1).applyQuaternion(R).multiplyScalar(0.9).addScaledVector(up, -0.75).addScaledVector(D(s, 0, 0), 0.1).normalize();
        if (gp && gw > 0.3) tip = V().set(0, 0, -1).applyQuaternion(R).addScaledVector(up, 0.15).addScaledVector(D(s, 0, 0), 0.35).normalize();
        pole.position.copy(gripP);
        pole.quaternion.setFromUnitVectors(Y, tip.negate());
      }
    }
    // helmet on the head
    const hp = this.wpos(this.b.head), hq = this.wquat(this.b.head);
    const hFwd = V().set(0, 0, 1).applyQuaternion(headQ), hUp = V().set(0, 1, 0).applyQuaternion(headQ);
    const eye = hp.clone().add(this.eyeOff.clone().applyQuaternion(headQ));
    this.helmet.position.copy(eye).addScaledVector(hUp, 0.04).addScaledVector(hFwd, -0.062);
    this.helmet.quaternion.copy(headQ);
    this.headPos = hp; this.headQ = headQ; this.eye = eye.clone().addScaledVector(hFwd, 0.02);
    this.body.updateMatrixWorld(true);
  }
  // a point on a ski, with the palm's and fingers' directions for holding it there
  skiPoint(sp, ski, at, edgeK, W) {
    const R = this.rootQ;
    const q = Q().copy(R).multiply(sp.q);
    const half = SKI.len / 2;
    const z = at * half * 0.98;
    const side = ski === 'L' ? 1 : -1;                    // the ski's outside is +X for the left ski
    const out = edgeK === 'in' ? -side : side;
    const w = (SKI.waist + (SKI.tip - SKI.waist) * Math.pow(Math.abs(at), 2.2)) / 2;
    const rise = Math.abs(at) > 0.78 ? Math.pow((Math.abs(at) - 0.78) / 0.22, 2.1) * 0.075 : 0;
    const local = V().set(edgeK === 'end' ? 0 : out * (w + 0.005), rise + SKI.thick * 0.5, z);
    const pt = V();
    const sx = V().set(1, 0, 0).applyQuaternion(q), sy = V().set(0, 1, 0).applyQuaternion(q), sz = V().set(0, 0, 1).applyQuaternion(q);
    pt.copy(sp.pos).applyQuaternion(R).add(this.body.position).add(local.clone().applyQuaternion(q));
    let palm, fingers;
    if (edgeK === 'end') { palm = sy.clone().negate(); fingers = sz.clone().multiplyScalar(Math.sign(at) || 1).addScaledVector(sy, -0.6).normalize(); }
    else { palm = sx.clone().multiplyScalar(-out); fingers = sy.clone().negate().addScaledVector(sx, -out * 0.35).normalize(); }
    return { pt, palm, fingers };
  }
  ankleOf(sp, W) {
    const R = this.rootQ, q = Q().copy(R).multiply(sp.q);
    const local = V().set(0, SKI.thick + SKI.stack + this.ankleH, -this.ankleBack);
    return V().copy(sp.pos).applyQuaternion(R).add(this.body.position).add(local.applyQuaternion(q));
  }
  placeSki(ski, sp, W) {
    ski.position.copy(sp.pos).applyQuaternion(this.rootQ).add(this.body.position);
    ski.quaternion.copy(this.rootQ).multiply(sp.q);
  }
  curl(H, amt) {
    for (const f of H.fingers) {
      const a = amt * (f.thumb ? 0.45 : 1) * f.sign;
      f.bn.quaternion.copy(f.rest).multiply(_q.setFromAxisAngle(f.axis, a));
    }
  }
  // world points the camera and effects use
  skiTips() {
    const pts = [];
    for (const s of [this.skiL, this.skiR]) { if (!s) continue; s.updateMatrixWorld(); pts.push(V().set(0, 0, SKI.len / 2 - 0.05).applyMatrix4(s.matrixWorld), V().set(0, 0, -SKI.len / 2 + 0.05).applyMatrix4(s.matrixWorld)); }
    return pts;
  }
  setFirstPerson(on) { /* the head, hair and helmet are on layer 1; the first-person camera leaves that layer out */ }
}
function basis(a, b) {
  const x = a.clone().normalize();
  const y = b.clone().addScaledVector(x, -b.dot(x)); if (y.lengthSq() < 1e-8) y.set(0, 1, 0).addScaledVector(x, -x.y); y.normalize();
  const z = V().crossVectors(x, y);
  return new THREE.Matrix4().makeBasis(x, y, z);
}
