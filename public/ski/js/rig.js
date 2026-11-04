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
import { clamp, smoothstep } from './noise.js?v=12';
import { Spring, springBank, smooth01, wrapPi } from './motion.js?v=12';
import { height } from './terrain.js?v=12';

const V = () => new THREE.Vector3(), Q = () => new THREE.Quaternion();
const _p = V(), _s = V(), _q = Q();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1), NZ = new THREE.Vector3(0, 0, -1), ZERO = new THREE.Vector3();
// scratch for the per-frame pose (nothing is allocated in update)
const _sp = V(), _sq = Q(), _ss = V(), _sm = new THREE.Matrix4(), _fm1 = new THREE.Matrix4(), _fm2 = new THREE.Matrix4(), _bx = V(), _by = V(), _bz = V();
const _aa = V(), _ab = V(), _aq = Q(), _aq2 = Q(), _tH = V(), _tD = V(), _tP = V(), _tK = V(), _tE = V(), _tU = V(), _bq = Q();
const _qi = Q(), _q1 = Q(), _q2 = Q(), _q3 = Q(), _ub = V(), _acc = V(), _vb = V(), _v2 = V(), _v3 = V(), _v4 = V(), _v5 = V(), _v6 = V();
const _cFl = V(), _sh = V(), _pelQ = Q(), _chQ = Q(), _hdQ = Q(), _eu = new THREE.Euler(), _kd = V(), _cF = V(), _cL = V(), _wr = V(), _fd = V(), _pa = V(), _el = V(), _tip = V();
const _kq = Q(), _kv = V(), _kx = V(), _ky = V();
const _qi2 = Q(), _ca = V(), _cb = V(), _cc = V(), _cd = V(), _ce = V(), _cf = V(), _cg = V();
const TG = new Float64Array(6);
const SKN = [['sL0', 'sL1', 'sL2', 'sL3', 'sL4', 'sL5'], ['sR0', 'sR1', 'sR2', 'sR3', 'sR4', 'sR5']], HWN = ['hwL', 'hwR'], PULLN = [['pLx', 'pLy', 'pLz'], ['pRx', 'pRy', 'pRz']], ARMN = [['aLx', 'aLy', 'aLz'], ['aRx', 'aRy', 'aRz']];
// a grab's free arm (out from the shoulder, up, forward), all inside the arm's reach so the elbow stays bent; 'up' is a
// hand raised beside and a little behind the head with the elbow out, not an arm pointed at the sky
// (the hands' place from the shoulder: out, up, forward. Brought in and down, hanging more naturally, 2026-11-03)
const ARM_MODE = { out: [0.22, -0.22, 0.2], up: [0.19, 0.25, -0.08], wide: [0.3, -0.2, 0.1] };
// small continuous motion: a sum of three sines, about -1..1, never repeating soon (a is a phase per channel)
// a reach that is kept short of a limb's full length: as it is up to a share a of the length, then easing towards b
// (a hard stop near full reach makes the joint flick, since the angle changes fastest there)
const softReach = (d, L, a, b) => { const s = a * L, w = (b - a) * L; return d <= s ? d : s + w * Math.tanh((d - s) / w); };
const wob = (t, a) => 0.55 * Math.sin(t + a) + 0.3 * Math.sin(t * 1.71 + a * 2.3) + 0.15 * Math.sin(t * 2.93 + a * 0.7);
const gpOut = () => ({ pt: V(), palm: V(), fingers: V() });

export const SKI = { len: 1.78, waist: 0.092, tip: 0.118, thick: 0.017, stack: 0.03 };

// grabs and positions are data in grabs.js (with their mirror images and variations)
export { GRABS } from './grabs.js?v=12';
import { grabDef } from './grabs.js?v=12';

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
    this.p = {};          // the pose's springs (cleared to start them again)
    this.skiL = null; this.skiR = null;
    this.sk = [{ pos: V(), q: Q() }, { pos: V(), q: Q() }];            // each ski in the body's frame
    this.air6 = [new Float64Array(6), new Float64Array(6)];
    this.hs = [0, 1].map(() => ({ cur: null, prev: null, f: new Spring(1), fx: 1, w: 0 }));   // what each hand holds
    this.gpA = gpOut(); this.gpB = gpOut();
    this._roll = [0, 0]; this._pv = V(); this._gl = { next: 3, until: 0, yaw: 0, pitch: 0 };
    this.ph = Math.random() * 100;                                     // each rider's own idle rhythm
    this.pull = [V(), V()]; this._pt = [V(), V()]; this._hold = [0, 0];                     // a grabbed ski brought up to the hand
    this.eye = V(); this.headPos = V(); this.headQ = Q();
  }
  async load(id, opts = {}) {
    const loader = new GLTFLoader();
    const draco = new DRACOLoader(); draco.setDecoderPath('/car/vendor/three/addons/libs/draco/'); loader.setDRACOLoader(draco);
    const gl = await loader.loadAsync('./models/' + id + '.glb?v=12');
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
      if (mn === 'body') {
        bodyMat = o.material; o.geometry.computeBoundingBox(); this.bodyH = o.geometry.boundingBox.max.y - o.geometry.boundingBox.min.y; this.bodyY0 = o.geometry.boundingBox.min.y;
        // the legs in the mesh's own space, for the trousers: the middle between them and how far out each one's middle
        // is, measured from the shins and thighs themselves (the mesh's x is across the body)
        const P = o.geometry.attributes.position, yb = this.bodyY0, H = this.bodyH;
        let n = 0, sx = 0; for (let i = 0; i < P.count; i++) { const y = (P.getY(i) - yb) / H; if (y > 0.12 && y < 0.4) { sx += P.getX(i); n++; } }
        if (n) {
          const mx = sx / n; let sa = 0; for (let i = 0; i < P.count; i++) { const y = (P.getY(i) - yb) / H; if (y > 0.12 && y < 0.4) sa += Math.abs(P.getX(i) - mx); }
          this.legMid = V().set(mx, 0, 0); this.legLat = V().set(1, 0, 0); this.legHalf = sa / n;
        }
      }
      this.skel = o.skeleton;
    }
    if (bodyMat) { await this.dress(bodyMat, id); if (this.dressU) { this.dressU.uPuff.value = 0.022 * (this.bodyH > 0.1 ? (this.bodyH > 10 ? this.bodyH / 1.75 : 1) : 1); this.dressU.uLeg.value.set(this.bodyY0 || 0, Math.max(1e-3, this.bodyH || 1.75)); if (this.legLat) { this.dressU.uLegMid.value.copy(this.legMid); this.dressU.uLegLat.value.copy(this.legLat); this.dressU.uLegHalf.value = this.legHalf; } } }
    // face it along +Z, feet at y = 0
    this.root.updateMatrixWorld(true);
    const lr = this.wpos(this.b.thL).sub(this.wpos(this.b.thR));
    const fwd = V().crossVectors(lr, Y); fwd.y = 0;
    this.wrap.rotation.y = -Math.atan2(fwd.x, fwd.z);
    this.root.updateMatrixWorld(true);
    this.measure();
    // the nodes between the body and the skeleton's root, updated each frame without walking the whole skeleton
    this.chain = []; for (let o = this.b.root.parent; o && o !== this.body; o = o.parent) this.chain.unshift(o);
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
    const maskUrl = './models/' + id + '_m.png?v=12';
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
      uMaskV: { value: mask }, uPuff: { value: 0 }, uLeg: { value: new THREE.Vector2(0, 1.75) }, uLegMid: { value: new THREE.Vector3() }, uLegLat: { value: new THREE.Vector3(1, 0, 0) }, uLegHalf: { value: 0 },
    };
    this.dressU = U;
    mat.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, U);
      s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>
uniform vec4 uHandA; uniform vec4 uHandB; varying float vGlove; uniform sampler2D uMaskV; uniform float uPuff; uniform vec2 uLeg; uniform vec3 uLegMid; uniform vec3 uLegLat; uniform float uLegHalf;`)
        /* ski clothes are puffier than street clothes: the jacket pushed out along its normals, and baggy trousers
           (2026-11-03, for "more baggy pants"): loose from the hips and widest at the shins, flared over the boots,
           with a few loose folds stacked above the hem, the hem let down over the boots' tops, and the insides of the
           legs kept apart (pushed out as far, the two legs met in one skirt). hN is the height up the body, 0 at the
           soles; side, which leg (from the hips' own place in the mesh). */
        .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_MAP
{ vec4 mkv = texture2D(uMaskV, uv);
  float hN = clamp((position.y - uLeg.x) / uLeg.y, 0.0, 1.0);
  float shin = 1.0 - smoothstep(0.1, 0.46, hN);
  float folds = shin * shin * (0.5 + 0.5 * sin(hN * 120.0));
  float side = dot(position - uLegMid, uLegLat);
  float mid = uLegHalf > 0.0 ? 1.0 - smoothstep(0.15 * uLegHalf, 0.6 * uLegHalf, abs(side)) : 0.0;
  float inner = max(clamp(-dot(normal, uLegLat) * sign(side), 0.0, 1.0), mid) * (1.0 - smoothstep(0.42, 0.55, hN));
  float pants = mkv.g * (2.1 + 2.5 * shin + 0.6 * folds) * (1.0 - 0.8 * inner);
  transformed += normal * uPuff * (mkv.r * 1.25 + pants);
  transformed.y -= mkv.g * uPuff * 3.2 * (1.0 - smoothstep(0.05, 0.16, hN)); }
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
    this.hipY = rest.thL.p.y; this.pelvisY = rest.pelvis.p.y; this.hipHalf = Math.abs(rest.thL.p.x - rest.pelvis.p.x);
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

  // ---- pose helpers (world space, nothing allocated) ----------------------------------------------------------------
  // set a bone's world rotation; a parent posed earlier this frame gives its rotation without decomposing its matrix
  // (exact here: the only scaled bone, the skeleton's root, is scaled evenly)
  setWorldQ(bone, wq) {
    const par = bone.parent;
    if (par._wf === this._frame) _sq.copy(par._wq).invert();
    else { par.matrixWorld.decompose(_sp, _sq, _ss); _sq.invert(); }
    bone.quaternion.copy(_sq.multiply(wq));
    bone.updateWorldMatrix(false, false);
    (bone._wq || (bone._wq = new THREE.Quaternion())).copy(wq); bone._wf = this._frame;
  }
  setWorldPos(bone, wp) {
    _sm.copy(bone.parent.matrixWorld).invert();
    bone.position.copy(wp).applyMatrix4(_sm);
    bone.updateWorldMatrix(false, false);
  }
  // the rotation taking frame (a, b) to frame (c, d): a and c are the main axes, b and d say where the twist goes
  static frameDelta(a, b, c, d, out = new THREE.Quaternion()) {
    basisInto(_fm1, a, b); basisInto(_fm2, c, d);
    _fm1.transpose(); _fm2.multiply(_fm1); return out.setFromRotationMatrix(_fm2);
  }
  // point a bone (rest direction restD, rest twist restUp, both in the rider frame) along world dir with twist up
  aim(bone, restQ, restD, restUp, dir, up) {
    const R = this.rootQ;
    _aa.copy(restD).applyQuaternion(R); _ab.copy(restUp).applyQuaternion(R);
    Rig.frameDelta(_aa, _ab, dir, up, _aq);
    this.setWorldQ(bone, _aq.multiply(_aq2.copy(R).multiply(restQ)));
  }
  // two-bone IK: upper and lower (rest keys ku, kl) reach target, bending towards pole
  twoBone(upper, lower, ku, kl, target, pole, restUp) {
    upper.updateWorldMatrix(false, false);
    const H = _tH.setFromMatrixPosition(upper.matrixWorld);
    const leg = ku[0] === 't', l1 = leg ? this.len.th : this.len.ua, l2 = leg ? this.len.ca : this.len.fa;
    const dn = _tD.subVectors(target, H); let dist = dn.length(); dn.divideScalar(dist || 1);
    dist = clamp(dist, Math.abs(l1 - l2) + 0.01, (l1 + l2) * 0.999);
    const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const p = _tP.copy(pole).addScaledVector(dn, -pole.dot(dn));
    if (p.lengthSq() < 1e-6) p.copy(Y).addScaledVector(dn, -dn.y);
    p.normalize();
    const knee = _tK.copy(H).addScaledVector(dn, a).addScaledVector(p, h);
    const end = _tE.copy(H).addScaledVector(dn, dist);
    this.aim(upper, this.rest[ku].q, this.restDir[ku], restUp, _tU.subVectors(knee, H).normalize(), p);
    this.aim(lower, this.rest[kl].q, this.restDir[kl], restUp, _tU.subVectors(end, knee).normalize(), p);
    return end;
  }
  // a bone turned part of the way from qa to qb, on top of its rest orientation
  blendBone(bone, key, qa, qb, f) {
    if (!bone) return;
    _bq.copy(qa); if (f > 0) _bq.slerp(qb, f);
    this.setWorldQ(bone, _bq.multiply(this.rest[key].q));
  }

  // ---- the pose, every frame ---------------------------------------------------------------------------------------
  // S: { p, q (body), state, edge, crouch, tuck, brake, press, grab, pose, tweak, sw, speed, vel, balance, t, shift,
  //      skate, skateT, absorb, landT, lookBack, railAng, railPress, turn, slide, tAir } (network riders send fewer)
  // Every pose parameter that follows the controls goes through a spring (motion.js), so a change of input moves
  // through the poses in between. The body leans against the snow's push (into a turn, back in a stop), worked out
  // from how the velocity changes, so it is the same for the local rider, a replay and a network rider.
  update(S, dt) {
    if (!this.ready) return;
    this._frame = (this._frame || 0) + 1;
    dt = dt > 0 ? Math.min(dt, 0.05) : 0;
    const P = this.p, sp = springBank(P, dt);
    const st = S.state || 'ground', air = st === 'air', rail = st === 'rail', crash = st === 'crash', ground = st === 'ground';
    const t = S.t !== undefined ? S.t : (this._t = (this._t || 0) + dt);
    const vel = S.vel || ZERO, speed = S.speed !== undefined ? S.speed : vel.length();
    if (!P.crouch) { this._pq = null; this._pvOk = false; this._pst = st; this.lastE = 0; }   // the springs were cleared
    // ---- the body's frame, at the feet
    const body = this.body, BP = body.position, b = this.b;
    BP.copy(S.p); body.quaternion.copy(S.q); body.updateWorldMatrix(false, false);
    for (const o of this.chain) o.updateWorldMatrix(false, false);
    const R = this.rootQ = body.quaternion, qi = _qi.copy(R).invert();
    // ---- what the body is doing: how fast it turns (from the last frame's orientation), the snow's push on it
    const changed = this._pst !== st;
    let wx = 0, wy = 0, wz = 0;
    if (this._pq && dt > 0 && !changed) {
      const d = _q1.copy(this._pq).invert().multiply(R), g = (d.w < 0 ? -2 : 2) / dt;
      wx = d.x * g; wy = d.y * g; wz = d.z * g;
      if (wx * wx + wy * wy + wz * wz > 450) wx = wy = wz = 0;            // a jump (a respawn, a reset), not a rotation
    }
    (this._pq || (this._pq = new THREE.Quaternion())).copy(R);
    const Wx = sp('wx', wx, 14), Wy = sp('wy', wy, 14), Wz = sp('wz', wz, 14);  // body frame: + front flip, + left, + roll right
    // a spin slowing down (opening up to stop it): the arms go out
    const open = sp('open', air && dt > 0 ? clamp((Math.abs(this._pWy || 0) - Math.abs(Wy)) / dt * 0.12, 0, 1) : 0, 10);
    this._pWy = Wy;
    /* the air, loose (2026-11-03, for "more human like rather than robot like" and flips that look "lively and loose
       rather than stiff"): how fast the rotation changes, through an underdamped spring, so the skis and legs lag a
       flip or spin thrown and swing past when it stops; how much of a front or back flip the body is in (a tuck, the
       arms up for a back flip, reaching for the skis in a front flip), the throw that starts one (the head and chest
       thrown back, or forward) and the opening that ends it (legs and arms out); and in a straight air with nothing
       held, a slow loose sway through the chest, arms and legs */
    const aRx = air && dt > 0 && this._pWx !== undefined ? clamp((Wx - this._pWx) / dt, -40, 40) : 0;
    const aRy = air && dt > 0 && this._pWy2 !== undefined ? clamp((Wy - this._pWy2) / dt, -40, 40) : 0;
    this._pWx = Wx; this._pWy2 = Wy;
    const Ax = sp('ax', aRx, 8, 0.5), Ay = sp('ay', aRy, 8, 0.5);
    const flF = sp('flF', air ? smoothstep(0.7, 4.2, Wx) : 0, 7, 0.75), flB = sp('flB', air ? smoothstep(0.7, 4.2, -Wx) : 0, 7, 0.75);
    const throwF = sp('thF', air && Wx > 0.5 && aRx > 0 ? clamp(aRx / 6, 0, 1) : 0, 9, 0.6);
    const arch = sp('arch', air && Wx < -0.5 && aRx < 0 ? clamp(-aRx / 6, 0, 1) : 0, 9, 0.6);
    const opening = sp('opening', air && Math.abs(Wx) > 0.5 && aRx * Wx < 0 ? clamp(Math.abs(aRx) / 6, 0, 1) : 0, 8, 0.6);
    const ub = _ub.set(0, 1, 0).applyQuaternion(R);
    this._gT = ground && !changed ? (this._gT || 0) + dt : 0;
    let sx = 0, sz = 0, an = 0;
    if (ground && this._gT > 0.06 && dt > 0 && this._pvOk) {
      // what the snow does to the body: its acceleration less gravity and the air's drag
      const a = _acc.subVectors(vel, this._pv).divideScalar(dt);
      an = clamp(a.dot(ub), -15, 30);
      a.y += 9.81; a.addScaledVector(vel, 0.0042 * speed); a.applyQuaternion(qi);
      sx = clamp(a.x, -13, 13); sz = clamp(a.z, -9, 9);
    }
    this._pv.copy(vel); this._pvOk = true; this._pst = st;
    const Sx = sp('sx', sx, 10), Sz = sp('sz', sz, 9), An = sp('an', an, 10);
    const vb = _vb.copy(vel).applyQuaternion(qi);
    // the legs lean with the push: into a turn by v^2/R, back against a stop, upright to gravity standing across a slope
    const phi = clamp(Math.atan2(-Sx, 9.81), -0.75, 0.75), psi = clamp(Math.atan2(Sz, 9.81), -0.35, 0.25);
    const brake = sp('brake', ground ? S.brake || 0 : 0, 10), tuck = sp('tuck', S.tuck || 0, 9);
    const press = sp('press', (rail ? S.railPress : ground ? S.press : 0) || 0, 14);
    // ---- skating: V strides (one ski pushed out and back each half cycle), double-pole pushes when faster
    const skate = sp('skate', ground ? S.skate || 0 : 0, 9);
    let skT = S.skateT;
    if (skT === undefined) { if (skate > 0.01) this._skT = (this._skT || 0) + dt * (1.2 + 0.05 * speed); skT = this._skT || 0; }
    const poleK = smoothstep(4.5, 8, speed), strideW = skate * (1 - poleK), dpW = skate * poleK;
    const hc = skT * 2, pushS = (Math.floor(hc) & 1) ? -1 : 1, u = hc - Math.floor(hc);
    const strk = Math.sin(Math.PI * u) * strideW;                         // the hips' sway: a sine over the whole cycle
    const strk2 = Math.sin(Math.PI * u) ** 2 * strideW;                   // each leg's push: no kink where the legs swap
    const lift = (u > 0.4 ? Math.sin(Math.PI * (u - 0.4) / 0.6) ** 2 : 0) * strideW;
    const u2 = skT - Math.floor(skT), crunch = Math.sin(Math.PI * clamp(u2 / 0.5, 0, 1)) * dpW;
    const dpK = u2 < 0.45 ? smooth01(u2 / 0.45) : 1 - smooth01((u2 - 0.45) / 0.55);   // 0 poles planted ahead, 1 pushed back
    // ---- the skis' roll: onto the edges the steering asks for, and in a skid onto the edges the slide asks for (the
    // trailing ones), so a hockey stop is on its uphill edges and a transition out of a skid rolls over as it comes round
    const slipX = ground ? vb.x : 0;
    if (Math.abs(slipX) > 0.6) this._slip = slipX > 0 ? 1 : -1;
    const slipK = smoothstep(0.7, 2.8, Math.abs(slipX));
    let eT = 0;
    if (ground) {
      const eIn = (S.edge || 0) * (0.5 + 0.45 * smoothstep(1, 10, speed));
      eT = eIn + (clamp(slipX / 3.5, -1, 1) * 0.9 - eIn) * slipK + brake * 0.22 * (this._slip || 1) * (1 - slipK);
      // the edges that hold are the ones the snow pushes against: the roll never goes against the legs' lean
      if (phi * eT >= 0) { if (Math.abs(eT) < Math.abs(phi) * 1.1) eT = phi * 1.1; }
      else eT += (phi * 1.1 - eT) * smoothstep(0.06, 0.3, Math.abs(phi));
    }
    const edge = sp('edge', eT, 15);
    const absorb = S.absorb || 0;
    const tt = t + this.ph;                                                // this rider's own idle clock
    this._airT = air ? (changed ? 0 : (this._airT || 0) + dt) : 0;
    // just off the snow the legs drive straight (the pop, or rolling off a lip), then the knees come up
    const popK = air ? smooth01(this._airT / 0.04) * (1 - smoothstep(0.1, 0.3, this._airT)) : 0;
    // turning on a rail: the skis swivel under a steadier upper body, the knees come up a little (a small hop)
    const ra = S.railAng || 0;
    const raRate = rail && this._wasRail && dt > 0 ? Math.abs(wrapPi(ra - (this._pra || 0))) / dt : 0;
    const swapK = sp('swap', rail ? clamp((raRate - 1.5) / 4, 0, 1) : 0, 16);
    const comp = ground ? clamp(An * 0.008, -0.05, 0.13) : 0;           // bumps and transitions press the knees
    const landX = ground ? absorb * 0.7 : 0;                            // a landing goes into the knees
    const settled = smoothstep(0.8, 2.0, S.landT ?? 9);
    const bob = (ground ? 0.04 * (1 - 0.6 * skate) * settled : rail ? 0.045 : 0) * wob(tt * (rail ? 4.2 : 3.1), 1.3);
    const groove = ground ? 0.07 * (1 - smoothstep(0.3, 0.8, Math.abs(S.edge || 0))) * (1 - tuck) : 0;
    const brakeC = brake * 0.12 * smoothstep(0.6, 3, speed);             // stopped, the stop's crouch eases off
    let cT = (S.crouch ?? 0.3) + comp + brakeC + crunch * 0.16 + strk2 * 0.05 + groove + landX + bob + swapK * 0.16;
    if (air && (S.grab || S.pose)) cT = Math.max(cT, 0.72);              // a grab's crouch at once (the physics eases into it)
    if (air) cT += (0.04 - cT) * popK;
    const crouch = sp('crouch', clamp(cT, 0, 1), popK > 0.2 || landX > 0.03 ? 30 : 22);
    // ---- grabs and positions
    const gid = air ? (S.grab || S.pose || null) : null;
    const gd = gid ? grabDef(gid, S.tweak || '') : null;
    if (gd) this.lastG = gd;
    this.grabHeld = gid && gid === this.gid ? (this.grabHeld || 0) + dt : 0; this.gid = gid;
    const gW = sp('gw', gd ? 1 : 0, gd ? 13 : 9);
    // the landing coming: the legs reach for the snow, so the skis are on it when the body gets there
    const prep = air ? 1 - smoothstep(0.09, 0.36, this.timeToGround(S.p, vel)) : 0;
    const ext = sp('ext', air ? 1 - prep : 0, air ? 28 : 32);
    const airW = sp('airW', air ? 1 : 0, air ? 10 : 9), railW = sp('railW', rail ? 1 : 0, 12), crashW = sp('crash', crash ? 1 : 0, 6);
    // a shifty: the lower body turned across under the body, the chest the other way (unwound before the landing)
    const lowYaw = sp('lowYaw', air ? -(S.shift || 0) * 1.3 : 0, air ? 15 : 20, air ? 0.8 : 1) * smooth01(ext * 1.6);
    // the air shape of each ski: the grab's or position's, or loose straight-air skis
    // (a held grab breathes: the grabbed ski pulled in a little further and let back, once it is set)
    const twk = 1 + 0.22 * smooth01((this.grabHeld - 0.45) / 0.75) + 0.05 * Math.sin(this.grabHeld * 3.4) * smooth01(this.grabHeld / 0.6);
    const flow = air ? (1 - gW) * (1 - smoothstep(1.2, 3.5, Math.abs(Wx) + Math.abs(Wy))) : 0;
    for (let k = 0; k < 2; k++) {
      const s = k ? -1 : 1, A = this.air6[k], N = SKN[k];
      if (gd) {
        const g = gd.ski[k ? 'R' : 'L']; for (let i = 0; i < 6; i++) TG[i] = g[i] * (i < 3 ? twk : 1 + (twk - 1) * 0.8);
        // a held ski is never pulled past about 60 degrees tip or tail up (a tweaked mute stood it vertical behind the
        // back); a tail grab's ski goes further, its tail up at the hand
        const cap = gd.kind === 'tail' ? 1.35 : 1.05;
        if (gd.hands.length) TG[4] = cap * Math.tanh(TG[4] / cap);
      }
      else if (air) {
        TG[0] = -s * 0.012 + s * 0.045 * flow * wob(tt * 0.8, 21 + k * 3.1); TG[1] = 0.015 * Math.sin(t * 1.3 + s) + 0.07 * flow * wob(tt * 1.35, 3 + k * 2.7);
        TG[2] = s * 0.035 * Math.sin(t * 1.9 + 0.7) + 0.1 * flow * wob(tt * 1.05, 7 + k * 1.9);
        TG[3] = -s * 0.035 + 0.04 * Math.sin(t * 1.25 + s * 0.9) - clamp(Wy * 0.012, -0.08, 0.08) + 0.1 * flow * wob(tt * 0.9, 2 + k * 4.2);
        TG[4] = -0.13 + 0.05 * Math.sin(t * 1.6 + s * 0.8) + clamp(Wx * 0.02, -0.12, 0.12) + 0.13 * flow * wob(tt * 1.2, 5 + k * 3.3);
        TG[5] = s * 0.05 * Math.sin(t * 1.1 + 0.3) + s * 0.05 * flow * wob(tt * 1.0, 9 + k * 2.2);
        // a flip: a back flip brings the tips up to the chest and the skis forward, a front flip the tails up behind
        TG[4] += -0.5 * flB + 0.36 * flF; TG[2] += 0.13 * flB - 0.1 * flF; TG[1] += 0.06 * (flB + flF);
        // each ski a little apart in a flip, one lagging the other (loose legs, not one block)
        TG[4] += s * 0.16 * (flB + flF) * Math.sin(tt * 2.3 + k); TG[2] += s * 0.07 * (flB + flF) * Math.sin(tt * 1.7 + 0.5); TG[3] += s * 0.08 * (flB + flF);
      } else for (let i = 0; i < 6; i++) TG[i] = 0;
      // the skis trail the rotation: a flip or spin thrown leaves them behind, and they swing past when it stops (the
      // second ski a little later than the first); held in a grab, half as much
      if (air) { const lag = (gd ? 0.5 : 1) * (1 + 0.35 * k); TG[4] += clamp(-Ax * 0.04 * lag, -0.45, 0.45); TG[3] += clamp(-Ay * 0.018 * lag, -0.3, 0.3); TG[2] += clamp(-Ax * 0.012 * lag, -0.12, 0.12); }
      for (let i = 0; i < 6; i++) A[i] = sp(N[i], TG[i], gd ? 14 + 2 * k : 11 - 1.5 * k, air ? (gd ? 0.74 : 0.72) : 1);
    }
    const kneeUp = sp('kneeUp', (gd ? 0.12 + 0.5 * gd.tuck : air ? 0.13 + 0.28 * crouch + clamp(Math.abs(Wx) * 0.02, 0, 0.1) + clamp(Math.abs(Wy) * 0.008, 0, 0.05) + 0.3 * (flF + flB) - 0.16 * opening + 0.08 * flow * wob(tt * 1.15, 17.3) : 0) * (1 - popK), gd ? 15 : 12, air ? 0.8 : 1);
    // ---- skis, in the body's frame
    // (the feet a little under hip width: a relaxed, narrow park stance)
    const stance = 0.094 + 0.018 * crouch;
    this.railC2 = rail ? Math.cos(ra) ** 2 : 1;
    // a butter or press tips the skis about the pressed end (on a rail the contact under the boots in a slide); the
    // pivot's place eases between them, so leaving a box mid-press does not snap the skis
    const zpL = sp('zpL', rail ? 0.55 * this.railC2 : 0.64, 12);
    for (let k = 0; k < 2; k++) {
      const s = k ? -1 : 1, ski = this.sk[k], pos = ski.pos, q = ski.q, A = this.air6[k];
      pos.set(s * stance, 0, 0);
      let yawV = 0, roll = edge;
      if (strideW > 0.01) {
        yawV = s * 0.24 * strideW;                                         // the V: both tips out
        if (s === pushS) { pos.x += s * 0.2 * strk2; pos.z -= 0.12 * strk2; roll += s * 0.32 * strk2; yawV += s * 0.1 * strk2; pos.y += 0.06 * lift; }
        else pos.x -= s * 0.04 * strk2;                                    // the gliding ski under the body
      }
      if (ground && edge * s < 0) pos.z += 0.07 * Math.abs(edge);          // the inside ski leads a little
      this._roll[k] = roll;
      if (yawV) { pos.x += 0.5 * Math.sin(yawV); pos.z += 0.5 * (Math.cos(yawV) - 1); }     // the V turns about the tails
      q.setFromAxisAngle(Y, yawV).multiply(_q1.setFromAxisAngle(Z, roll));
      pos.y += Math.abs(Math.sin(roll)) * SKI.waist * 0.5;
      // a butter (or a press on a box or rail): pitched about the pressed end, which stays down
      if (Math.abs(press) > 0.002) {
        const pa = press * 0.42, zp = (press > 0 ? 1 : -1) * zpL;
        q.multiply(_q1.setFromAxisAngle(X, pa));
        pos.y += zp * Math.sin(pa); pos.z += zp * (1 - Math.cos(pa));
      }
      // the air: knees up, the shape on top
      if (ext > 0.001) {
        const legW = air ? 0.05 * wob(tt * 2.1, 5 + k * 3) * (1 - 0.6 * gW) * (1 - popK) : 0;   // loose legs in a straight air
        pos.x += A[0] * ext; pos.y += (kneeUp + A[1] + legW) * ext; pos.z += A[2] * ext;
        q.multiply(_q1.setFromAxisAngle(Y, A[3] * ext)).multiply(_q1.setFromAxisAngle(X, A[4] * ext)).multiply(_q1.setFromAxisAngle(Z, A[5] * ext));
      }
      if (Math.abs(lowYaw) > 1e-4) { _q1.setFromAxisAngle(Y, lowYaw); pos.applyQuaternion(_q1); q.premultiply(_q1); }
      if (crashW > 0.01) { pos.y += 0.2 * crashW; q.multiply(_q1.setFromAxisAngle(Y, s * 0.6 * crashW)); }
      if (swapK > 0.01) pos.y += 0.05 * swapK;                             // a swap unweights the skis off the rail
    }
    // ---- the pelvis: over the boots at the crouch's height, the leg column leaning with the snow's push
    const A0 = this.ankleH + SKI.thick + SKI.stack;
    let H = A0 + this.legLen * 0.98 * (0.95 - (0.5 * crouch + 0.2 * tuck)) + (this.pelvisY - this.hipY);
    H += (0.92 * (1 - crouch * 0.35) + (this.pelvisY - this.hipY) * 0.5 - H) * airW;
    const colL = H - A0;
    // skating: the hips ride over each gliding ski in turn; riding and on rails the weight never quite stops moving
    let pelX = -Math.sin(phi) * colL - pushS * 0.14 * strk + (0.016 + 0.014 * railW) * wob(tt * (1.7 + 0.9 * railW), 4.4) * (1 - airW);
    let pelY = A0 + colL * Math.cos(phi) * Math.cos(psi);
    const pelZ = -0.08 - 0.12 * crouch + 0.24 * press - 0.05 * tuck + Math.sin(psi) * colL * 0.8;
    // ---- where the upper body and head go
    let face = 0;
    if (ground && speed > 0.8) face = clamp(S.sw ? Math.atan2(-vb.x, -vb.z) : Math.atan2(vb.x, vb.z), -1.5, 1.5) * smoothstep(0.8, 2.5, speed);
    if (S.sw && ground && Math.abs(face) > 0.15) this._swSide = face > 0 ? 1 : -1;
    const swSide = (this._swSide || 1) * (S.lookBack ? -1 : 1), swK = sp('swK', S.sw && ground ? 1 : 0, 6);
    // now and then a look round, riding along
    const gl = this._gl;
    if (t > gl.next || t < gl.next - 30) { gl.yaw = (Math.random() - 0.5) * 0.9; gl.pitch = (Math.random() - 0.35) * 0.2; gl.until = t + 0.6 + Math.random() * 0.8; gl.next = gl.until + 2.5 + Math.random() * 4; }
    const glance = t < gl.until && ground && Math.abs(S.edge || 0) < 0.5 && brake < 0.2 && skate < 0.2;
    // in a spin the shoulders and head lead well ahead of the hips; crouched with a spin wound up, they coil the other
    // way first (windup + is a spin to the right, so the shoulders turn left), and unwind into the spin at the pop
    const spinLead = sp('spinLead', air ? clamp(Wy * 0.09 + (P.wy ? P.wy.v : 0) * 0.035, -0.8, 0.8) : 0, 16);
    const wind = sp('wind', ground ? clamp(S.windup || 0, -1, 1) : 0, 10);
    const pressN = Math.max(0, press), pressT = Math.max(0, -press);
    let twT, sdT, lnT, hyT, hpT;
    if (air) {
      // a grab held, the body moves round it a little; a straight air sways loosely; a flip tucks the chest to the knees
      // after the throw that starts it (back: head and chest thrown back; front: thrown forward), the head tucked in a
      // front flip and back, spotting, in a back flip
      const sway = 0.08 * gW + 0.2 * flow;
      twT = (gd ? gd.twist : 0) + sway * wob(tt * 1.25, 8.8);
      sdT = (gd ? gd.side : clamp(Wz * 0.03, -0.2, 0.2)) + (0.05 * gW + 0.1 * flow) * wob(tt * 1.05, 6.1);
      lnT = (gd ? gd.lean : 0.16 + clamp(Wx * 0.045, -0.35, 0.3) + 0.12 * prep + 0.42 * flF + 0.3 * flB) + 0.28 * popK
        + 0.4 * throwF - 0.6 * arch - 0.15 * opening + 0.1 * flow * wob(tt * 0.85, 4.4);
      hyT = clamp(Wy * 0.08, -0.55, 0.55) + 0.12 * flow * wob(tt * 0.6, 12.5);
      hpT = 0.08 + 0.3 * prep + 0.32 * flF - 0.28 * flB - 0.3 * arch + 0.1 * flow * wob(tt * 0.7, 3.3);   // spotting the spin round, then the landing
    } else if (rail) {
      // the chest's angle to the rail (alpha) is its own slow spring: a swap swivels the skis under it, and in a slide
      // it is turned most of the way down the rail
      const aT = ra - 1.2 * Math.sin(ra);
      if (!this._wasRail || !P.alpha) { const tw0 = P.tw ? P.tw.x : 0; (P.alpha || (P.alpha = new Spring(0))).set(tw0 + ra); }
      const aCur = P.alpha.x, alpha = sp('alpha', aCur + wrapPi(aT - aCur), 6);
      twT = wrapPi(alpha - ra);
      sdT = (S.balance || 0) * 0.35 + 0.05 * wob(tt * 2.2, 7.7);           // balance corrections all the way along
      lnT = 0.24 + 0.4 * pressN - 0.25 * pressT;
      // the head looks down the rail over the nearer shoulder (kept until the chest has come right round), and turns
      // with the body while the skis swivel
      const aw = wrapPi(alpha);
      if (Math.abs(aw) < 2.3) this._railLook = aw < 0 ? -1 : 1;
      const look = Math.abs(aw) < 2.3 ? clamp(-aw, -1.45, 1.45) : -(this._railLook || 1) * 1.45;
      hyT = twT + look * (1 - swapK); hpT = 0.12;
    } else {
      twT = face * (0.3 + 0.45 * brake) + swSide * 0.32 * swK + clamp(-Wy * 0.05, -0.22, 0.22) - pushS * 0.12 * strk + wind * 0.6;
      sdT = 0;
      lnT = 0.2 + 0.5 * tuck - 0.3 * pressT + 0.45 * pressN + 0.1 * strideW + 0.2 * (S.loading ? 1 : 0);
      hyT = face * (0.85 + 0.12 * brake) + clamp(Wy * 0.22, -0.45, 0.45) + swSide * 1.35 * swK + (glance ? gl.yaw : 0) - wind * 0.45;   // where it is going
      hpT = 0.05 + (glance ? gl.pitch : 0);
    }
    const wB = air && gd ? 13 : 9, zA = air ? 0.75 : 1;                   // a grab's shape comes quickly, swinging a little past
    const tw = sp('tw', twT, air && gd ? 13 : 8.5, zA), sd = sp('sd', sdT, wB, zA), ln = sp('ln', lnT, air ? (popK > 0.1 ? 20 : wB + 2) : 9, zA), hy = sp('hy', hyT, rail ? 7 : 9), hp = sp('hp', hpT, 7, air ? 0.8 : 1);
    const onSnow = 1 - airW;
    // a landing bends the knees with the chest kept up; a transition's compression puts the chest over the knees
    const lean = ln + (0.42 * crouch * (1 - gW) - 0.42 * (landX + absorb) + 0.1 * absorb + 0.45 * crunch + 1.4 * Math.max(0, comp)) * onSnow + 0.02 * wob(tt * 1.1, 9.1);
    const idleY = 0.035 * wob(tt * 0.9, 3.7) * onSnow * (1 - railW);      // the shoulders turn a little, riding along
    // (in a grab the hips turn with it too, the grab's own share or a third: not the chest alone, 2026-11-03)
    const hipK = sp('hipK', gd ? (gd.hips ?? 0.35) : 0.3, 10);
    const chYaw = tw + spinLead - lowYaw * 0.4 + idleY, pelYaw = tw * (hipK + 0.12 * railW) - spinLead * 0.15 + lowYaw * 0.55 - pushS * 0.1 * strk;
    const chRoll = phi * 0.3 + sd * 0.6 + pushS * 0.1 * strk + 0.025 * wob(tt * 1.3, 5.2) * onSnow, pelRoll = phi * 0.72 + sd * 0.2, pelPitch = lean * 0.4 * gW;
    // on the snow the outside leg must still reach its boot: the pelvis comes down rather than lifting a ski
    if (airW < 0.5) {
      const hw = this.hipHalf, ca = Math.cos(pelYaw), sa = Math.sin(pelYaw), cb = Math.cos(pelRoll), sb = Math.sin(pelRoll), y0 = pelY;
      for (let k = 0; k < 2; k++) {
        const s = k ? -1 : 1, an2 = this.ankleLocal(this.sk[k], _v2);
        const dx = pelX + s * hw * cb * ca - an2.x, dz = pelZ - s * hw * cb * sa - an2.z, dy = y0 + s * hw * sb - an2.y;
        const d0 = Math.sqrt(dx * dx + dy * dy + dz * dz), d1 = softReach(d0, this.legLen, 0.88, 0.965), dy2 = d1 * d1 - dx * dx - dz * dz;
        if (d1 < d0 && dy2 > 0) pelY = Math.min(pelY, an2.y + Math.sqrt(dy2) - s * hw * sb);
      }
    }
    const pelQ = _pelQ.copy(R).multiply(_q1.setFromAxisAngle(Y, pelYaw)).multiply(_q1.setFromAxisAngle(Z, pelRoll));
    if (Math.abs(pelPitch) > 1e-4) pelQ.multiply(_q1.setFromAxisAngle(X, pelPitch));
    const chQ = _chQ.copy(R).multiply(_q1.setFromAxisAngle(Y, chYaw)).multiply(_q1.setFromAxisAngle(Z, chRoll)).multiply(_q1.setFromAxisAngle(X, lean));
    if (crashW > 0.01) chQ.multiply(_q1.setFromEuler(_eu.set(Math.sin(t * 3.1) * 0.6 * crashW, Math.sin(t * 2.3) * 0.5 * crashW, Math.cos(t * 2.7) * 0.6 * crashW)));
    // root bone: turned with the pelvis, moved so the pelvis bone lands on its place
    this.setWorldQ(b.root, _q2.copy(pelQ).multiply(this.rest.root.q));
    b.pelvis.updateWorldMatrix(false, false);
    const off = _v2.setFromMatrixPosition(b.pelvis.matrixWorld).sub(_v3.setFromMatrixPosition(b.root.matrixWorld));
    this.setWorldPos(b.root, _v3.set(pelX, pelY, pelZ).applyQuaternion(R).add(BP).sub(off));
    // the spine shares the turn from the pelvis to the chest
    this.blendBone(b.pelvis, 'pelvis', pelQ, chQ, 0);
    this.blendBone(b.spine, 'spine', pelQ, chQ, 0.35); this.blendBone(b.spine1, 'spine1', pelQ, chQ, 0.7); this.blendBone(b.chest, 'chest', pelQ, chQ, 1);
    // the head: steady, eyes kept level, looking where it goes (into the turn, round a spin, down the rail, back riding switch)
    // on the snow and rails the head's aim is against the skis (so the chest's turn is taken off it); in the air it mostly keeps with the body
    const hdYaw = clamp(hy - tw * (1 - 0.4 * airW) + lowYaw * 0.32 + 0.06 * wob(tt * 0.7, 2.9) * onSnow, -1.45, 1.45);
    const hdQ = _hdQ.copy(chQ).multiply(_q1.setFromAxisAngle(Y, hdYaw)).multiply(_q1.setFromAxisAngle(Z, -chRoll * 0.5)).multiply(_q1.setFromAxisAngle(X, hp - lean * 0.62));
    this.blendBone(b.neck, 'neck', chQ, hdQ, 0.5); this.blendBone(b.head, 'head', hdQ, hdQ, 0);
    this.blendBone(b.clL, 'clL', chQ, chQ, 0); this.blendBone(b.clR, 'clR', chQ, chQ, 0);
    // ---- grabs: which point each hand holds, cross-fading from the one it held before; let go as the landing comes
    const holdOK = ext > 0.55;                                             // let go a moment before touchdown
    this._pt[0].set(0, 0, 0); this._pt[1].set(0, 0, 0); this._hold[0] = this._hold[1] = 0;
    for (let k = 0; k < 2; k++) {
      const side = k ? 'R' : 'L', Hs = this.hs[k];
      let want = null; if (gd) for (const h of gd.hands) if (h[0] === side) want = h;
      const w = sp(HWN[k], want && holdOK ? 1 : 0, want && holdOK ? 22 : 12);
      if (want && want !== Hs.cur && !(Hs.cur && Hs.cur[1] === want[1] && Hs.cur[2] === want[2] && Hs.cur[3] === want[3])) {
        if (Hs.cur && w > 0.05) { Hs.prev = Hs.cur; Hs.f.set(0); } else { Hs.prev = null; Hs.f.set(1); }
        Hs.cur = want;
      }
      Hs.fx = Hs.f.to(1, 13, dt);
      Hs.w = Hs.cur ? w : 0;
      // the grabbed ski is brought up to the hand when the hand cannot reach it (at most 60 cm); while the hand moves to
      // another point the pull moves with it (from the point it held, weighted out, to the new one, weighted in)
      if (Hs.w > 0.02) {
        const ua = k ? b.uaR : b.uaL; ua.updateWorldMatrix(false, false);
        const sh = _v2.setFromMatrixPosition(ua.matrixWorld), reach = (this.len.ua + this.len.fa) * 0.92;
        const f = Hs.prev && Hs.fx < 0.999 ? smooth01(Hs.fx) : 1;
        for (let j = 0; j < 2; j++) {
          const spec = j ? Hs.prev : Hs.cur, wj = (j ? 1 - f : f) * Hs.w;
          if (!spec || wj < 0.01) continue;
          // measured to where the wrist will be (the palm on the edge, the fingers round it), kept inside the arm's soft range
          const kk = spec[1] === 'L' ? 0 : 1, gp = this.skiPoint(this.sk[kk], spec[1], spec[2], spec[3], this.gpB);
          this._hold[kk] = Math.max(this._hold[kk], wj);
          const wp = _v4.copy(gp.pt).addScaledVector(gp.fingers, -0.07).addScaledVector(gp.palm, -0.03), dd = wp.distanceTo(sh);
          if (dd > reach) this._pt[kk].addScaledVector(_v3.subVectors(sh, wp).normalize().applyQuaternion(qi), Math.min(0.6, dd - reach) * wj);
        }
      }
    }
    for (let k = 0; k < 2; k++) {
      const pl = this.pull[k], N3 = PULLN[k];
      pl.set(sp(N3[0], this._pt[k].x, 20), sp(N3[1], this._pt[k].y, 20), sp(N3[2], this._pt[k].z, 20));
      this.sk[k].pos.add(pl);
      // a held ski is kept out of the torso (a straight pull to the shoulder can go through it), as firmly as it is held
      if (this._hold[k] > 0.01) this.clearTorso(this.sk[k], this._hold[k]);
    }
    // keep each ski within its leg's reach, short of full lock (a locked knee snaps when its target moves)
    for (let k = 0; k < 2; k++) {
      const th = k ? b.thR : b.thL; th.updateWorldMatrix(false, false);
      const hip = _v2.setFromMatrixPosition(th.matrixWorld), ank = this.ankleOf(this.sk[k], _v3);
      const dd = ank.distanceTo(hip), L = this.legLen;
      const lim = Math.min(dd, 0.975 * L) + (softReach(dd, L, 0.86, 0.975) - Math.min(dd, 0.975 * L)) * airW;
      if (dd > lim) this.sk[k].pos.addScaledVector(_v4.subVectors(hip, ank).normalize().applyQuaternion(qi), dd - lim);
    }
    this.placeSki(this.skiL, this.sk[0]); this.placeSki(this.skiR, this.sk[1]);
    // ---- legs: to the boots, knees along the skis and pushed into the turn by as much as the edge is past the lean
    for (let k = 0; k < 2; k++) {
      const s = k ? -1 : 1, spk = this.sk[k];
      const ank = this.ankleOf(spk, _v5), skiQ = _q2.copy(R).multiply(spk.q);
      const kf = _kd.set(0, 0, 1).applyQuaternion(spk.q); kf.y = 0;
      if (kf.lengthSq() < 0.01) kf.set(0, 0, 1);
      kf.normalize();
      const kneeIn = ground ? clamp(this._roll[k] - phi, -0.9, 0.9) * 0.8 : 0;
      kf.x += s * 0.12 - kneeIn; kf.y += 0.25; kf.applyQuaternion(R);
      const th = k ? b.thR : b.thL, ca = k ? b.caR : b.caL, ft = k ? b.ftR : b.ftL;
      this.twoBone(th, ca, k ? 'thR' : 'thL', k ? 'caR' : 'caL', ank, kf, Z);
      this.setWorldQ(ft, _q3.copy(skiQ).multiply(this.rest[k ? 'ftR' : 'ftL'].q));
      const cuff = k ? this.bootR.cuff : this.bootL.cuff;
      const kp = _v2.setFromMatrixPosition(ca.matrixWorld), ap = _v3.setFromMatrixPosition(ft.matrixWorld);
      const shin = _v4.subVectors(ap, kp).normalize();
      cuff.position.copy(ap).addScaledVector(shin, -0.1).addScaledVector(_v6.set(0, 0, 1).applyQuaternion(skiQ), 0.012);
      cuff.quaternion.setFromUnitVectors(Y, shin.negate());
    }
    // ---- arms: loose and low riding, floating and leading the rotation in the air, out for balance on rails and butters
    // a pole plant: only between proper turns at speed (the last one held a while), and only a flick of the wrist
    const eSign = Math.abs(S.edge || 0) > 0.5 ? Math.sign(S.edge) : 0;
    if (eSign && eSign === this.lastE) this._eHold = (this._eHold || 0) + dt;
    if (ground && eSign && this.lastE && eSign !== this.lastE && speed > 6 && this.poles && (this._eHold || 0) > 0.45 && !(this.plantT < 0.9)) { this.plantK = eSign > 0 ? 1 : 0; this.plantT = 0; }
    if (eSign && eSign !== this.lastE) this._eHold = 0;
    if (eSign) this.lastE = eSign;
    if (!ground) this._eHold = 0;
    if (this.plantT !== undefined && this.plantT < 1) this.plantT += dt;
    const cF = _cF.set(0, 0, 1).applyQuaternion(chQ), cL = _cL.set(1, 0, 0).applyQuaternion(chQ);
    // forward for the hands is level with the body's up, so a chest leaning forward does not drag them down to full reach
    const cFl = _cFl.copy(cF).addScaledVector(ub, -cF.dot(ub)); if (cFl.lengthSq() < 1e-4) cFl.copy(cF); cFl.normalize();
    // in the air the arms lead a spin, on the snow they trail a pivot a little, but lead a butter spin
    const btK = ground ? smoothstep(0.3, 0.7, Math.abs(press)) : 0;
    const lead = air ? clamp(Wy * 0.07, -0.6, 0.6) : clamp(Wy * (0.06 * btK - 0.04 * (1 - btK)), -0.5, 0.5);
    const armL = this.len.ua + this.len.fa;
    for (let k = 0; k < 2; k++) {
      const side = k ? 'R' : 'L', s = k ? -1 : 1, Hs = this.hs[k];
      let lat, up, fwd;
      if (air) {
        // relaxed at the waist, a little forward and out; tight to the body in spins and corks, a little higher for a
        // back flip, forward for a front flip, out to stop a spin, forward for the landing
        lat = 0.12; up = -0.44; fwd = 0.15;
        up += clamp(-Wx * 0.015, 0, 0.1); fwd += clamp(Wx * 0.025, 0, 0.12); lat -= clamp(Math.abs(Wx) * 0.01, 0, 0.05);
        lat -= clamp(Math.abs(Wy) * 0.02 + Math.abs(Wz) * 0.02, 0, 0.11);
        lat += 0.13 * open; up += 0.06 * open;
        lat += 0.02 * prep; fwd += 0.14 * prep; up += 0.04 * prep;
        fwd += 0.12 * popK; up += 0.1 * popK;                               // the arms swing up and forward with the pop
        // a back flip: up over the head, thrown higher at its start; a front flip: reaching down the shins for the skis;
        // opening out at the end of either
        up += 0.38 * flB + 0.2 * arch - 0.16 * flF; fwd += -0.12 * flB - 0.1 * arch + 0.24 * flF + 0.1 * throwF; lat += 0.07 * flB - 0.08 * flF + 0.16 * opening;
        if (gd && gd.arms) { const m = ARM_MODE[gd.arms]; if (m) { lat = m[0]; up = m[1]; fwd = m[2]; } }
        // (the free arm of a grab floats, not held up stiff)
        if (gd && gd.arms) { lat += 0.05 * wob(tt * 1.3, 31 + k * 4); up += 0.07 * wob(tt * 1.6, 33 + k * 3); fwd += 0.06 * wob(tt * 1.1, 37 + k * 5); }
      } else if (rail) {
        const bal = S.balance || 0;
        lat = 0.21 + 0.08 * Math.abs(bal) + 0.07 * swapK; up = -0.23 - s * bal * 0.2 + 0.08 * swapK; fwd = 0.2 + 0.08 * s * Math.sin(ra);   // loose, the hand on the travel's side ahead
      } else {
        // forward and a little wide of the hips, elbows soft
        lat = 0.12 - 0.04 * tuck; up = -0.41 + 0.15 * tuck; fwd = 0.2 + 0.1 * tuck;
        const load = (S.loading ? 1 : smoothstep(0.55, 0.85, S.crouch || 0)) * (1 - tuck);   // crouched to pop: the arms load back
        fwd -= 0.16 * load; up += 0.03 * load; lat += 0.03 * load;
        lat += 0.08 * btK; up += 0.08 * btK; fwd -= 0.03 * btK;              // a butter: out for balance, not a T
        if (brake > 0.03) { const dn = (this._slip || 1) === s; fwd += brake * (dn ? 0.18 : -0.06); up += brake * (dn ? 0.1 : 0.03); lat += brake * (dn ? -0.02 : 0.06); }
        const land = clamp(absorb * 2.2, 0, 1); fwd += 0.16 * land; up += 0.05 * land;
        if (s * edge < 0) { fwd += 0.06 * Math.abs(edge); up -= 0.03 * Math.abs(edge); }   // the inside hand leads a turn
        lat -= 0.06 * wind * s;                                             // the coil swings the arms with the shoulders
      }
      if (crashW > 0.5) { lat = 0.36; up = 0.2; fwd = 0; }
      const AN = ARMN[k];
      const zArm = air ? 0.6 : 0.72;
      lat = sp(AN[0], lat, 10, zArm); up = sp(AN[1], up, 10, zArm); fwd = sp(AN[2], fwd, 10, zArm);
      // what moves faster than a spring follows goes on top: strides, pole pushes, plants, the hands' own small moves
      const pk = onSnow > 0.5 && this.plantK === k && this.plantT < 0.35 ? Math.sin(Math.PI * this.plantT / 0.35) : 0;
      if (onSnow > 0.01) {
        if (strideW > 0.01) { const opp = s === -pushS; fwd += strk2 * (opp ? 0.2 : -0.1); up += strk2 * (opp ? 0.1 : -0.02); }
        if (dpW > 0.01) { fwd += dpW * (0.36 - 0.6 * dpK) - dpW * 0.3; up += dpW * (0.12 - 0.2 * dpK); }
        if (pk > 0) { fwd += 0.05 * pk; up -= 0.03 * pk; }
      }
      const hm = (0.6 + 0.6 * railW + 1.6 * flow) * (1 - 0.7 * (Hs.w || 0)), ak = 11 + k * 4;
      if (flow > 0.01) { const sw = Math.sin(tt * 1.9 + 0.6); fwd += s * 0.09 * sw * flow; up += (0.05 + s * 0.04 * sw) * flow; lat += 0.01 * flow; }
      lat += 0.03 * hm * wob(tt * (1.6 + railW), ak); up += 0.04 * hm * wob(tt * (1.9 + railW), ak + 2); fwd += 0.05 * hm * wob(tt * (1.4 + railW), ak + 6);
      if (crashW > 0.5) up += Math.sin(t * 9 + s) * 0.2;
      const x0 = s * lat, cl = Math.cos(lead), sl = Math.sin(lead);
      const ua = k ? b.uaR : b.uaL, fa = k ? b.faR : b.faL, ha = k ? b.haR : b.haL;
      ua.updateWorldMatrix(false, false);
      const sh = _sh.setFromMatrixPosition(ua.matrixWorld);
      const wr = _wr.copy(sh).addScaledVector(cL, x0 * cl + fwd * sl).addScaledVector(ub, up).addScaledVector(cFl, -x0 * sl + fwd * cl);
      // never quite at full reach: a locked arm snaps when its target moves near the end of its range
      { const d = wr.distanceTo(sh), m = softReach(d, armL, 0.78, 0.93); if (m < d) wr.sub(sh).multiplyScalar(m / d).add(sh); }
      const fd = _fd.copy(cF).addScaledVector(ub, -0.35).normalize(), pa = _pa.copy(cL).multiplyScalar(-s);
      let curl = this.poles ? 1.25 : 0.55;
      if (Hs.w > 0.02) {
        const g = this.skiPoint(this.sk[Hs.cur[1] === 'L' ? 0 : 1], Hs.cur[1], Hs.cur[2], Hs.cur[3], this.gpA);
        if (Hs.prev && Hs.fx < 0.999) {
          const g0 = this.skiPoint(this.sk[Hs.prev[1] === 'L' ? 0 : 1], Hs.prev[1], Hs.prev[2], Hs.prev[3], this.gpB), f = smooth01(Hs.fx);
          g.pt.lerpVectors(g0.pt, g.pt, f); g.fingers.lerpVectors(g0.fingers, g.fingers, f).normalize(); g.palm.lerpVectors(g0.palm, g.palm, f).normalize();
        }
        // palm on the edge, fingers wrapped under it
        const gw = _v2.copy(g.pt).addScaledVector(g.fingers, -0.07).addScaledVector(g.palm, -0.03);
        wr.lerp(gw, Hs.w); fd.lerp(g.fingers, Hs.w).normalize(); pa.lerp(g.palm, Hs.w).normalize(); curl += (1.35 - curl) * Hs.w;
      }
      { const d = wr.distanceTo(sh), m = softReach(d, armL, 0.84 + 0.02 * Hs.w, 0.965 + 0.02 * Hs.w); if (m < d) wr.sub(sh).multiplyScalar(m / d).add(sh); }
      // the elbow: back, out and down; with the hand raised, out and a little forward
      const upK = smoothstep(-0.05, 0.2, up) * (1 - Hs.w);
      const el = _el.set(0, 0, -1).applyQuaternion(chQ).addScaledVector(cL, s * (0.2 + 0.35 * Hs.w)).addScaledVector(ub, -1.15).normalize();
      if (upK > 0.01) el.lerp(_v6.copy(cL).multiplyScalar(s).addScaledVector(cFl, 0.3).addScaledVector(ub, 0.15).normalize(), upK).normalize();
      this.twoBone(ua, fa, k ? 'uaR' : 'uaL', k ? 'faR' : 'faL', wr, el, NZ);
      const HH = this.hands[side];
      this.aim(ha, this.rest[k ? 'haR' : 'haL'].q, HH.fd, HH.palm, fd, pa);
      this.curl(HH, curl);
      // the pole: from the grip down and back; forward into a plant; hanging from the strap while grabbing
      if (this.poles) {
        const pole = k ? this.poleR : this.poleL, aw = Math.max(airW, railW);
        let tx = s * 0.08 + s * 0.02 * aw, ty = -1 + 0.25 * aw, tz = -0.55 - 0.35 * aw;
        if (pk > 0) { const w = 0.85 * pk; tx += (s * 0.12 - tx) * w; ty += (-1 - ty) * w; tz += (0.3 - tz) * w; }
        if (dpW > 0.01) { const fx = s * 0.12, fy = -1 + 0.4 * dpK, fz = 0.1 - 1.1 * dpK; tx += (fx - tx) * dpW; ty += (fy - ty) * dpW; tz += (fz - tz) * dpW; }
        if (Hs.w > 0.02) { const w = Math.min(1, Hs.w * 1.4); tx += (s * 0.35 - tx) * w; ty += (0.15 - ty) * w; tz += (-1 - tz) * w; }
        const tip = _tip.set(tx, ty, tz).normalize().applyQuaternion(R);
        pole.position.copy(_v2.setFromMatrixPosition(ha.matrixWorld)).addScaledVector(fd, 0.06).addScaledVector(pa, 0.025);
        pole.quaternion.setFromUnitVectors(Y, tip.negate());
      }
    }
    // ---- helmet, and where the eyes are for the first-person camera
    const hpos = this.headPos.setFromMatrixPosition(b.head.matrixWorld);
    const hFwd = _v2.set(0, 0, 1).applyQuaternion(hdQ), hUp = _v3.set(0, 1, 0).applyQuaternion(hdQ);
    this.eye.copy(this.eyeOff).applyQuaternion(hdQ).add(hpos);
    this.helmet.position.copy(this.eye).addScaledVector(hUp, 0.04).addScaledVector(hFwd, -0.062);
    this.helmet.quaternion.copy(hdQ);
    this.headQ.copy(hdQ); this.eye.addScaledVector(hFwd, 0.02);
    this._wasRail = rail; this._pra = ra;
    this.flushTree(body);
  }
  // the rest of the rider's tree (fingers, face, toes, the meshes) after the pose: the bones posed this frame are
  // current already, so only the others are worked out (this was a walk of the whole tree)
  flushTree(o) {
    const ch = o.children, f = this._frame;
    for (let i = 0; i < ch.length; i++) {
      const c = ch[i];
      // a skinned mesh does more in its own update (its bind matrix's inverse follows it), so it keeps that update
      if (c.isSkinnedMesh) { c.updateMatrixWorld(true); continue; }
      if (c._wf !== f) { if (c.matrixAutoUpdate) c.updateMatrix(); c.matrixWorld.multiplyMatrices(o.matrixWorld, c.matrix); c.matrixWorldNeedsUpdate = false; }
      if (c.children.length) this.flushTree(c);
    }
  }
  // push a ski (in the body's frame) out of a capsule round the torso, pelvis to neck
  // (the push blends every touching point, deeper ones counting more, so it never jumps from one point to another)
  clearTorso(sk, w) {
    const b = this.b, R = this.rootQ, qi = _qi2.copy(R).invert();
    const A = _ca.setFromMatrixPosition(b.pelvis.matrixWorld), Bn = _cb.setFromMatrixPosition(b.neck.matrixWorld), ab = _cc.subVectors(Bn, A), L2 = ab.lengthSq();
    const sq = _kq.copy(R).multiply(sk.q), base = _cd.copy(sk.pos).applyQuaternion(R).add(this.body.position), rad = 0.17;
    let wsum = 0, worst = 0; _cg.set(0, 0, 0);
    for (let i = 0; i < 5; i++) {
      const p = _ce.set(0, SKI.thick, (i / 4 * 2 - 1) * SKI.len * 0.45).applyQuaternion(sq).add(base);
      const tt = clamp(_cf.subVectors(p, A).dot(ab) / L2, 0, 1), c = _cf.copy(A).addScaledVector(ab, tt), d = p.distanceTo(c), pen = rad - d;
      if (pen <= 0 || d < 1e-5) continue;
      const wi = pen * pen; _cg.addScaledVector(_cf.subVectors(p, c), wi / d); wsum += wi; if (pen > worst) worst = pen;
    }
    if (wsum > 0 && _cg.lengthSq() > 1e-10) sk.pos.addScaledVector(_cg.normalize().applyQuaternion(qi), worst * w);
  }
  // seconds until the flight meets the snow (9 if not within about half a second)
  timeToGround(p, v) {
    const g0 = p.y - height(p.x, p.z);
    if (g0 <= 0) return 0;
    if (g0 > Math.max(0, -v.y) * 0.45 + 1.0 + 0.14 * Math.hypot(v.x, v.z)) return 9;
    let gp = g0;
    for (let k = 1; k <= 9; k++) {
      const tt = k * 0.045, gap = p.y + v.y * tt - 4.905 * tt * tt - height(p.x + v.x * tt, p.z + v.z * tt);
      if (gap <= 0) return tt - 0.045 + 0.045 * gp / (gp - gap);
      gp = gap;
    }
    return 9;
  }
  // a point on a ski, with the palm's and fingers' directions for holding it there (into out: { pt, palm, fingers })
  skiPoint(sp, ski, at, edgeK, out) {
    const R = this.rootQ, q = _kq.copy(R).multiply(sp.q);
    const z = at * SKI.len / 2 * 0.98, side = ski === 'L' ? 1 : -1, o = edgeK === 'in' ? -side : side, aa = Math.abs(at);
    const w = (SKI.waist + (SKI.tip - SKI.waist) * Math.pow(aa, 2.2)) / 2;
    const rise = aa > 0.78 ? Math.pow((aa - 0.78) / 0.22, 2.1) * 0.075 : 0;
    out.pt.set(edgeK === 'end' ? 0 : o * (w + 0.005), rise + SKI.thick * 0.5, z).applyQuaternion(q).add(_kv.copy(sp.pos).applyQuaternion(R)).add(this.body.position);
    const sx = _kx.set(1, 0, 0).applyQuaternion(q), sy = _ky.set(0, 1, 0).applyQuaternion(q);
    if (edgeK === 'end') { out.palm.copy(sy).negate(); out.fingers.set(0, 0, Math.sign(at) || 1).applyQuaternion(q).addScaledVector(sy, -0.6).normalize(); }
    else { out.palm.copy(sx).multiplyScalar(-o); out.fingers.copy(sy).negate().addScaledVector(sx, -o * 0.35).normalize(); }
    return out;
  }
  // the ankle over a ski: in the body's frame, and in the world
  ankleLocal(sp, out) { return out.set(0, SKI.thick + SKI.stack + this.ankleH, -this.ankleBack).applyQuaternion(sp.q).add(sp.pos); }
  ankleOf(sp, out) { return this.ankleLocal(sp, out).applyQuaternion(this.rootQ).add(this.body.position); }
  placeSki(ski, sp) {
    ski.position.copy(sp.pos).applyQuaternion(this.rootQ).add(this.body.position);
    ski.quaternion.copy(this.rootQ).multiply(sp.q);
  }
  curl(H, amt) {
    for (const f of H.fingers) {
      const a = amt * (f.thumb ? 0.45 : 1) * f.sign;
      f.bn.quaternion.copy(f.rest).multiply(_q1.setFromAxisAngle(f.axis, a));
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
// an orthonormal basis with x along a and y towards b
function basisInto(m, a, b) {
  const x = _bx.copy(a).normalize();
  const y = _by.copy(b).addScaledVector(x, -b.dot(x)); if (y.lengthSq() < 1e-8) y.set(0, 1, 0).addScaledVector(x, -x.y); y.normalize();
  return m.makeBasis(x, y, _bz.crossVectors(x, y));
}
