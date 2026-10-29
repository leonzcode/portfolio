// Aircraft: a Cessna 172 and an Airbus (Eurocopter) EC135 helicopter, catalogue entries in cars.js with air: 'plane'
// or air: 'heli'. Three parts here:
//   setupRig(rig)   (called by cars.js loadCar for an aircraft) finds the moving parts in the model (propeller, main
//                   and tail rotor, ailerons, elevator, rudder), splits the blades from their hubs, adds the blurred
//                   discs a fast rotor shows, and wraps rig.update so look.rotor (turns a second), look.elev, look.ail,
//                   look.rud, look.tilt*, look.broke animate them. A copy driven only by its pose and rig.update(dt,
//                   look) (another player's, net) animates the same.
//   a Vehicle hook  (vehicle.js VEHICLE_HOOKS) gives an aircraft's body its mass, inertia, centre of mass and a set of
//                   collision circles over the wings, tail and rotor disc, each at its own height.
//   class Air       (drive.js makes one, as it does flight.js's Flight) reads the keys, adds the aerodynamic forces in
//                   each physics step (vehicle.ext), and does the sound, the gauges, the camera and the crashes.
//
// The plane: W/S the throttle (S at idle holds the brakes on the ground), Space pulls the nose up (rotate on the
// take-off run once fast enough, climb), Shift pushes it down, A/D steer the nose wheel on the ground and bank in the
// air, F the flaps. Lift, drag and the moments come from the C172's published stability derivatives (Roskam, and the
// figures used by JSBSim's c172 model): it lifts off at about 100 km/h, cruises near 220 km/h and stalls near 85 km/h
// clean. Let go of the stick and an assist holds the pitch you had and levels the wings, gently.
// The helicopter: Space raises the collective (climb), Shift lowers it, W/S tip the nose down or up and it moves that
// way, A/D turn on the spot (the pedals) and bank into the turn once moving. Let go of Space and Shift in the air and
// it holds its height; let go of W/S and A/D and it levels itself.
import * as THREE from 'three';
import { VEHICLE_HOOKS } from './vehicle.js?v=48';

const G = 9.81, RHO = 1.225;
const clamp = THREE.MathUtils.clamp;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _eu = new THREE.Euler();
const rnd = (a, b) => a + Math.random() * (b - a);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------------------------------------------------------
// the two aircraft (frame as the cars': forward -z, up +y, right +x, origin on the ground between the gear)

export const AIR = {
  c172: {
    kind: 'plane',
    // about 1000 kg with a pilot and fuel (empty 767 kg, maximum 1111 kg); inertia about the pitch, yaw and roll axes
    Ib: [1825, 2667, 1285], com: [0, 1.15, 0.55],
    // wing 16.2 m2, span 11 m, chord 1.49 m; Lycoming O-360, 134 kW (120 kW at the propeller here), about 2.7 kN static
    S: 16.2, b: 11.0, c: 1.49, power: 120e3, eta: 0.75, Tstatic: 2700,
    CL0: 0.31, CLa: 5.143, CLq: 3.9, CLde: 0.43, alphaStall: 0.27, CD0: 0.031, k: 0.054,
    CYb: -0.31, CYdr: 0.187,
    Clb: -0.089, Clp: -0.47, Clr: 0.096, Clda: 0.178, Cldr: 0.0147,
    Cm0: -0.015, Cma: -0.89, Cmq: -12.4, Cmde: -1.28,
    Cnb: 0.065, Cnp: -0.03, Cnr: -0.099, Cnda: -0.053, Cndr: -0.0657,
    deMax: 0.44, daMax: 0.35, drMax: 0.28,
    flaps: [0, 10, 20, 30], // degrees: each adds lift and drag
    propRpm: [700, 2700], blades: 2,
    // collision circles: [x, y, z, r, half height, part]
    circles: [
      [0, 1.15, -1.55, 0.55, 0.55, 'nose'], [0, 1.2, -0.5, 0.58, 0.6, 'body'], [0, 1.25, 0.6, 0.58, 0.65, 'body'], [0, 1.25, 1.7, 0.5, 0.55, 'body'],
      [0, 1.3, 2.8, 0.42, 0.45, 'body'], [0, 1.35, 3.9, 0.34, 0.4, 'body'], [0, 1.4, 5.0, 0.3, 0.35, 'body'], [0, 1.9, 6.15, 0.42, 0.9, 'tail'],
      [-1.35, 2.3, 0.75, 0.68, 0.25, 'wingL'], [-2.65, 2.3, 0.75, 0.66, 0.25, 'wingL'], [-3.9, 2.3, 0.75, 0.64, 0.25, 'wingL'], [-5.0, 2.3, 0.75, 0.55, 0.25, 'wingL'],
      [1.35, 2.3, 0.75, 0.68, 0.25, 'wingR'], [2.65, 2.3, 0.75, 0.66, 0.25, 'wingR'], [3.9, 2.3, 0.75, 0.64, 0.25, 'wingR'], [5.0, 2.3, 0.75, 0.55, 0.25, 'wingR'],
      [-1.15, 1.25, 5.95, 0.5, 0.2, 'tail'], [1.15, 1.25, 5.95, 0.5, 0.2, 'tail'],
    ],
    engine: [0, 1.4, -1.3], // where smoke and fire come from
    // points of the airframe that meet the ground when it is not on its wheels: nose, cabin, wing tips, tail
    body: [[0, 0.55, -1.7], [0, 1.65, -1.6], [-0.5, 2.05, 0.3], [0.5, 2.05, 0.3], [-5.4, 2.3, 0.3], [5.4, 2.3, 0.3], [-5.4, 2.3, 1.5], [5.4, 2.3, 1.5],
      [-0.6, 2.45, 0.9], [0.6, 2.45, 0.9], [0, 0.7, 1.5], [0, 1.0, 5.4], [0, 3.25, 6.6], [-1.7, 1.25, 6.0], [1.7, 1.25, 6.0], [-0.55, 0.75, -0.2], [0.55, 0.75, -0.2]],
  },
  ec135: {
    kind: 'heli',
    // about 2400 kg (empty 1455 kg, maximum 2910 kg)
    Ib: [5000, 4200, 1500], com: [0, 1.35, 0.15],
    // main rotor 10.2 m across (the model's 9.6 m), 395 rpm; the Fenestron about 3600 rpm; thrust at full collective
    // 1.6 weights
    rotorR: 4.82, rotorRpm: 395, tailRpm: 3600, blades: 4, tailBlades: 10, Tmax: 1.6,
    // fuselage drag areas (m2) forward, up and across
    CdA: [1.7, 9, 5.5],
    circles: [
      [0, 1.45, -2.6, 0.85, 0.75, 'nose'], [0, 1.5, -1.5, 0.9, 0.85, 'body'], [0, 1.6, -0.4, 0.9, 0.85, 'body'], [0, 1.7, 0.7, 0.8, 0.7, 'body'],
      [0, 1.95, 1.9, 0.38, 0.35, 'boom'], [0, 2.0, 3.1, 0.35, 0.32, 'boom'], [0, 2.05, 4.3, 0.33, 0.32, 'boom'], [0, 2.2, 5.45, 0.42, 0.55, 'boom'], [0, 2.3, 6.3, 0.7, 0.9, 'tail'],
      // the rotor disc's rim: a rotor strike
      ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => { const a = i / 10 * Math.PI * 2; return [Math.sin(a) * 4.15, 3.04, Math.cos(a) * 4.15, 0.62, 0.22, 'rotor']; }),
    ],
    engine: [0, 2.7, 0.4],
    body: [[-0.85, 0.6, -2.8], [0.85, 0.6, -2.8], [-0.85, 0.6, 0.6], [0.85, 0.6, 0.6], [-0.8, 2.6, -1.5], [0.8, 2.6, -1.5], [-0.8, 2.7, 0.8], [0.8, 2.7, 0.8],
      [0, 1.2, -3.3], [0, 3.35, 0], [0, 2.0, 7.2], [0, 3.9, 6.6], [-0.35, 1.9, 4.0], [0.35, 1.9, 4.0], [-1.1, 0.1, -2.1], [1.1, 0.1, -2.1], [-1.1, 0.1, 0.9], [1.1, 0.1, 0.9]],
  },
};
export const isAir = spec => !!(spec && spec.air && AIR[spec.id]);

// ---------------------------------------------------------------------------------------------------------------
// the rig: moving parts

function blurTexture(blades) {
  // a disc of soft streaks: what a spinning rotor or propeller looks like to the eye or a camera
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x + 0.5) / N * 2 - 1, v = (y + 0.5) / N * 2 - 1, r = Math.hypot(u, v), a = Math.atan2(v, u);
    let al = 0;
    if (r < 1 && r > 0.1) {
      const streak = 0.55 + 0.45 * Math.pow(0.5 + 0.5 * Math.cos(a * blades), 6);
      al = streak * smooth(0.1, 0.22, r) * (1 - smooth(0.9, 1, r)) * (0.55 + 0.45 * r);
      // the tips run fastest: a thin brighter ring there
      al += 0.25 * Math.exp(-Math.pow((r - 0.94) / 0.025, 2));
    }
    const k = (y * N + x) * 4;
    img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = Math.round(255 * clamp(al, 0, 1));
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const BLUR = new Map();
function blurMaterial(blades, color) {
  const key = blades + ':' + color;
  if (!BLUR.has(key)) {
    const m = new THREE.MeshBasicMaterial({ map: blurTexture(blades), color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: true, fog: true });
    m.name = 'rotor_blur';
    m.forceSinglePass = true;
    BLUR.set(key, m);
  }
  return BLUR.get(key);
}

// a mesh's triangles split by a rule: one mesh per group, all sharing the source's attributes
function splitMesh(mesh, groupOf, n) {
  const g = mesh.geometry, pos = g.attributes.position, idx = g.index ? g.index.array : null;
  const tri = idx ? idx.length / 3 : pos.count / 3;
  const lists = Array.from({ length: n }, () => []);
  for (let t = 0; t < tri; t++) {
    const a = idx ? idx[t * 3] : t * 3, b = idx ? idx[t * 3 + 1] : t * 3 + 1, c = idx ? idx[t * 3 + 2] : t * 3 + 2;
    _a.fromBufferAttribute(pos, a).add(_b.fromBufferAttribute(pos, b)).add(_c.fromBufferAttribute(pos, c)).divideScalar(3);
    const k = groupOf(_a);
    if (k >= 0 && k < n) lists[k].push(a, b, c);
  }
  return lists.map(l => {
    if (!l.length) return null;
    const ng = new THREE.BufferGeometry();
    for (const k in g.attributes) ng.setAttribute(k, g.attributes[k]);
    ng.setIndex(l);
    ng.computeBoundingSphere(); ng.computeBoundingBox();
    const m = new THREE.Mesh(ng, mesh.material);
    m.name = mesh.name; m.castShadow = mesh.castShadow; m.receiveShadow = mesh.receiveShadow;
    return m;
  });
}

// a spinning part: its node under a spin group about an axis; the blades split from the hub (each blade its own mesh,
// so one can break off), and a blur disc
function spinner(rig, name, axis, blades, R, hubR, color) {
  const node = rig.model.getObjectByName(name);
  if (!node) return null;
  const meshes = [];
  node.traverse(o => { if (o.isMesh) meshes.push(o); });
  if (!meshes.length) return null;
  const spin = new THREE.Group(); spin.name = name + '_spin';
  node.parent.add(spin); spin.position.copy(node.position); spin.quaternion.copy(node.quaternion);
  node.parent.remove(node);
  // the blades about the axis: angle sectors (the first blade's angle found from the mesh)
  const ax = axis === 'x' ? 0 : axis === 'y' ? 1 : 2, u = (ax + 1) % 3, w = (ax + 2) % 3;
  const hub = [], bladeMeshes = Array.from({ length: blades }, () => []), fadeMats = [];
  let solidMat = null;
  let a0 = null;
  for (const me of meshes) {
    // (each mesh in the hub's own frame: the node itself sits at the hub, a child of it where it was put)
    me.updateMatrix();
    const M = me === node ? new THREE.Matrix4() : me.matrix, P = me.geometry.attributes.position;
    // the angle of the farthest point is a blade's
    if (a0 === null) {
      let best = 0;
      for (let i = 0; i < P.count; i += 3) {
        _a.fromBufferAttribute(P, i).applyMatrix4(M);
        const r = Math.hypot(_a.getComponent(u), _a.getComponent(w));
        if (r > best) { best = r; a0 = Math.atan2(_a.getComponent(w), _a.getComponent(u)); }
      }
    }
    const step = Math.PI * 2 / blades;
    const parts = splitMesh(me, p => {
      _b.copy(p).applyMatrix4(M);
      const r = Math.hypot(_b.getComponent(u), _b.getComponent(w));
      if (r < hubR) return 0;
      let a = Math.atan2(_b.getComponent(w), _b.getComponent(u)) - a0 + step / 2;
      a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      return 1 + Math.min(blades - 1, Math.floor(a / step));
    }, blades + 1);
    // the blades a material of their own that can fade: a fast rotor shows as a faint ghost of its blades over the
    // blur, as a camera sees it (seen edge on the disc alone would vanish)
    let fade = null, solid = null;
    parts.forEach((p, i) => {
      if (!p) return;
      if (i > 0) {
        if (!solid) solid = p.material;
        if (!solidMat) solidMat = solid;
        if (!fade) { fade = (Array.isArray(p.material) ? p.material[0] : p.material).clone(); fade.transparent = true; fade.depthWrite = false; fade.name = 'rotor_blade'; fadeMats.push(fade); }
        p.material = fade; p.renderOrder = 11;
      }
      if (me !== node) { p.position.copy(me.position); p.quaternion.copy(me.quaternion); p.scale.copy(me.scale); }
      p.userData.dmgPart = true; // damage.js leaves it alone: this module breaks it
      spin.add(p);
      if (i === 0) hub.push(p); else bladeMeshes[i - 1].push(p);
    });
  }
  // the blur: a disc about the axis
  // (its own copy of the material, for its own opacity: same program as every other disc)
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 48), blurMaterial(blades, color).clone());
  if (ax === 1) disc.rotation.x = -Math.PI / 2; else if (ax === 0) disc.rotation.y = Math.PI / 2;
  disc.name = name + '_blur'; disc.renderOrder = 12; disc.castShadow = false; disc.receiveShadow = false; disc.userData.dmgPart = true;
  // (the disc's own spin, slower than the blades: what the camera's shutter makes of them)
  const discSpin = new THREE.Group(); discSpin.name = name + '_blurspin'; discSpin.add(disc);
  spin.parent.add(discSpin); discSpin.position.copy(spin.position); discSpin.quaternion.copy(spin.quaternion);
  const q0 = spin.quaternion.clone();
  if (rig._owned) rig._owned.push(disc.material, ...fadeMats);
  return { name, spin, discSpin, disc, q0, axis: ax, angle: 0, blades: bladeMeshes, hub, broke: 0, bent: 0, R, fadeMats, solid: solidMat, a0: a0 || 0, rest: bladeMeshes.map(l => l.map(m => m.quaternion.clone())) };
}

function hinge(rig, name, axis) {
  const node = rig.model.getObjectByName(name);
  if (!node) return null;
  node.traverse(o => { if (o.isMesh) o.userData.dmgPart = true; });
  return { node, q0: node.quaternion.clone(), axis: new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0), cur: 0 };
}

// a light plane's panel: the six flight instruments on the pilot's side, radios in the middle, a glare shield over it
function cessnaPanel(rig) {
  const W = 512, H = 160, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#2b2d30'; g.fillRect(0, 0, W, H);
  const dial = (x, y, r, kind) => {
    g.fillStyle = '#0d0e10'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#8d9096'; g.lineWidth = 2; g.stroke();
    g.strokeStyle = '#e8e8e8'; g.lineWidth = 1.5;
    for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2, l = i % 2 ? 0.12 : 0.2; g.beginPath(); g.moveTo(x + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92); g.lineTo(x + Math.cos(a) * r * (0.92 - l), y + Math.sin(a) * r * (0.92 - l)); g.stroke(); }
    if (kind === 'ai') { g.save(); g.beginPath(); g.arc(x, y, r * 0.72, 0, Math.PI * 2); g.clip(); g.fillStyle = '#2f6fb0'; g.fillRect(x - r, y - r, 2 * r, r); g.fillStyle = '#6b4a2a'; g.fillRect(x - r, y, 2 * r, r); g.restore(); g.strokeStyle = '#f2c230'; g.lineWidth = 3; g.beginPath(); g.moveTo(x - r * 0.45, y); g.lineTo(x + r * 0.45, y); g.stroke(); }
    else { g.strokeStyle = '#f4f4f4'; g.lineWidth = 3; g.beginPath(); g.moveTo(x, y); g.lineTo(x + r * 0.55, y - r * 0.4); g.stroke(); }
  };
  const r = 26;
  [['asi', 44, 46], ['ai', 104, 46], ['alt', 164, 46], ['tc', 44, 112], ['hdg', 104, 112], ['vsi', 164, 112]].forEach(([k, x, y]) => dial(x, y, r, k));
  // radios and a moving map in the middle, small gauges on the right
  g.fillStyle = '#121315'; g.fillRect(222, 18, 120, 120);
  g.fillStyle = '#1d3b2a'; g.fillRect(230, 26, 104, 58);
  g.fillStyle = '#58d68d'; g.font = '600 13px monospace'; g.fillText('COM1 122.80', 236, 104); g.fillText('NAV1 110.50', 236, 124);
  for (const [x, y] of [[392, 44], [452, 44], [392, 110], [452, 110]]) dial(x, y, 20, 'eng');
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0, name: 'panel_face' });
  const trim = new THREE.MeshStandardMaterial({ color: 0x1e1f21, roughness: 0.85, metalness: 0, name: 'panel_trim' });
  if (rig._owned) rig._owned.push(face, trim);
  const grp = new THREE.Group(); grp.name = 'air_panel';
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.34, 0.1), [trim, trim, trim, trim, face, trim]);
  box.position.set(0, 1.6, -0.06);
  const shield = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.03, 0.22), trim);
  shield.position.set(0, 1.78, -0.12);
  grp.add(box, shield);
  // the two control wheels (yokes), turned and pushed with the stick (animate)
  rig._air.yokes = [];
  for (const x of [-0.27, 0.27]) {
    const y = new THREE.Group(); y.name = 'yoke'; y.position.set(x, 1.5, 0.1);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.03, 0.03), trim);
    const gl = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.11, 0.04), trim); gl.position.set(-0.16, 0.04, 0);
    const gr = gl.clone(); gr.position.x = 0.16;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.22, 8), trim); col.rotation.x = Math.PI / 2; col.position.z = -0.11;
    y.add(bar, gl, gr, col);
    grp.add(y); rig._air.yokes.push({ g: y, z0: 0.1 });
  }
  grp.traverse(o => { if (o.isMesh) { o.userData.dmgPart = true; o.castShadow = false; o.receiveShadow = true; } });
  return grp;
}

export function setupRig(rig) {
  const A = AIR[rig.id];
  if (!A || rig._air) return;
  const P = rig._air = { A, spinners: [], hinges: {}, look: { rotor: 0, tail: 0, elev: 0, ail: 0, rud: 0, flap: 0, tiltX: 0, tiltZ: 0, broke: 0, gear: 1 } };
  try {
    if (A.kind === 'plane') {
      const s = spinner(rig, 'prop', 'z', A.blades, 0.95, 0.16, 0x6a6a6a);
      if (s) { s.disc.position.z = -0.02; P.prop = s; P.spinners.push(s); }
      P.hinges.elevator = hinge(rig, 'elevator', 'x');
      P.hinges.rudder = hinge(rig, 'rudder', 'y');
      P.hinges.aileronL = hinge(rig, 'aileron_L', 'x');
      P.hinges.aileronR = hinge(rig, 'aileron_R', 'x');
      rig.camBack = 4.5; rig.camUp = 0.8;
      // the model has no instrument panel: a simple one of our own under the windscreen (the player's copy only)
      if (!rig.npc) { try { rig.model.add(cessnaPanel(rig)); } catch (e) { console.warn('aircraft panel', e); } }
    } else {
      const m = spinner(rig, 'rotor_main', 'y', A.blades, A.rotorR, 0.62, 0x555555);
      if (m) { m.disc.position.y = 0.08; P.main = m; P.spinners.push(m); }
      const t = spinner(rig, 'rotor_tail', 'x', A.tailBlades, 0.58, 0.12, 0x2a2a2a);
      if (t) { P.tail = t; P.spinners.push(t); }
      rig.camBack = 6.5; rig.camUp = 1.0;
    }
  } catch (e) { console.warn('aircraft rig', e); }
  // the size the other modules go by (a person walking round it, the doors, the camera): the fuselage's, not the
  // wing span or the rotor disc (the wings and the disc have their own collision circles, vehicle.js)
  rig.span = { ...rig.dims };
  if (A.kind === 'plane') Object.assign(rig.dims, { length: 8.8, width: 1.3, height: 2.6, front: 2.1, rear: 6.7 });
  else Object.assign(rig.dims, { length: 10.7, width: 1.75, height: 3.4, front: 3.35, rear: 7.35 });
  // the contact shadow (cars.js) only under the fuselage
  const cs = rig.object.getObjectByName('contact_shadow');
  if (cs) {
    P.shadow = cs;
    if (A.kind === 'plane') { cs.scale.set(1.5, 1, 6.5); cs.position.set(0, 0.04, 1.6); }
    else { cs.scale.set(2.6, 1, 4.2); cs.position.set(0, 0.04, -0.6); }
  }
  // (the rig's own update keeps the wheels, lamps and cabin; the parts here go after it)
  const base = rig.update.bind(rig);
  rig.update = (dt, s = {}) => { base(dt, s); try { animate(rig, dt || s.dt || 0, s); } catch (e) { if (!P.err) { P.err = true; console.warn('aircraft animate', e); } } };
  rig.airLook = P.look;
}

// the moving parts from a look (the player's, or a copy's from the network)
function animate(rig, dt, s) {
  const P = rig._air, A = P.A;
  const L = P.look;
  for (const k of ['rotor', 'tail', 'elev', 'ail', 'rud', 'flap', 'tiltX', 'tiltZ', 'broke', 'gear', 'bent', 'air', 'fx']) if (s[k] !== undefined) L[k] = s[k];
  // a copy driven from the network (mp.js): what the crash on the other page did is done here too
  if (!P.local) { try { copyFx(rig, P, L, dt); } catch (e) { if (!P.fxErr) { P.fxErr = true; console.warn('aircraft copy fx', e); } } }
  // the dark patch under a car is no use under a plane's wings or a flying machine: only under the fuselage, on the ground
  if (P.shadow) P.shadow.visible = !L.air;
  for (const sp of P.spinners) {
    const tps = sp === P.tail ? (L.tail !== undefined ? L.tail : L.rotor * 9) : L.rotor;
    sp.angle = (sp.angle + tps * Math.PI * 2 * dt) % (Math.PI * 2);
    _a.set(0, 0, 0).setComponent(sp.axis, 1);
    _q.setFromAxisAngle(_a, sp.angle);
    sp.spin.quaternion.copy(sp.q0).multiply(_q);
    // the main rotor's disc tips with the cyclic
    if (sp === P.main) { _q2.setFromEuler(_eu.set(L.tiltX || 0, 0, L.tiltZ || 0)); sp.spin.quaternion.premultiply(_q2); }
    // blades shown while they turn slowly, the blur from about 4 turns a second up
    const f = Math.abs(tps);
    const blur = clamp((f - 2.5) / 4, 0, 1);
    const broke = sp === P.tail ? ((L.broke >> 8) & 255) : (L.broke & 255);
    const left = sp.blades.length - popcount(broke);
    // (the main rotor's disc and blade ghost stronger: seen from the chase camera above it, against the ground, the
    // fainter ones vanished)
    const isMain = sp === P.main;
    sp.disc.material.opacity = (isMain ? 0.85 : 0.55) * blur;
    const op = 1 - (isMain ? 0.6 : 0.75) * blur;
    for (const fm of sp.fadeMats) if (Math.abs(fm.opacity - op) > 0.01) fm.opacity = op;
    sp.disc.visible = blur > 0.01 && left > 0;
    sp.discSpin.quaternion.copy(sp.spin.quaternion);
    for (let i = 0; i < sp.blades.length; i++) {
      const gone = (broke >> i) & 1;
      for (const m of sp.blades[i]) m.visible = !gone;
    }
    for (const m of sp.hub) m.visible = true;
    // bent blades (a propeller strike): each blade curled back at its root
    const bent = sp === P.prop ? (L.bent || 0) : 0;
    if (bent !== sp.bent) {
      sp.bent = bent;
      sp.blades.forEach((list, i) => list.forEach((m, j) => {
        m.quaternion.copy(sp.rest[i][j]);
        // (about the line across the blade at the hub, so the tip curls back, aft, as a propeller that hit the ground)
        if (bent) { const a = sp.a0 + i * Math.PI * 2 / sp.blades.length; m.rotateOnAxis(_a.set(-Math.sin(a), Math.cos(a), 0), -(0.5 + 0.15 * (i % 2)) * bent); }
      }));
      // (a bent propeller shakes rather than blurs: fewer turns, shown by the blades)
    }
  }
  const H = P.hinges;
  if (P.yokes) for (const y of P.yokes) { y.g.rotation.z = (L.ail || 0) * -0.6; y.g.position.z = y.z0 - (L.elev || 0) * 0.07; }
  if (A.kind === 'plane') {
    rot(H.elevator, (L.elev || 0) * A.deMax);
    rot(H.rudder, -(L.rud || 0) * A.drMax);
    rot(H.aileronL, (L.ail || 0) * A.daMax);
    rot(H.aileronR, -(L.ail || 0) * A.daMax);
  }
}
function popcount(x) { let n = 0; while (x) { n += x & 1; x >>= 1; } return n; }
// a control surface turned about its hinge
function rot(h, ang) { if (!h) return; if (Math.abs(ang - h.cur) < 1e-4) return; h.cur = ang; _q.setFromAxisAngle(h.axis, ang); h.node.quaternion.copy(h.q0).multiply(_q); }
const NO_HITS = Object.freeze({ big: 0, rotor: false, nose: 0, wingL: 0, wingR: 0, list: Object.freeze([]) });

// ---------------------------------------------------------------------------------------------------------------
// the body (vehicle.js runs this hook in every Vehicle's constructor)

VEHICLE_HOOKS.push(v => {
  const spec = v.rig && v.rig.spec, A = spec && spec.air && AIR[spec.id];
  if (!A) return;
  v.air = A;
  v.Ib.set(A.Ib[0], A.Ib[1], A.Ib[2]);
  v.com.set(A.com[0], A.com[1], A.com[2]);
  v.circles = A.circles.map(c => ({ local: new THREE.Vector3(c[0], c[1], c[2]), r: c[3], hh: c[4], part: c[5], x: 0, z: 0, y0: 0, y1: 0, o: 0 }));
  v.airS = freshState(A);
  v.netLook = () => netLook(v);
  // the fall guard (vehicle.js floorGuard) meets the ground at the airframe's own points, not a car's box
  v.guardPts = A.body.map(p => ({ p: new THREE.Vector3(p[0], p[1], p[2]) }));
  v.airPts = A.body.map(p => ({ p: new THREE.Vector3(p[0], p[1], p[2]), gx: NaN, gz: NaN, gh: 0 }));
  // the moving parts' look goes with the wheels' (drive.js, onfoot.js and a copy over the network call rig.update
  // with it)
  const base = v.look.bind(v);
  v.look = () => airLook(v, base());
});

// a propeller's or rotor's turns a second, from the engine's state
export function rotorTps(A, s) {
  if (A.kind === 'plane') return s.bent ? 0 : s.rpmK * (A.propRpm[0] + (A.propRpm[1] - A.propRpm[0]) * (s.engine ? s.thr : 0)) / 60;
  return A.rotorRpm / 60 * s.rpmK;
}
function airLook(v, l) {
  const s = v.airS, A = v.air;
  l.rotor = rotorTps(A, s);
  l.tail = A.kind === 'heli' ? A.tailRpm / 60 * s.rpmK * ((s.broke >> 8) & 1 ? 0 : 1) : 0;
  l.elev = s.elev || 0; l.ail = s.ail || 0; l.rud = s.rud || 0; l.flap = s.flap || 0;
  l.tiltX = s.tiltX || 0; l.tiltZ = s.tiltZ || 0; l.broke = s.broke || 0; l.bent = s.bent || 0; l.gear = s.gearOff ? 0 : 1;
  // (smoke 1 or fire 2 after a heavy crash: a copy on another page makes its own)
  l.fx = s.fire ? 2 : s.smoke ? 1 : 0;
  l.air = s.airborne && s.h > 0.4 ? 1 : 0;
  return l;
}

function freshState(A) {
  return {
    thr: 0, coll: 0, flapI: 0, flap: 0, rpmK: 0, engine: true, rotorOK: true, broke: 0, bent: 0, wing: [0, 0], fire: 0,
    elev: 0, ail: 0, rud: 0, pitchIn: 0, steerIn: 0, hold: null, holdT: 0, airborne: false, h: 0, stall: 0, dropSign: 1,
    tiltX: 0, tiltZ: 0, vs: 0, ias: 0, alpha: 0, knocked: 0, gear: 1, lastHitT: 0, wrecked: false,
  };
}
// the extra fields a copy needs (net.js sends these with the pose; rig.update(dt, look) takes them)
function netLook(v) {
  const l = airLook(v, {});
  for (const k of ['rotor', 'tail', 'elev', 'ail', 'rud', 'tiltX', 'tiltZ']) l[k] = Math.round(l[k] * 1000) / 1000;
  return l;
}

// blades off a rotor, thrown from where they were on their way round (the player's crash, and a copy's when the other
// page says blades broke: mp.js)
function throwBlades(d, rig, sp, newly, vel, omega) {
  const fx = d.damage && d.damage.fx;
  if (!fx || !rig || !sp) return;
  rig.object.updateMatrixWorld(true);
  for (let i = 0; i < sp.blades.length; i++) {
    if (!((newly >> i) & 1)) continue;
    for (const m of sp.blades[i]) {
      m.updateWorldMatrix(true, false);
      const piece = new THREE.Mesh(m.geometry, sp.solid || m.material);
      piece.userData.dmgPart = true; piece.castShadow = true;
      m.matrixWorld.decompose(piece.position, piece.quaternion, piece.scale);
      const grp = new THREE.Group(); grp.name = 'blade_debris';
      // the piece's box in its own frame
      m.geometry.computeBoundingBox();
      const box = m.geometry.boundingBox.clone();
      const c = box.getCenter(new THREE.Vector3());
      // its centre in the world, its speed round the hub plus the machine's own
      const cw = c.clone().applyMatrix4(m.matrixWorld), hub = new THREE.Vector3().setFromMatrixPosition(sp.spin.matrixWorld);
      const axisW = new THREE.Vector3(0, 1, 0).applyQuaternion(_q.setFromRotationMatrix(sp.spin.matrixWorld));
      const tan = axisW.clone().cross(cw.clone().sub(hub)).multiplyScalar(omega * 0.8);
      grp.position.copy(cw);
      piece.position.sub(cw);
      grp.add(piece);
      d.scene.add(grp);
      // (debris turns about its own middle: recentre)
      try {
        fx.addDebris(grp, { mass: 30, v: tan.add(vel).add(new THREE.Vector3(0, rnd(1, 4), 0)), w: new THREE.Vector3(rnd(-3, 3), omega * 0.9, rnd(-3, 3)), box: new THREE.Box3().setFromObject(grp).translate(cw.clone().negate()), ground: d.damage.groundFn, life: 240, kind: 'blade', bounce: 0.2, mu: 0.6, max: 60 });
      } catch (e) { console.warn('blade debris', e); }
    }
  }
  if (fx.sparkBurst) { const hub = new THREE.Vector3().setFromMatrixPosition(sp.spin.matrixWorld); fx.sparkBurst(hub, vel.clone(), 40, 0); }
}

// a copy's crash (mp.js drives it from the other page's look): new broken blades thrown off, smoke and fire started
// or stopped, the gear torn off; what it was when first seen is taken as it is (no show for an old crash)
let AIRD = null;
const _cv = new THREE.Vector3();
function copyFx(rig, P, L, dt) {
  const o = rig.object;
  if (!P.lastPos) { P.lastPos = o.position.clone(); P.vel = new THREE.Vector3(); }
  else if (dt > 0) { _cv.subVectors(o.position, P.lastPos).divideScalar(dt); if (_cv.lengthSq() < 1e4) P.vel.lerp(_cv, 0.5); P.lastPos.copy(o.position); }
  const broke = L.broke | 0, fk = L.fx | 0, gear = L.gear === undefined ? 1 : L.gear;
  if (P.seen === undefined) { P.seen = { broke, fx: fk, gear }; return; }
  const S = P.seen, d = AIRD, fx = d && d.damage && d.damage.fx;
  if (!d || !fx) { S.broke = broke; S.fx = fk; S.gear = gear; return; }
  const A = P.A;
  const newMain = broke & 255 & ~(S.broke & 255), newTail = (broke >> 8) & 255 & ~((S.broke >> 8) & 255);
  if (newMain && P.main) throwBlades(d, rig, P.main, newMain, P.vel, (A.rotorRpm || 380) / 60 * Math.PI * 2 * 0.8);
  if (newTail && P.tail) throwBlades(d, rig, P.tail, newTail, P.vel, (A.tailRpm || 3500) / 60 * Math.PI * 2 * 0.5);
  if (fk !== S.fx) {
    const E = new THREE.Vector3().fromArray(A.engine || [0, 1, 0]);
    if (fk === 0) fx.stopEmitters(o);
    else {
      if (S.fx < 1) fx.emit(o, E, 'smoke', fk > 1 ? 26 : 14, fk > 1 ? 90 : 40);
      if (fk > 1 && S.fx < 2) fx.emit(o, E, 'fire', 30, 60);
    }
  }
  if (!gear && S.gear) {
    try { const D = d.damage, rd = D && D.of ? D.of(rig) : null; if (rd && rd.wheelOff) for (let i = 0; i < 4; i++) rd.wheelOff(i, null); } catch (e) {}
  }
  S.broke = broke; S.fx = fk; S.gear = gear;
}

// ---------------------------------------------------------------------------------------------------------------
// flying (drive.js: before() ahead of the physics steps, frame() after the camera; vehicle.js calls ext() per step)

export class Air {
  constructor(drive) {
    this.d = drive; AIRD = drive;
    this.v = null; this.rig = null; this.A = null;
    this.keys = { up: false, down: false };
    this.snd = null; this.hudEl = null;
    this.t = 0;
    this.flapKey = false;
    // F (the flaps) is ours while flying the plane; the drive has no F of its own
    addEventListener('keydown', e => { if (e.code === 'KeyF' && !e.repeat && this.v && this.A && this.A.kind === 'plane' && this.driving() && e.target.tagName !== 'INPUT') this.cycleFlaps(); });
    // R mends an aircraft too: its rotor, propeller and engine (damage.js mends the body)
    const D = drive.damage;
    if (D && D.repair && !D._airWrap) {
      D._airWrap = true;
      const orig = D.repair.bind(D);
      D.repair = rig => { const r = orig(rig); try { this.mend(rig); } catch (e) { console.warn('aircraft mend', e); } return r; };
    }
    if (typeof window !== 'undefined') { window.__car = window.__car || {}; window.__car.air = this; }
  }

  driving() {
    const d = this.d;
    if (!(d.car && d.car.vehicle && d.car.rig && d.car.vehicle.air)) return false;
    const of = d.onfoot;
    if (of && of.mode === 'exit' && of.seq && of.seq.phase === 'stop' && of.seq.car === d.car) { this.leaving = true; return true; }
    this.leaving = false;
    if ((of && of.active) || d.onFoot || d.walking) return false;
    return true;
  }

  // is the wreck to stay where it is (drive.js: no automatic "back on the road" for a crashed aircraft)
  keepWreck() { const v = this.d.car && this.d.car.vehicle; return !!(v && v.airS && (v.airS.wrecked || v.air)); }
  // getting out: only on the ground (onfoot.js asks)
  mayLeave() {
    const v = this.d.car && this.d.car.vehicle;
    if (!v || !v.airS) return true;
    return v.air.kind === 'heli' || !v.airS.airborne || v.airS.h < 0.8;
  }

  attach(car) {
    this.detach();
    this.v = car.vehicle; this.rig = car.rig; this.A = car.vehicle.air;
    // (flown here: its crashes are this module's own, never a copy's, from now on)
    if (this.rig._air) this.rig._air.local = true;
    AIRD = this.d;
    const v = this.v;
    v.ext = (...a) => this.ext(...a);
    const s = v.airS;
    s.engine = s.engine !== false && !s.wrecked;
    this.lastO = v.origin(new THREE.Vector3());
    this.hint = 7;
    this.makeHud();
    // standing where its wings or rotor would be in a lamp post, a tree or a wall: moved along the road to where they
    // are clear (a car's spot is rarely an aircraft's)
    if (!s.airborne && v.speed < 0.5) { try { this.clearSpot(v); } catch (e) { console.warn('aircraft spot', e); } }
  }

  clearSpot(v) {
    const C = this.d.collide;
    if (!C || !C.contacts) return;
    const o = v.origin(new THREE.Vector3()), hd = v.heading, h = hd * Math.PI / 180;
    const fx = Math.sin(h), fz = -Math.cos(h), q = v.q;
    const list = v.circles.map(c => ({ x: 0, z: 0, r: c.r * 0.9, y0: 0, y1: 0, c }));
    const blocked = (x, y, z) => {
      for (const L of list) { _c.copy(L.c.local).applyQuaternion(q); L.x = x + _c.x; L.z = z + _c.z; L.y0 = y + _c.y - L.c.hh; L.y1 = y + _c.y + L.c.hh; }
      return C.contacts(list).length > 0;
    };
    if (!blocked(o.x, o.y, o.z)) return;
    for (let k = 1; k <= 30; k++) {
      const d = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 5;
      const x = o.x + fx * d, z = o.z + fz * d;
      let g = null; try { g = this.d.ground(x, z, o.y + 1); } catch (e) {}
      if (g === null || g === undefined || !Number.isFinite(g) || Math.abs(g - o.y) > 3) continue;
      if (blocked(x, g, z)) continue;
      v.place(x, g, z, hd);
      if (this.d.prevPos) { this.d.prevPos.copy(v.pos); this.d.prevQ.copy(v.q); }
      this.lastO.copy(v.origin(_b));
      return;
    }
  }
  detach() {
    if (this.v && this.v.ext) this.v.ext = null;
    if (this.v) this.v.flyCam = 0;
    this.v = null; this.rig = null; this.A = null;
    if (this.hudEl) this.hudEl.style.display = 'none';
    // (a touch button held as the aircraft is left lets its key go)
    for (const b of this.btns || []) { if (b.classList.contains('down')) { try { this.d.keys.delete(b.dataset.code); } catch (e) {} } b.classList.remove('on', 'down', 'touchy'); }
    this.quiet();
  }

  cycleFlaps() {
    const s = this.v.airS, F = this.A.flaps;
    s.flapI = (s.flapI + 1) % F.length;
    this.d.hud.flash('Flaps ' + F[s.flapI] + '°');
  }

  mend(rig) {
    const v = (this.d.car && this.d.car.rig === rig) ? this.d.car.vehicle : null;
    const P = rig && rig._air;
    if (P) {
      for (const sp of P.spinners) for (const l of sp.blades) for (const m of l) m.visible = true;
      P.look.broke = 0; P.look.bent = 0;
    }
    if (v && v.airS) {
      const keep = v.airS.flapI;
      if (!v.circles.some(c => c.part === 'rotor')) v.circles = v.air.circles.map(c => ({ local: new THREE.Vector3(c[0], c[1], c[2]), r: c[3], hh: c[4], part: c[5], x: 0, z: 0, y0: 0, y1: 0, o: 0 }));
      v.airS = freshState(v.air); v.airS.flapI = keep; v.airS.rpmK = v.air.kind === 'heli' ? 1 : 0.3;
      for (const w of v.wheels) w.gone = false;
    }
    const fx = this.d.damage && this.d.damage.fx;
    if (fx && rig) fx.stopEmitters(rig.object);
  }

  before(dt, inp, env) {
    try {
      const d = this.d;
      if (!this.driving()) { if (this.v) this.detach(); this.idleLeft(dt); return; }
      if (d.car.vehicle !== this.v) this.attach(d.car);
      const v = this.v, s = v.airS, A = this.A, k = d.keys;
      const pad = navigator.getGamepads ? [...navigator.getGamepads()].find(p => p && p.connected) : null;
      const pb = i => pad && pad.buttons[i] ? pad.buttons[i].value : 0;
      const ax = i => { const a = pad ? pad.axes[i] || 0 : 0; return Math.abs(a) < 0.1 ? 0 : a; };
      const live = !d.auto && !this.leaving;
      const has = c => live && k && k.has(c);
      const up = has('Space') || pb(0) > 0.5, down = has('ShiftLeft') || has('ShiftRight') || pb(1) > 0.5;
      const W = has('KeyW') || has('ArrowUp'), S = has('KeyS') || has('ArrowDown');
      let steer = (has('KeyA') || has('ArrowLeft') ? 1 : 0) - (has('KeyD') || has('ArrowRight') ? 1 : 0);
      if (pad && Math.abs(ax(0)) > 0) steer = -ax(0);
      const o = v.origin(_a);
      // a jump (a respawn, a new drop): the state from the ground
      if (this.lastO && o.distanceToSquared(this.lastO) > 400) { s.airborne = false; s.hold = null; }
      (this.lastO || (this.lastO = new THREE.Vector3())).copy(o);
      // the ground under it (a roof, a road, the land)
      let g = null;
      try { g = d.ground(o.x, o.z, o.y + 0.3); if (g === null || g === undefined || !Number.isFinite(g)) g = d.ground(o.x, o.z); } catch (e) {}
      s.h = (g === null || g === undefined || !Number.isFinite(g) || g > o.y + 3) ? 500 : o.y - g;
      // traffic below an aircraft is not in its way (per circle heights are checked too, vehicle.js)
      if (env && env.others && s.h > 2) env.others = env.others.filter(c => !(c.obj && Number.isFinite(c.obj.y) && o.y > c.obj.y + 2.2));
      const rate = (cur, want, r) => cur + clamp(want - cur, -r * dt, r * dt);
      this.env = env;
      if (A.kind === 'plane') {
        // throttle: W up, S down; at idle S holds the brakes
        let tw = s.thr;
        if (W) tw = Math.min(1, tw + 0.55 * dt);
        if (S) tw = Math.max(0, tw - 0.55 * dt);
        if (pad) { tw = Math.min(1, tw + pb(7) * 0.6 * dt); tw = Math.max(0, tw - pb(6) * 0.6 * dt); }
        if (!s.engine) tw = 0;
        s.thr = tw;
        if (this.leaving) s.thr = Math.max(0, s.thr - dt);
        let pitch = (up ? 1 : 0) - (down ? 1 : 0);
        if (pad && Math.abs(ax(1)) > 0) pitch = ax(1); // (stick back, nose up)
        s.pitchIn = rate(s.pitchIn, pitch, 3);
        s.steerIn = rate(s.steerIn, steer, 3.5);
        const grounded = !s.airborne;
        inp.throttle = (s.thr > 0.06 || v.speed > 1.5) ? 0.06 : 0;
        // (wheel brakes about 0.4 g, a light plane's; full when wrecked)
        inp.brake = s.wrecked ? 1 : (S && s.thr < 0.02 && grounded) || this.leaving ? 0.42 : 0;
        inp.steer = grounded ? s.steerIn : 0;
        inp.handbrake = 0;
      } else {
        // the collective: Space up, Shift down; let go in the air and it holds the height
        s.collIn = (up ? 1 : 0) - (down ? 1 : 0);
        if (this.leaving) s.collIn = s.airborne ? -0.5 : -1;
        let pitch = (W ? 1 : 0) - (S ? 1 : 0);
        if (pad && Math.abs(ax(1)) > 0) pitch = -ax(1);
        s.pitchIn = rate(s.pitchIn, this.leaving ? 0 : pitch, 2.2);
        s.steerIn = rate(s.steerIn, this.leaving ? 0 : steer, 3);
        inp.throttle = 0; inp.steer = 0; inp.handbrake = 0;
        inp.brake = s.airborne ? 0 : 1;
      }
      // the engine and rotor speed: run up while someone is at the controls
      const want = s.engine && s.rotorOK !== false ? 1 : 0;
      s.rpmK = rate(s.rpmK, want, want ? (A.kind === 'heli' ? 0.22 : 0.8) : (A.kind === 'heli' ? 0.05 : 0.3));
    } catch (e) { if (!this.warned) { this.warned = true; console.warn('aircraft', e); } }
  }

  // an aircraft nobody is in: its rotor or propeller runs down (onfoot.js updates the rig of a left car that is awake;
  // one asleep is updated here while its rotor still turns)
  idleLeft(dt) {
    const F = this.d.onfoot, list = F && F.parked ? F.parked : [];
    for (const e of list) {
      const v = e.vehicle, s = v && v.airS;
      if (!s || !(s.rpmK > 0) || (this.d.car && this.d.car.vehicle === v)) continue;
      s.rpmK = Math.max(0, s.rpmK - dt * (v.air.kind === 'heli' ? 0.05 : 0.3));
      if (e.asleep && e.rig && e.rig.update) e.rig.update(dt, v.look());
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // in each physics step: the forces

  ext(v, F, T, dt, grounded, up, fwd, right) {
    const A = v.air, s = v.airS;
    if (!A || !s) return;
    // (no reverse gear on an aircraft: S at a standstill is the brakes)
    v.reverse = false; v.revWait = 0;
    // what the last step hit (vehicle.js fills v.hits at the end of each step; the frame only sees the last step's,
    // so they are gathered here for crashes())
    if (v.hits.length) {
      const H = s.hitAcc || (s.hitAcc = { big: 0, rotor: false, nose: 0, wingL: 0, wingR: 0, list: [] });
      for (const h of v.hits) {
        const c = v.circles[h.i];
        if (h.speed > H.big) H.big = h.speed;
        // (for tests: the last hits and the parts they were on)
        const L = this.lastHits || (this.lastHits = []); L.push([c ? c.part : h.i, +h.speed.toFixed(2), h.shape ? h.shape.tag || h.shape.k : h.other ? 'car' : h.wall ? 'step' : '?']); if (L.length > 16) L.shift();
        if (!c) continue;
        if (c.part === 'rotor' && h.speed > 0.3) H.rotor = true;
        if (c.part === 'nose') H.nose = Math.max(H.nose, h.speed);
        if (c.part === 'wingL') H.wingL = Math.max(H.wingL, h.speed);
        if (c.part === 'wingR') H.wingR = Math.max(H.wingR, h.speed);
        if (c.part !== 'body' && c.part !== 'nose' && h.speed > 5 && H.list.length < 6) H.list.push({ c, speed: h.speed, nx: h.nx, nz: h.nz, px: h.px, pz: h.pz });
      }
    }
    const m = v.p.mass;
    const vel = v.v, V = vel.length();
    // body rates: q pitch (nose up), r yaw (nose right), p roll (right wing down)
    _q.copy(v.q).invert();
    _b.copy(v.w).applyQuaternion(_q);
    const qb = _b.x, rb = -_b.y, pb = -_b.z;
    s.airborne = grounded === 0 || (s.airborne && grounded < 2);
    if (grounded >= 3) s.airborne = false;
    // on its side, its nose or its back (or the gear gone): the airframe itself on the ground, springs at its points
    // with sliding friction (damage.js's body contact leaves a body with ext alone, as flight.js's)
    const was = this.bodyN || 0;
    this.bodyN = 0;
    if ((up.y < 0.8 || grounded < 2) && s.h < 14) this.airframeContact(v, F, T, dt, m);
    // (resting on its belly or back, gear gone: on the ground, not flying)
    if (this.bodyN > 2 && v.v.lengthSq() < 9) s.airborne = false;
    // touching down: how fast it was coming down (a landing, a hard landing, a fall)
    if (grounded === 0 && !this.bodyN) { s.airT = (s.airT || 0) + dt; s.vyAir = v.v.y; }
    else {
      if ((s.airT || 0) > 0.12 && (grounded > 0 || (this.bodyN && !was))) s.land = { speed: Math.max(0, -(s.vyAir || 0)), t: performance.now() + Math.random() };
      s.airT = 0;
    }
    if (A.kind === 'plane') this.planeForces(v, A, s, F, T, dt, grounded, up, fwd, right, V, qb, rb, pb, m);
    else this.heliForces(v, A, s, F, T, dt, grounded, up, fwd, right, V, qb, rb, pb, m);
  }

  airframeContact(v, F, T, dt, m) {
    const env = this.env;
    if (!env || !env.ground) return;
    const k = m * 260, c = 2 * Math.sqrt(k * m / 6) * 1.2;
    let n = 0;
    // (the ground under the origin, from before(): a point well over it is not asked about)
    const g0 = v.pos.y - v.com.y - v.airS.h;
    for (const bp of v.airPts) {
      const P = _a.copy(bp.p).sub(v.com).applyQuaternion(v.q).add(v.pos);
      if (P.y - g0 > 3) continue;
      if (!(Math.abs(P.x - bp.gx) < 0.3 && Math.abs(P.z - bp.gz) < 0.3)) {
        const g = env.ground(P.x, P.z, P.y + 0.6);
        bp.gh = g === null || g === undefined || !Number.isFinite(g) ? -1e9 : g; bp.gx = P.x; bp.gz = P.z;
      }
      const pen = bp.gh - P.y;
      if (pen <= 0 || pen > 1.5) continue;
      const r = _b.copy(P).sub(v.pos);
      const vp = _c.copy(v.w).cross(r).add(v.v);
      let fn = k * Math.min(pen, 0.4) - c * vp.y;
      if (fn <= 0) continue;
      fn = Math.min(fn, m * G * 6);
      _d.set(0, fn, 0);
      // friction along the ground
      const vt = Math.hypot(vp.x, vp.z);
      if (vt > 0.01) { const fr = Math.min(0.6 * fn, m * vt / (dt * 8)); _d.x -= vp.x / vt * fr; _d.z -= vp.z / vt * fr; }
      F.add(_d); T.add(_e.copy(r).cross(_d));
      n++;
    }
    this.bodyN = n;
    // resting on its back or side: the springs' rocking taken out (scraped metal does not bounce)
    if (n > 2) { v.w.multiplyScalar(Math.exp(-4 * dt)); if (v.v.lengthSq() < 4) v.v.multiplyScalar(Math.exp(-3 * dt)); }
  }

  planeForces(v, A, s, F, T, dt, grounded, up, fwd, right, V, qb, rb, pb, m) {
    const vel = v.v;
    // the propeller
    const thrK = s.engine && !s.bent ? s.thr * s.rpmK : 0;
    const Th = thrK * Math.min(A.Tstatic, A.eta * A.power / Math.max(V, 1));
    F.addScaledVector(fwd, Th);
    s.flap = A.flaps[s.flapI] || 0;
    const fk = s.flap / 30;
    if (V < 2) { s.alpha = 0; s.ias = V; this.controls(A, s, v, dt, V, qb, rb, pb, 0, 0, up, right, grounded); return; }
    const u = vel.dot(fwd), w = vel.dot(up), vs = vel.dot(right);
    const alpha = Math.atan2(-w, Math.max(0.1, u)), beta = Math.asin(clamp(vs / V, -1, 1));
    s.alpha = alpha; s.ias = V;
    const qbar = 0.5 * RHO * V * V;
    const Vd = Math.max(V, 12); // (damping terms: no blow up at low speed)
    this.controls(A, s, v, dt, V, qb, rb, pb, alpha, beta, up, right, grounded);
    const de = s.elev * A.deMax, da = s.ail * A.daMax, dr = s.rud * A.drMax;
    // lift: linear to the stall, then the stalled wing's
    const aS = A.alphaStall + fk * 0.02;
    const CL0 = A.CL0 + fk * 0.45, aAbs = Math.abs(alpha);
    let CL = CL0 + A.CLa * alpha;
    const stall = smooth(aS, aS + 0.1, aAbs);
    if (stall > 0) { const CLs = (CL0 + A.CLa * aS * Math.sign(alpha)) * 0.85, CLpost = 1.05 * Math.sin(2 * alpha); CL = THREE.MathUtils.lerp(CL, aAbs < aS + 0.25 ? CLs : CLpost, stall); }
    if (stall > 0.3 && s.stall < 0.3) s.dropSign = Math.random() < 0.5 ? -1 : 1;
    s.stall = stall;
    CL += A.CLq * qb * A.c / (2 * Vd) + A.CLde * de;
    // the wings' damage takes lift away
    const wingK = 1 - 0.5 * Math.min(1, (s.wing[0] + s.wing[1]) / 2);
    CL *= wingK * (s.wrecked ? 0.2 : 1); // (a wreck's wings are folded: it comes down)
    const CD = A.CD0 + fk * 0.035 + A.k * CL * CL + 1.1 * Math.pow(Math.sin(aAbs), 2) * stall + 0.02 * (s.wing[0] + s.wing[1]);
    const CY = A.CYb * beta + A.CYdr * dr;
    // directions: drag against the air, lift square to it in the plane of symmetry, side force along the right
    const vh = _c.copy(vel).divideScalar(V);
    const liftDir = _d.copy(right).cross(vh); // (level flight: right x forward = up)
    liftDir.addScaledVector(vh, -liftDir.dot(vh));
    if (liftDir.lengthSq() > 1e-6) liftDir.normalize();
    F.addScaledVector(liftDir, qbar * A.S * CL);
    F.addScaledVector(vh, -qbar * A.S * CD);
    F.addScaledVector(right, qbar * A.S * CY);
    // moments (body): roll right wing down +, pitch nose up +, yaw nose right +
    const b2 = A.b / (2 * Vd), c2 = A.c / (2 * Vd);
    let Cl = A.Clb * beta + A.Clp * pb * b2 + A.Clr * rb * b2 + A.Clda * da + A.Cldr * dr;
    // a stalled wing drops, and a damaged one lifts less
    Cl += 0.04 * stall * s.dropSign + 0.08 * (s.wing[0] - s.wing[1]);
    // (a stalled wing's lift moves aft: the nose drops)
    const Cm = A.Cm0 + A.Cma * alpha + A.Cmq * qb * c2 + A.Cmde * de - 0.05 * fk - 0.22 * stall * Math.sign(alpha);
    const Cn = A.Cnb * beta + A.Cnp * pb * b2 + A.Cnr * rb * b2 + A.Cnda * da + A.Cndr * dr;
    const Lr = qbar * A.S * A.b * Cl, Mp = qbar * A.S * A.c * Cm, Ny = qbar * A.S * A.b * Cn;
    // the propeller's slipstream over the rudder and elevator (steering on the take-off run, before there is airspeed)
    const slip = 0.5 * RHO * (Th / (RHO * Math.PI * 0.9)) * 1.2;
    _e.set(Mp + slip * A.Cmde * de * 2.2, -(Ny + slip * A.Cndr * dr * 2.5), -Lr).applyQuaternion(v.q);
    T.add(_e);
  }

  // stick and pedals for the plane, with the assist: hold the pitch you had, level the wings, keep the ball centred
  controls(A, s, v, dt, V, qb, rb, pb, alpha, beta, up, right, grounded) {
    const fwdY = _a.set(0, 0, -1).applyQuaternion(v.q).y;
    const theta = Math.asin(clamp(fwdY, -1, 1));
    const phi = Math.atan2(-right.y, up.y);
    const rate = (cur, want, r) => cur + clamp(want - cur, -r * dt, r * dt);
    const flying = s.airborne && s.h > 0.3 && V > 18;
    let elev, ail, rud;
    if (Math.abs(s.pitchIn) > 0.05 || !flying) {
      // (a key is all or nothing: at speed it asks for less of the elevator, as a pilot's hand does)
      elev = -s.pitchIn * clamp(1.1 - V / 45, 0.35, 1);
      s.hold = null; s.holdT = 0;
    } else {
      // let go: hold the pitch once the nose has settled (half a second)
      s.holdT += dt;
      if (s.hold === null && (s.holdT > 0.4 || Math.abs(qb) < 0.05)) s.hold = clamp(theta, -0.1, 0.22);
      // (and eases towards level flight, about a degree a second, as a plane trimmed for cruise does)
      if (s.hold !== null) s.hold += clamp(0.05 - s.hold, -0.018 * dt, 0.018 * dt);
      const tgt = s.hold === null ? theta : s.hold;
      elev = clamp(-(2.2 * (tgt - theta) - 0.8 * qb) - 0.12 * Math.max(0, alpha - 0.05), -0.6, 0.6);
    }
    if (Math.abs(s.steerIn) > 0.05 || !flying) ail = -s.steerIn;
    else ail = clamp(-1.4 * phi - 0.5 * pb, -0.5, 0.5);
    if (flying) rud = clamp(-1.6 * beta - 0.3 * rb + 0.25 * s.steerIn, -1, 1);
    else rud = s.steerIn;
    s.elev = rate(s.elev, clamp(elev, -1, 1), 2.2);
    s.ail = rate(s.ail, clamp(ail, -1, 1), 5);
    s.rud = rate(s.rud, clamp(rud, -1, 1), 5);
  }

  heliForces(v, A, s, F, T, dt, grounded, up, fwd, right, V, qb, rb, pb, m) {
    const vel = v.v;
    const W = m * G;
    const rk = s.rpmK * s.rpmK * (s.rotorOK ? 1 : 0);
    // the ground under the disc and translational lift
    const D = A.rotorR * 2, hr = s.h + 3;
    const ge = hr < D ? 0.12 * Math.pow(1 - hr / D, 2) : 0;
    const hs = Math.hypot(vel.x, vel.z);
    const etl = 0.08 * smooth(5, 15, hs);
    const eff = 1 + ge + etl;
    // the collective: held height when let go in the air
    const lost = popcount(s.broke & 255) / A.blades;
    // the collective follows a climb or descent asked for: Space climbs at up to 7.5 m/s, Shift comes down at up to
    // 6 m/s and slows near the ground (a firm but safe touch-down), neither holds the height; getting out in the air
    // comes down at about 2 m/s, slower near the ground. (The EC135's best climb is about 7.6 m/s.)
    const leave = this.leaving && s.airborne;
    let vsT = 0;
    if (leave) vsT = -Math.min(3, 0.3 + 0.5 * s.h);
    else if (s.collIn > 0) vsT = 7.5;
    else if (s.collIn < 0) vsT = -Math.max(0.7, Math.min(6, 0.45 * s.h));
    if (!s.airborne && s.collIn <= 0 && !leave) s.coll = Math.max(0, s.coll - 0.8 * dt);
    else if (rk > 0.3) {
      const hover = W / (A.Tmax * W * rk * eff) / Math.max(0.35, up.y);
      const want = clamp(hover + 0.09 * (vsT - vel.y), 0, 1);
      s.coll += clamp(want - s.coll, -0.7 * dt, 0.7 * dt);
    }
    // a climbing rotor's blades meet the air at less of an angle (less thrust), a descending one at more; going down
    // with the collective low the rotor still lifts, as in autorotation (about 10 m/s down with none at all)
    // (the climb or descent itself, not the forward speed through a tilted disc, which lifts better: translational lift)
    const vu0 = vel.y;
    const Tz = A.Tmax * W * s.coll * rk * eff * (1 - lost) * clamp(1 - 0.05 * vu0, 0.45, 1.5) + W * rk * (1 - lost) * clamp(-vu0 / 10, 0, 1) * (1 - s.coll);
    // the disc tips ahead of the fuselage with the cyclic: part of the thrust along at once
    const tX = s.tiltX, tZ = s.tiltZ;
    _a.copy(up).addScaledVector(fwd, -tX * 0.6).addScaledVector(right, tZ * 0.6).normalize();
    F.addScaledVector(_a, Tz);
    // fuselage drag
    const vf = vel.dot(fwd), vu = vel.dot(up), vr = vel.dot(right), h = 0.5 * RHO;
    F.addScaledVector(fwd, -h * A.CdA[0] * vf * Math.abs(vf));
    F.addScaledVector(up, -h * A.CdA[1] * vu * Math.abs(vu));
    F.addScaledVector(right, -h * A.CdA[2] * vr * Math.abs(vr));
    // attitude: the targets from the stick, the torques a stability system would ask of the rotor
    const fwdY = fwd.y, theta = Math.asin(clamp(fwdY, -1, 1)), phi = Math.atan2(-right.y, up.y);
    const k = smooth(4, 16, hs);
    const thT = -0.3 * s.pitchIn * (s.pitchIn > 0 ? 1 : 0.75) + 0.02 * k;
    const phT = -0.5 * k * s.steerIn;
    const rT = THREE.MathUtils.lerp(-1.15 * s.steerIn, Math.tan(phi) * G / Math.max(V, 6), k);
    const auth = s.rotorOK ? (s.rpmK * s.rpmK) * (s.airborne ? 1 : (s.coll > 0.35 ? 0.6 : 0.12)) : 0;
    const wn = 2.6, z = 0.95;
    const Mp = v.Ib.x * (wn * wn * (thT - theta) - 2 * z * wn * qb) * auth;
    const Lr = v.Ib.z * (wn * wn * (phT - phi) - 2 * z * wn * pb) * auth;
    let Ny = v.Ib.y * 3.2 * (rT - rb) * auth;
    // the tail fin weathervanes it into the wind at speed
    Ny += 4.4 * vr * V;
    // blades gone: the rotor shakes the whole machine
    if (lost > 0 && s.rpmK > 0.1) { const sh = lost * s.rpmK * 9000; _e.set(rnd(-sh, sh), rnd(-sh, sh), rnd(-sh, sh)); T.add(_e); }
    // the disc's tip for the picture: the stick's error, a few degrees at most
    s.tiltX = clamp((thT - theta) * 0.6 + s.pitchIn * 0.05, -0.12, 0.12) * auth;
    s.tiltZ = clamp((phT - phi) * 0.4 - s.steerIn * 0.03, -0.1, 0.1) * auth;
    _e.set(Mp, -Ny, -Lr).applyQuaternion(v.q);
    T.add(_e);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // after the camera: parts, crashes, sound, gauges

  frame(dt) {
    this.t += dt;
    if (!this.v || !this.driving()) { this.quiet(); return; }
    const v = this.v, s = v.airS, A = this.A, rig = this.rig, P = rig._air;
    try {
      v.flyCam = clamp(v.flyCam === undefined ? 0 : v.flyCam + ((s.airborne ? 1 : 0) - v.flyCam) * Math.min(1, dt * 1.5), 0, 1);
      this.crashes(dt);
      this.wash(dt);
      this.sound(dt);
      this.gauges(dt);
    } catch (e) { if (!this.warnF) { this.warnF = true; console.warn('aircraft frame', e); } }
  }

  crashes(dt) {
    const v = this.v, s = v.airS, A = this.A, rig = this.rig, P = rig._air;
    const fx = this.d.damage && this.d.damage.fx;
    const now = performance.now();
    // what hit what since the last frame (gathered step by step in ext)
    const H = s.hitAcc || NO_HITS;
    s.hitAcc = null;
    let big = H.big;
    for (const h of v.hits) if (h.speed > big) big = h.speed;
    const rotorHit = H.rotor, noseHit = H.nose, wingL = H.wingL, wingR = H.wingR;
    // a hard landing or a fall
    const gh = v.groundHit;
    let fall = 0;
    if (gh && gh.t !== this.lastGH) { this.lastGH = gh.t; fall = gh.speed; }
    const LD = s.land;
    if (LD && LD.t !== this.lastLand) {
      this.lastLand = LD.t; fall = Math.max(fall, LD.speed);
      // a hard touch-down dents the belly (damage.js, as its own hard landings)
      const D = this.d.damage;
      if (LD.speed > 3.5 && D && D.impact && D.of) {
        try {
          const rd = D.of(rig), o = v.origin(_b), qi = _q.copy(v.q).invert();
          const N = new THREE.Vector3(0, 1, 0).applyQuaternion(qi);
          const P = new THREE.Vector3(0, 0.3, A.kind === 'plane' ? 0.6 : -0.8);
          const upY = _a.set(0, 1, 0).applyQuaternion(v.q).y;
          D.impact(rd, { P, N, speed: LD.speed, kind: 'ground', world: o.clone(), normal: new THREE.Vector3(0, 1, 0), rollover: upY < 0.3 }, { mSelf: v.p.mass, vehicle: v });
        } catch (e) { if (!this.dentErr) { this.dentErr = true; console.warn('aircraft landing', e); } }
      }
    }
    if (A.kind === 'heli') {
      // the rotor meets something (a wall, a tree, the ground when it rolls over)
      const upY = _a.set(0, 1, 0).applyQuaternion(v.q).y;
      // (a hard landing flexes the blades down into the tail boom)
      if (s.rpmK > 0.25 && (rotorHit || (upY < 0.35 && s.h < 4) || fall > 7)) this.breakRotor(rotorHit ? 0.75 : fall > 10 ? 1 : 0.5, fx);
      if (fall > 6 || big > 14) { s.engine = false; }
      // the skids crushed flat in a fall: it sits on its belly
      if (fall > 12 && !s.gearOff) { s.gearOff = true; for (const w of v.wheels) w.gone = true; }
    } else {
      if (s.rpmK > 0.2 && (noseHit > 4 || fall > 5)) this.bendProp(fx);
      // the nose on the ground (the nose gear gone, or pushed over): a propeller strike
      const fwdY = _a.set(0, 0, -1).applyQuaternion(v.q).y;
      if (!s.bent && s.rpmK > 0.2 && fwdY < -0.2 && s.h < 2.5) this.bendProp(fx);
      // a crash into the ground: the gear torn off, the airframe slides on its belly (damage.js turns the wheels into
      // debris)
      if ((fall > 11 || (big > 18 && s.h < 3)) && !s.gearOff) {
        s.gearOff = true;
        const D = this.d.damage;
        try { const rd = D && D.of ? D.of(rig) : null; for (let i = 0; i < 4; i++) { if (rd && rd.wheelOff) rd.wheelOff(i, null); if (v.wheels[i]) v.wheels[i].gone = true; } } catch (e) { console.warn('aircraft gear', e); }
      }
      s.wing[0] = Math.min(1, s.wing[0] + Math.max(0, wingL - 4) / 20);
      s.wing[1] = Math.min(1, s.wing[1] + Math.max(0, wingR - 4) / 20);
      if (big > 16 || fall > 8) s.engine = false;
    }
    // a wing, the tail or the rotor touching something at speed: the body takes the dent where it touched (damage.js)
    const D = this.d.damage;
    if (D && D.impact && D.of) for (const h of H.list) {
      const c = h.c;
      if (now - (this.lastDent || 0) < 200) continue;
      this.lastDent = now;
      try {
        const rd = D.of(rig), o = v.origin(_b), qi = _q.copy(v.q).invert();
        const N = _c.set(h.nx, 0, h.nz).applyQuaternion(qi); N.y = 0; N.normalize();
        const Pt = c.local.clone(); Pt.x -= N.x * c.r; Pt.z -= N.z * c.r;
        const imp = { P: Pt, N: N.clone(), speed: h.speed, kind: 'pole', r: 0.15, t0: -0.3, t1: 0.3, b0: c.local.y - c.hh - 0.2, b1: c.local.y + c.hh + 0.2, edge: 0.15, world: new THREE.Vector3(h.px, o.y + c.local.y, h.pz), normal: new THREE.Vector3(h.nx, 0, h.nz), yMid: c.local.y };
        D.impact(rd, imp, { mSelf: v.p.mass, vehicle: v });
      } catch (e) { if (!this.dentErr) { this.dentErr = true; console.warn('aircraft dent', e); } }
    }
    // a heavy crash: smoke, then fire
    const hard = Math.max(big, fall * 1.3);
    if (hard > 9 && fx && now - s.lastHitT > 400) {
      s.lastHitT = now;
      const E = _d.fromArray(A.engine);
      fx.emit(rig.object, E, 'smoke', hard > 16 ? 26 : 14, hard > 16 ? 90 : 40); s.smoke = 1;
      if (hard > 16 || (A.kind === 'heli' && fall > 12)) { fx.emit(rig.object, E, 'fire', 30, 60); s.fire = 1; }
      if (!s.wrecked && hard > 14) { this.crumple(hard); s.engine = false; if (A.kind === 'heli' && s.rpmK > 0.2) this.breakRotor(1, fx); }
      s.wrecked = s.wrecked || hard > 14;
      try { this.d.sound.hit && this.d.sound.hit(hard); } catch (e) {}
      if (fx.sparkBurst) { v.origin(_b); _b.y += 1; fx.sparkBurst(_b, _c.copy(v.v).multiplyScalar(0.3), 30, 0); }
    }
  }

  // a crash: the airframe folds where an aircraft does, the wing tips up and back, the nose in, the tail boom bent
  // (damage.js's own crush, at these points)
  crumple(speed) {
    const D = this.d.damage, v = this.v, A = this.A, rig = this.rig;
    if (!D || !D.impact || !D.of) return;
    const rd = D.of(rig), o = v.origin(new THREE.Vector3());
    const pts = A.kind === 'plane'
      ? [[-5.0, 2.3, 0.7, 0, 1, 0.3, 2.2], [5.0, 2.3, 0.7, 0, 1, 0.3, 2.2], [0, 1.2, -1.9, 0, 0.2, 1, 1.2], [0, 1.5, 5.6, 0, 1, 0, 1.4]]
      : [[0, 1.2, -3.2, 0, 0.2, 1, 1.2], [0, 2.0, 4.6, 0, 1, 0, 1.6], [0, 0.4, -1.0, 0, 1, 0, 1.0]];
    for (const [x, y, z, nx, ny, nz, mul] of pts) {
      try {
        const N = new THREE.Vector3(nx, ny, nz).normalize(), P = new THREE.Vector3(x, y, z);
        D.impact(rd, { P, N, speed: speed * 0.7, kind: 'pole', r: 0.25, t0: -0.5, t1: 0.5, b0: y - 0.6, b1: y + 0.6, edge: 0.2, yMid: y, Dmul: mul, world: P.clone().applyQuaternion(v.q).add(o), normal: N.clone().applyQuaternion(v.q) }, { mSelf: v.p.mass, vehicle: v });
      } catch (e) { if (!this.crErr) { this.crErr = true; console.warn('aircraft crumple', e); } }
    }
  }

  // the rotor's downwash near the ground: dust blown out in a ring (damagefx.js's puffs)
  wash(dt) {
    const v = this.v, s = v.airS, A = this.A, fx = this.d.damage && this.d.damage.fx;
    if (!fx || A.kind !== 'heli' || !s.rotorOK || s.rpmK < 0.5 || s.h > 9 || s.h < -1) return;
    const k = clamp((s.coll || 0) * 1.6 - 0.3, 0, 1) * (1 - Math.max(0, s.h) / 9) * s.rpmK;
    this.washAcc = (this.washAcc || 0) + k * 40 * dt;
    if (this.washAcc < 1) return;
    const o = v.origin(_b), gy = o.y - Math.max(0, s.h);
    while (this.washAcc >= 1) {
      this.washAcc -= 1;
      const a = Math.random() * Math.PI * 2, r = rnd(2.5, 5.5), sp = rnd(4, 8) * (0.6 + k);
      fx.puff('dust', o.x + Math.cos(a) * r, gy + 0.15, o.z + Math.sin(a) * r, Math.cos(a) * sp, rnd(0.2, 0.8), Math.sin(a) * sp);
    }
  }

  // blades off the main rotor: they fly from where they were, on their way round
  breakRotor(share, fx) {
    const v = this.v, s = v.airS, A = this.A, P = this.rig._air, sp = P && P.main;
    if (!sp || !s.rotorOK && s.broke === (1 << A.blades) - 1) return;
    const n = A.blades;
    let mask = s.broke & 255;
    for (let i = 0; i < n; i++) if (!((mask >> i) & 1) && Math.random() < share) mask |= 1 << i;
    if (mask === (s.broke & 255)) mask |= 1 << Math.floor(Math.random() * n);
    const newly = mask & ~(s.broke & 255);
    s.broke = (s.broke & ~255) | mask;
    if (popcount(mask) >= n - 1) s.rotorOK = false;
    // (the disc's rim circles go with the blades)
    if (!s.rotorOK) v.circles = v.circles.filter(c => c.part !== 'rotor');
    s.engine = popcount(mask) < 2;
    this.d.hud.flash('Rotor strike');
    try { this.d.sound.hit && this.d.sound.hit(20); } catch (e) {}
    if (!fx) return;
    throwBlades(this.d, this.rig, sp, newly, v.v, A.rotorRpm / 60 * Math.PI * 2 * s.rpmK);
  }

  bendProp(fx) {
    const s = this.v.airS;
    if (s.bent) return;
    s.bent = 1; s.engine = false;
    this.d.hud.flash('Propeller strike');
    try { this.d.sound.hit && this.d.sound.hit(14); } catch (e) {}
    const P = this.rig._air;
    if (fx && P && P.prop && fx.sparkBurst) { const p = new THREE.Vector3().setFromMatrixPosition(P.prop.spin.matrixWorld); fx.sparkBurst(p, this.v.v.clone(), 30, 0); }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // sound: a piston engine and propeller, or a turbine and a four-blade rotor (Web Audio, drive.sound's context)

  sound(dt) {
    const S = this.d.sound, ctx = S && S.ctx;
    if (!ctx || !S.master || !S.on) { this.quiet(); return; }
    const A = this.A, s = this.v.airS;
    if (!this.snd || this.snd.ctx !== ctx || this.snd.kind !== A.kind) { this.quiet(true); this.snd = makeSound(ctx, S.master, A.kind); }
    const n = this.snd, t = ctx.currentTime, V = this.v.speed;
    n.quiet = false;
    if (A.kind === 'plane') {
      const rpm = rotorTps(A, s) * 60;
      const f = Math.max(10, rpm / 60 * 2); // four cylinders: two firings a turn
      n.o1.frequency.setTargetAtTime(f, t, 0.08); n.o2.frequency.setTargetAtTime(f * 0.5, t, 0.08);
      n.lfo.frequency.setTargetAtTime(rpm / 60 * A.blades, t, 0.08);
      const on = s.engine && s.rpmK > 0.05 ? 1 : 0;
      n.eng.gain.setTargetAtTime(on * (0.07 + 0.14 * s.thr), t, 0.1);
      n.lp.frequency.setTargetAtTime(500 + 1600 * s.thr, t, 0.1);
      n.wind.gain.setTargetAtTime(Math.min(0.25, V * V / 25000), t, 0.2);
      n.horn.gain.setTargetAtTime(s.airborne && s.alpha > 0.22 ? 0.05 : 0, t, 0.05);
    } else {
      const tps = rotorTps(A, s) * (s.rotorOK ? 1 : 0.3);
      n.lfo.frequency.setTargetAtTime(Math.max(0.5, tps * A.blades), t, 0.1);
      const load = 0.4 + 0.6 * clamp(s.coll || 0, 0, 1);
      n.slap.gain.setTargetAtTime(0.16 * s.rpmK * load, t, 0.1);
      n.bp.frequency.setTargetAtTime(380 + 300 * load, t, 0.2);
      n.whine.frequency.setTargetAtTime(900 + 2400 * s.rpmK, t, 0.3);
      n.whineG.gain.setTargetAtTime(s.engine ? 0.03 * s.rpmK : 0, t, 0.2);
      n.hum.frequency.setTargetAtTime(30 + A.tailRpm / 60 * s.rpmK * 0.5, t, 0.2);
      n.humG.gain.setTargetAtTime(0.03 * s.rpmK, t, 0.2);
      n.wind.gain.setTargetAtTime(Math.min(0.22, V * V / 28000), t, 0.2);
    }
  }
  quiet(drop) {
    if (!this.snd) return;
    const n = this.snd, t = n.ctx.currentTime;
    // (once: not a new automation event on every gain each frame while nobody flies)
    if (!n.quiet) { n.quiet = true; try { for (const g of n.gains) g.gain.setTargetAtTime(0, t, 0.08); } catch (e) {} }
    if (drop) { try { setTimeout(() => n.stop(), 500); } catch (e) {} this.snd = null; }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // the gauges: airspeed, height, throttle or collective, rotor speed, flaps; and what the keys do, for a while

  makeHud() {
    if (!this.hudEl) {
      const el = document.createElement('div');
      el.className = 'air-hud';
      el.style.cssText = 'position:fixed;left:16px;bottom:96px;z-index:20;pointer-events:none;font:600 12px/1.35 Geist,system-ui,sans-serif;color:#fff;background:rgba(10,14,20,.55);border-radius:10px;padding:8px 11px;min-width:150px;letter-spacing:.02em;text-shadow:0 1px 2px rgba(0,0,0,.4)';
      el.innerHTML = '<div class="a-row"></div><div class="a-hint" style="font-weight:500;opacity:.85;margin-top:5px;max-width:240px"></div>';
      (document.getElementById('ui') || document.body).appendChild(el);
      this.hudEl = el; this.hudRow = el.querySelector('.a-row'); this.hudHint = el.querySelector('.a-hint'); this.hudLast = '';
      // touch screens: buttons that hold Space and Shift (up and down), beside the drive's own pedals
      if (!document.getElementById('air-css')) {
        const st = document.createElement('style'); st.id = 'air-css';
        st.textContent = `.air-btn { display: none; }
.air-btn.on.touchy { display: block; position: fixed; width: 64px; height: 64px; border-radius: 50%; border: 0; background: rgba(32,33,36,.55); color: #fff; font: 500 14px Roboto, system-ui, sans-serif; pointer-events: auto; touch-action: none; user-select: none; -webkit-user-select: none; z-index: 21; }
.air-btn.down { background: rgba(26,115,232,.85) !important; }`;
        document.head.appendChild(st);
      }
      const keys = this.d.keys;
      // (on the left over the steering arrows: the right side has the pedals, E and the speed)
      this.btns = [['Up', 'Space', 18], ['Down', 'ShiftLeft', 96]].map(([label, code, left]) => {
        const b = document.createElement('button');
        b.className = 'air-btn'; b.textContent = label; b.setAttribute('aria-label', label); b.style.left = left + 'px'; b.style.bottom = '112px'; b.dataset.code = code;
        const on = e => { e.preventDefault(); if (keys) keys.add(code); b.classList.add('down'); };
        const off = e => { e.preventDefault(); if (keys) keys.delete(code); b.classList.remove('down'); };
        b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
        (document.getElementById('ui') || document.body).appendChild(b);
        return b;
      });
    }
    // (shown on touch screens only: the drive's hud has the class touch there)
    const touch = !!(this.d.hud && this.d.hud.el && this.d.hud.el.classList.contains('touch'));
    for (const b of this.btns || []) { b.classList.toggle('on', true); b.classList.toggle('touchy', touch); }
    // (on a touch screen the gauges go to the top left, out of the buttons' way)
    if (touch) { this.hudEl.style.bottom = 'auto'; this.hudEl.style.top = '64px'; }
    this.hudEl.style.display = '';
    this.hudHint.innerHTML = this.A.kind === 'plane'
      ? '<b>W</b>/<b>S</b> throttle &middot; <b>Space</b> nose up &middot; <b>Shift</b> nose down &middot; <b>A</b>/<b>D</b> steer and bank &middot; <b>F</b> flaps. Rotate at about 100 km/h.'
      : '<b>Space</b> climb &middot; <b>Shift</b> down &middot; <b>W</b>/<b>S</b> forward and back &middot; <b>A</b>/<b>D</b> turn. Let go to hover.';
    this.hudHint.style.display = '';
  }
  gauges(dt) {
    if (!this.hudEl) return;
    const v = this.v, s = v.airS, A = this.A, mph = this.d.mph;
    this.hint -= dt;
    if (this.hint < 0 && this.hudHint.style.display !== 'none') this.hudHint.style.display = 'none';
    this.gT = (this.gT || 0) - dt;
    if (this.gT > 0) return;
    this.gT = 0.12;
    const kt = Math.round(v.speed * 1.94384), alt = s.h > 400 ? '-' : (mph ? Math.round(s.h * 3.28084) + ' ft' : Math.round(s.h) + ' m');
    const vs = Math.round(v.v.y * (mph ? 196.85 : 1)) + (mph ? ' ft/min' : ' m/s');
    let txt;
    if (A.kind === 'plane') {
      txt = `${kt} kt &nbsp; ${alt} &nbsp; ${vs}<br>Throttle ${Math.round(s.thr * 100)}% &middot; flaps ${s.flap || A.flaps[s.flapI]}°${s.airborne && s.alpha > 0.22 ? ' &middot; <span style="color:#ff6b5b">STALL</span>' : ''}${!s.engine ? ' &middot; <span style="color:#ff6b5b">engine off</span>' : ''}`;
    } else {
      txt = `${kt} kt &nbsp; ${alt} &nbsp; ${vs}<br>Collective ${Math.round((s.coll || 0) * 100)}% &middot; rotor ${Math.round(s.rpmK * 100)}%${!s.rotorOK ? ' &middot; <span style="color:#ff6b5b">rotor lost</span>' : ''}`;
    }
    if (txt !== this.hudLast) { this.hudLast = txt; this.hudRow.innerHTML = txt; }
  }

  // for tests: the state in one object
  status() {
    const v = this.v; if (!v || !v.airS) return null;
    const s = v.airS, o = v.origin(new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(v.q), up = new THREE.Vector3(0, 1, 0).applyQuaternion(v.q), right = new THREE.Vector3(1, 0, 0).applyQuaternion(v.q);
    return { kind: this.A.kind, airborne: s.airborne, h: +s.h.toFixed(2), y: +o.y.toFixed(2), speed: +v.speed.toFixed(2), vy: +v.v.y.toFixed(2), thr: +s.thr.toFixed(2), coll: +(s.coll || 0).toFixed(3), rpm: +s.rpmK.toFixed(2), alpha: +(s.alpha * 57.3).toFixed(1), pitch: +(Math.asin(fwd.y) * 57.3).toFixed(1), roll: +(Math.atan2(-right.y, up.y) * 57.3).toFixed(1), heading: +v.heading.toFixed(1), engine: s.engine, rotorOK: s.rotorOK, broke: s.broke, bent: s.bent, wing: s.wing.map(x => +x.toFixed(2)), wrecked: s.wrecked, elev: +s.elev.toFixed(2), ail: +s.ail.toFixed(2), rud: +s.rud.toFixed(2) };
  }
}

function makeSound(ctx, out, kind) {
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const noise = () => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(); return s; };
  const n = { ctx, kind, gains: [], srcs: [] };
  const gain = v => { const g = ctx.createGain(); g.gain.value = v; n.gains.push(g); return g; };
  // wind past the airframe
  const wn = noise(); n.srcs.push(wn);
  const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 700; wf.Q.value = 0.5;
  n.wind = gain(0); wn.connect(wf).connect(n.wind).connect(out);
  if (kind === 'plane') {
    // the engine: a buzzing pair of waves through a resonant filter, beaten by the propeller's blades
    n.o1 = ctx.createOscillator(); n.o1.type = 'sawtooth'; n.o1.frequency.value = 40;
    n.o2 = ctx.createOscillator(); n.o2.type = 'square'; n.o2.frequency.value = 20;
    n.lp = ctx.createBiquadFilter(); n.lp.type = 'lowpass'; n.lp.frequency.value = 800; n.lp.Q.value = 4;
    const mix = ctx.createGain(); mix.gain.value = 1;
    const am = ctx.createGain(); am.gain.value = 0.7;
    n.lfo = ctx.createOscillator(); n.lfo.frequency.value = 40;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.3; n.lfo.connect(lfoG).connect(am.gain);
    n.eng = gain(0);
    n.o1.connect(mix); n.o2.connect(mix); mix.connect(n.lp).connect(am).connect(n.eng).connect(out);
    n.o1.start(); n.o2.start(); n.lfo.start(); n.srcs.push(n.o1, n.o2, n.lfo);
    // the stall warning horn
    const ho = ctx.createOscillator(); ho.type = 'square'; ho.frequency.value = 2900; ho.start(); n.srcs.push(ho);
    const hf = ctx.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = 2900; hf.Q.value = 6;
    n.horn = gain(0); ho.connect(hf).connect(n.horn).connect(out);
  } else {
    // the rotor: the blades' slap, noise opened and shut at the blade passing rate
    const rn = noise(); n.srcs.push(rn);
    n.bp = ctx.createBiquadFilter(); n.bp.type = 'bandpass'; n.bp.frequency.value = 500; n.bp.Q.value = 0.8;
    const am = ctx.createGain(); am.gain.value = 0.15;
    n.lfo = ctx.createOscillator(); n.lfo.type = 'sawtooth'; n.lfo.frequency.value = 26;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.85; n.lfo.connect(lfoG).connect(am.gain); n.lfo.start(); n.srcs.push(n.lfo);
    n.slap = gain(0); rn.connect(n.bp).connect(am).connect(n.slap).connect(out);
    // the turbines' whine
    n.whine = ctx.createOscillator(); n.whine.type = 'sine'; n.whine.frequency.value = 1500; n.whine.start(); n.srcs.push(n.whine);
    n.whineG = gain(0); n.whine.connect(n.whineG).connect(out);
    // the Fenestron's hum
    n.hum = ctx.createOscillator(); n.hum.type = 'triangle'; n.hum.frequency.value = 60; n.hum.start(); n.srcs.push(n.hum);
    const hl = ctx.createBiquadFilter(); hl.type = 'lowpass'; hl.frequency.value = 400;
    n.humG = gain(0); n.hum.connect(hl).connect(n.humG).connect(out);
  }
  n.stop = () => { for (const s of n.srcs) { try { s.stop(); s.disconnect(); } catch (e) {} } for (const g of n.gains) { try { g.disconnect(); } catch (e) {} } };
  return n;
}
