// A 53 ft dry-van semi-trailer behind the semi (player and traffic), built in code: a box with ribbed sides, swing
// doors with hinges and locking bars, a sliding tandem with dual wheels, landing gear, side skirts, mud flaps, the
// under-ride bar, lamps and reflective tape. It is a kinematic follower hitched at the fifth wheel: the rear axle
// trails the kingpin (the tractrix of the standard off-tracking model, dθ/dt = v/L sin(ψ - θ)), so it swings in on
// turns; the angle to the tractor is held within 80 degrees. Its wheels sit on the ground (pitch and roll from the
// heights under them). Solid for the player's car (circles in the traffic's colliders) and for the traffic (they wait
// behind it). ?notrailer turns it off.
// Trailer frame: origin at the kingpin, forward -z (the trailer runs back along +z), up +y.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const OFF = /[?&]notrailer(?=[=&]|$)/.test(location.search);
const SEMIS = new Set(['semi']);
// the kingpin in the tractor's frame. The Tesla Semi model's cab is long for its frame: the kingpin goes over the rear
// axle, so the box's front corners (1.6 m from it) clear the cab at any angle
const HITCH = { semi: [0, 1.12, 2.6] };

const LEN = 16.15, W = 2.59, FRONT = -0.91, REAR = FRONT + LEN; // 53 ft box, kingpin 0.91 m behind its front
const FLOOR = 0.04, BOXH = 2.9;                                  // box from just over the kingpin plate, 4.06 m tall
const R = 0.51, AX1 = 12.5, AX2 = 13.74, AXM = (AX1 + AX2) / 2;  // 22.5 in. tyres, spread tandem
const KPH = 1.12;                                                // kingpin height over the ground at rest
const L = AXM;                                                   // kingpin to the tandem's middle

let SHARED = null;
function ribTextures() {
  // a side panel 1.2 m wide: logistic posts and rivet lines at its edges, a faint vertical ripple between
  const w = 128, h = 256, cc = document.createElement('canvas'); cc.width = w; cc.height = h;
  const g = cc.getContext('2d');
  g.fillStyle = '#e8eaeb'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#c9cdd0'; g.fillRect(0, 0, 3, h); g.fillRect(w - 3, 0, 3, h);
  g.fillStyle = '#b8bdc1'; for (let y = 4; y < h; y += 9) { g.fillRect(6, y, 2, 2); g.fillRect(w - 8, y, 2, 2); }
  const map = new THREE.CanvasTexture(cc); map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 4;
  const nd = new Uint8Array(w * 4);
  for (let x = 0; x < w; x++) {
    const u = x / w;
    // a raised post at the edges, shallow ribs between
    let dh = Math.cos(u * Math.PI * 2 * 4) * 0.25;
    if (x < 5) dh = 0.9; else if (x > w - 6) dh = -0.9;
    const n = new THREE.Vector3(-dh, 0, 1).normalize();
    nd[x * 4] = 128 + n.x * 127; nd[x * 4 + 1] = 128; nd[x * 4 + 2] = 128 + n.z * 127; nd[x * 4 + 3] = 255;
  }
  const nrm = new THREE.DataTexture(nd, w, 1); nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping; nrm.needsUpdate = true;
  nrm.magFilter = THREE.LinearFilter; nrm.minFilter = THREE.LinearFilter;
  return { map, nrm };
}

function shared() {
  if (SHARED) return SHARED;
  const T = ribTextures();
  const M = {
    side: new THREE.MeshStandardMaterial({ name: 'trailer_side', map: T.map, normalMap: T.nrm, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.45, metalness: 0.15 }),
    white: new THREE.MeshStandardMaterial({ name: 'trailer_white', color: 0xe6e8e9, roughness: 0.5, metalness: 0.1 }),
    alu: new THREE.MeshStandardMaterial({ name: 'trailer_alu', color: 0xa7abaf, roughness: 0.35, metalness: 0.8 }),
    steel: new THREE.MeshStandardMaterial({ name: 'trailer_steel', color: 0x2a2b2d, roughness: 0.6, metalness: 0.5 }),
    rubber: new THREE.MeshStandardMaterial({ name: 'trailer_rubber', color: 0x141414, roughness: 0.9, metalness: 0 }),
    rim: new THREE.MeshStandardMaterial({ name: 'trailer_rim', color: 0xc4c7ca, roughness: 0.3, metalness: 0.85 }),
    tapeRed: new THREE.MeshStandardMaterial({ name: 'trailer_tape_red', color: 0xb0140f, emissive: 0x300000, roughness: 0.3 }),
    tapeWhite: new THREE.MeshStandardMaterial({ name: 'trailer_tape_white', color: 0xf4f4f0, emissive: 0x222222, roughness: 0.3 }),
    amber: new THREE.MeshStandardMaterial({ name: 'trailer_amber', color: 0xd88a10, emissive: 0x4a2600, roughness: 0.3 }),
    red: new THREE.MeshStandardMaterial({ name: 'trailer_red', color: 0x8a0d08, emissive: 0x2a0000, roughness: 0.3 }),
    redOn: new THREE.MeshStandardMaterial({ name: 'trailer_red_on', color: 0xff2a18, emissive: 0xff1a10, emissiveIntensity: 4, roughness: 0.3 }),
    proxy: new THREE.MeshBasicMaterial({ name: 'trailer_shadow_proxy', colorWrite: false, depthWrite: false }),
  };
  const parts = { side: [], white: [], alu: [], steel: [], rubber: [], tapeRed: [], tapeWhite: [], amber: [], red: [] };
  const box = (k, sx, sy, sz, x, y, z) => { const b = new THREE.BoxGeometry(sx, sy, sz); b.translate(x, y, z); parts[k].push(b); };
  const cyl = (k, r, len, x, y, z, axis = 'y', seg = 12) => {
    const c = new THREE.CylinderGeometry(r, r, len, seg); if (axis === 'x') c.rotateZ(Math.PI / 2); if (axis === 'z') c.rotateX(Math.PI / 2);
    c.translate(x, y, z); parts[k].push(c);
  };
  const y0 = FLOOR, y1 = FLOOR + BOXH, cz = (FRONT + REAR) / 2, hw = W / 2;
  // ribbed side panels (UVs: one texture across every 1.2 m)
  for (const s of [-1, 1]) {
    const p = new THREE.PlaneGeometry(LEN - 0.1, BOXH - 0.16);
    const uv = p.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (LEN - 0.1) / 1.2);
    p.rotateY(s * Math.PI / 2); p.translate(s * hw, (y0 + y1) / 2, cz);
    parts.side.push(p);
  }
  // front wall, roof, floor underside
  box('white', W - 0.02, BOXH, 0.04, 0, (y0 + y1) / 2, FRONT + 0.02);
  box('white', W - 0.02, 0.03, LEN, 0, y1 - 0.015, cz);
  box('steel', W - 0.04, 0.06, LEN, 0, y0 + 0.03, cz);
  // top and bottom rails, front corner posts
  for (const s of [-1, 1]) {
    box('alu', 0.05, 0.09, LEN, s * (hw + 0.005), y1 - 0.045, cz);
    box('alu', 0.06, 0.2, LEN, s * (hw + 0.01), y0 + 0.1, cz);
    box('alu', 0.07, BOXH, 0.07, s * (hw - 0.01), (y0 + y1) / 2, FRONT + 0.035);
  }
  // rear frame: corner posts, header, sill
  box('alu', 0.12, BOXH, 0.12, -hw + 0.06, (y0 + y1) / 2, REAR - 0.04);
  box('alu', 0.12, BOXH, 0.12, hw - 0.06, (y0 + y1) / 2, REAR - 0.04);
  box('alu', W, 0.18, 0.12, 0, y1 - 0.09, REAR - 0.04);
  box('steel', W, 0.24, 0.16, 0, y0 + 0.08, REAR - 0.05);
  // swing doors, their hinges (four on each outer edge) and locking bars (two a door, with cams and handles)
  const dw = (W - 0.26) / 2, dh = BOXH - 0.44, dy = y0 + 0.2 + dh / 2;
  for (const s of [-1, 1]) {
    const dx = s * (dw / 2 + 0.006);
    box('white', dw - 0.01, dh, 0.04, dx, dy, REAR + 0.01);
    for (let k = 0; k < 4; k++) box('alu', 0.16, 0.06, 0.03, s * (hw - 0.14), y0 + 0.45 + k * (dh - 0.5) / 3, REAR + 0.045);
    for (const f of [0.28, 0.72]) {
      const bx = dx + s * (f - 0.5) * dw * 0.9;
      cyl('alu', 0.018, dh + 0.12, bx, dy, REAR + 0.06);
      box('alu', 0.05, 0.07, 0.05, bx, dy - dh / 2 - 0.02, REAR + 0.06);
      box('alu', 0.05, 0.07, 0.05, bx, dy + dh / 2 + 0.02, REAR + 0.06);
      box('steel', 0.04, 0.3, 0.05, bx + s * 0.05, dy - 0.25, REAR + 0.085);
    }
  }
  // main beams, the slider over the tandem, landing gear, the kingpin plate
  for (const s of [-1, 1]) box('steel', 0.08, 0.32, LEN - 1.4, s * 0.48, y0 - 0.16, cz + 0.6);
  box('steel', 1.15, 0.16, 3.6, 0, y0 - 0.38, AXM + 0.2);
  box('steel', 1.4, 0.03, 1.3, 0, y0 - 0.015, 0.2);
  for (const s of [-1, 1]) {
    box('steel', 0.13, KPH + y0 - 0.32, 0.13, s * 0.85, (KPH + y0 - 0.32) / 2 - KPH + 0.25, 2.4);
    box('alu', 0.11, 0.55, 0.11, s * 0.85, 0.42 - KPH, 2.4);
    box('steel', 0.3, 0.05, 0.3, s * 0.85, 0.18 - KPH, 2.4);
  }
  box('steel', 1.6, 0.06, 0.06, 0, -0.35, 2.4);
  // side skirts
  for (const s of [-1, 1]) box('white', 0.02, 0.72, 8.2, s * (hw - 0.04), y0 - 0.38, 7.5);
  // axles and suspension, mud flaps, the under-ride bar
  for (const az of [AX1, AX2]) { cyl('steel', 0.07, W - 0.5, 0, R - KPH, az, 'x'); box('steel', 0.1, 0.4, 0.9, -0.5, R - KPH + 0.25, az); box('steel', 0.1, 0.4, 0.9, 0.5, R - KPH + 0.25, az); }
  for (const s of [-1, 1]) { box('rubber', 0.62, 0.72, 0.012, s * 0.95, 0.64 - KPH, AX2 + 0.85); box('steel', 0.7, 0.05, 0.05, s * 0.95, 1.0 - KPH, AX2 + 0.85); }
  box('steel', 2.35, 0.1, 0.1, 0, 0.56 - KPH, REAR + 0.1);
  for (const s of [-1, 1]) box('steel', 0.08, 0.6, 0.08, s * 0.7, 0.86 - KPH, REAR + 0.02);
  // lamps: three red tail lamps and an amber one a side on the rear sill, three red ID lamps on the header, side
  // markers (amber at the front and middle, red at the rear)
  for (const s of [-1, 1]) {
    for (const x of [1.05, 0.92]) cyl('red', 0.055, 0.03, s * x, y0 + 0.05, REAR + 0.05, 'z');
    cyl('amber', 0.055, 0.03, s * 0.78, y0 + 0.05, REAR + 0.05, 'z');
    box('amber', 0.02, 0.05, 0.1, s * (hw + 0.02), y0 + 0.25, FRONT + 0.3);
    box('amber', 0.02, 0.05, 0.1, s * (hw + 0.02), y0 + 0.25, cz);
    box('red', 0.02, 0.05, 0.1, s * (hw + 0.02), y0 + 0.25, REAR - 0.3);
    box('red', 0.02, 0.05, 0.1, s * (hw + 0.02), y1 - 0.15, REAR - 0.2);
  }
  for (const x of [-0.15, 0, 0.15]) cyl('red', 0.03, 0.03, x, y1 - 0.09, REAR + 0.03, 'z');
  // reflective tape: red and white strips along the lower sides and round the rear frame
  for (const s of [-1, 1]) for (let z = FRONT + 0.4, k = 0; z < REAR - 0.5; z += 0.3, k++) box(k % 2 ? 'tapeWhite' : 'tapeRed', 0.012, 0.05, 0.3, s * (hw + 0.017), y0 + 0.16, z + 0.15);
  for (let x = -hw + 0.1, k = 0; x < hw - 0.15; x += 0.3, k++) box(k % 2 ? 'tapeWhite' : 'tapeRed', 0.3, 0.05, 0.012, x + 0.15, y0 - 0.01, REAR + 0.085);
  for (const s of [-1, 1]) for (let y = y0 + 0.3, k = 0; y < y1 - 0.3; y += 0.3, k++) box(k % 2 ? 'tapeWhite' : 'tapeRed', 0.05, 0.3, 0.012, s * (hw - 0.06), y + 0.15, REAR + 0.025);
  const geo = {};
  for (const k in parts) if (parts[k].length) geo[k] = mergeGeometries(parts[k].map(g => g.index ? g.toNonIndexed() : g));
  // one axle's wheels (both sides, two tyres a side): spins as one about x
  const tyres = [], rims = [];
  for (const s of [-1, 1]) for (const x of [1.1, 0.79]) {
    const t = new THREE.CylinderGeometry(R, R, 0.27, 24); t.rotateZ(Math.PI / 2); t.translate(s * x, 0, 0); tyres.push(t.toNonIndexed());
    const r = new THREE.CylinderGeometry(0.29, 0.29, 0.28, 16); r.rotateZ(Math.PI / 2); r.translate(s * x, 0, 0); rims.push(r.toNonIndexed());
    // the hub's studs, so the spin shows
    for (let a = 0; a < 6; a++) { const b = new THREE.BoxGeometry(0.02, 0.04, 0.04); b.translate(s * (x + 0.145), Math.cos(a) * 0.1, Math.sin(a) * 0.1); rims.push(b.toNonIndexed()); }
  }
  geo.tyre = mergeGeometries(tyres); geo.rimw = mergeGeometries(rims);
  // the proxy that casts the trailer's shadow: the box and the wheels as plain boxes
  const sh = new THREE.BoxGeometry(W, BOXH, LEN); sh.translate(0, (y0 + y1) / 2, cz);
  geo.shadow = sh;
  SHARED = { M, geo };
  return SHARED;
}

const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ');

class Trailer {
  constructor(scene) {
    const { M, geo } = shared();
    const o = this.object = new THREE.Group(); o.name = 'trailer';
    const add = (g, m, cast) => { const me = new THREE.Mesh(g, m); me.castShadow = !!cast; me.receiveShadow = true; o.add(me); return me; };
    for (const k of ['side', 'white', 'alu', 'steel', 'rubber', 'tapeRed', 'tapeWhite', 'amber']) if (geo[k]) add(geo[k], M[k]);
    this.red = add(geo.red, M.red);
    const shadow = new THREE.Mesh(geo.shadow, M.proxy);
    shadow.castShadow = true; shadow.onBeforeRender = () => {}; o.add(shadow); this.shadow = shadow;
    this.axles = [];
    for (const az of [AX1, AX2]) {
      const g = new THREE.Group(); g.position.set(0, R - KPH, az);
      g.add(new THREE.Mesh(geo.tyre, M.tyre || M.rubber), new THREE.Mesh(geo.rimw, M.rim));
      o.add(g); this.axles.push(g);
    }
    scene.add(o);
    this.scene = scene; this.A = null; this.spin = 0; this.circles = []; this.theta = 0; this.vx = 0; this.vz = 0;
  }
  dispose() { if (this.object.parent) this.object.parent.remove(this.object); }

  // K: the kingpin in the world; psi: the tractor's heading (radians, the trailer's yaw convention); ground(x, z, y)
  follow(K, psi, ground, dt, brake) {
    if (!this.A || Math.hypot(this.A.x - K.x, this.A.z - K.z) > L + 3 || Math.hypot(this.A.x - K.x, this.A.z - K.z) < L - 3) {
      // first time, or a jump (a new car, a respawn): straight out behind
      this.A = new THREE.Vector3(K.x + Math.sin(psi) * L, K.y, K.z + Math.cos(psi) * L);
      this.theta = psi;
    }
    const ax = this.A.x, az = this.A.z;
    // the axle trails the kingpin
    let dx = ax - K.x, dz = az - K.z;
    let th = Math.atan2(dx, dz); // the direction from the kingpin back to the axle
    // held within 80 degrees of the tractor's line
    let rel = Math.atan2(Math.sin(th - psi), Math.cos(th - psi));
    const lim = 80 * Math.PI / 180;
    if (rel > lim) rel = lim; else if (rel < -lim) rel = -lim;
    th = psi + rel;
    this.A.x = K.x + Math.sin(th) * L; this.A.z = K.z + Math.cos(th) * L;
    const moved = (this.A.x - ax) * -Math.sin(th) + (this.A.z - az) * -Math.cos(th); // along the trailer's forward
    this.vx = dt > 0 ? (this.A.x - ax) / dt : 0; this.vz = dt > 0 ? (this.A.z - az) / dt : 0;
    this.theta = th;
    this.spin = (this.spin + moved / R) % (Math.PI * 2);
    for (const g of this.axles) g.rotation.x = -this.spin;
    // the wheels on the ground: heights under the axle's two ends
    const rx = Math.cos(th), rz = -Math.sin(th); // the trailer's right (+x) in the world
    const gl = ground(this.A.x - rx * 0.95, this.A.z - rz * 0.95, K.y), gr = ground(this.A.x + rx * 0.95, this.A.z + rz * 0.95, K.y);
    const gm = (gl != null && gr != null) ? (gl + gr) / 2 : (gl ?? gr ?? K.y - KPH);
    const axleY = gm + R;
    const horiz = L, rest = Math.atan2(KPH - R, L);
    const pitch = Math.atan2(K.y - axleY, horiz) - rest;
    const roll = (gl != null && gr != null) ? Math.atan2(gr - gl, 1.9) : 0;
    this.A.y = axleY;
    _e.set(THREE.MathUtils.clamp(pitch, -0.3, 0.3), th, THREE.MathUtils.clamp(roll, -0.25, 0.25));
    this.object.quaternion.setFromEuler(_e);
    this.object.position.copy(K);
    this.red.material = brake ? shared().M.redOn : shared().M.red;
    // circles along the box for collisions
    const n = 11, rr = W / 2 * 0.98;
    if (this.circles.length !== n) this.circles = Array.from({ length: n }, () => ({ x: 0, z: 0, r: rr }));
    const fx = Math.sin(th), fz = Math.cos(th);
    for (let i = 0; i < n; i++) {
      const t = FRONT + rr + (LEN - 2 * rr) * i / (n - 1);
      this.circles[i].x = K.x + fx * t; this.circles[i].z = K.z + fz * t;
    }
  }
}

// every trailer in the game: the player's semi's and the traffic semis'
export class Trailers {
  constructor(drive) {
    this.drive = drive; this.off = OFF; this.mine = null; this.traffic = new Map(); this.pool = [];
    // semis the player left standing (onfoot.js parked: got out and took another car): each keeps its trailer
    this.left = new Map();
    this._K = new THREE.Vector3();
    this.aheadFn = (c, g, l) => this.ahead(c, g, l);
    this.collFn = out => this.colliders(out);
  }

  kingpin(rig, out) {
    const h = HITCH[rig.id] || HITCH.semi;
    rig.object.updateMatrixWorld(true);
    return out.set(h[0], h[1], h[2]).applyMatrix4(rig.object.matrixWorld);
  }
  yaw(rig) {
    _v.set(0, 0, -1).applyQuaternion(rig.object.quaternion);
    return Math.atan2(-_v.x, -_v.z); // the trailer's yaw convention: rotation.y, its back along (sin, cos)
  }

  // every trailer shader built during loading (drive.start, before it compiles the scene and draws one frame behind
  // the loading card): a trailer under the ground below the car, never culled, its brake lamps' lit material too, so
  // the shadow pass's programs are made in that frame as well; taken away after a few frames of play
  warmup() {
    if (this.off) return;
    const D = this.drive, o = D.car && D.car.vehicle ? D.car.vehicle.origin(new THREE.Vector3()) : new THREE.Vector3();
    if (this.warm) this.warm.t.dispose();
    const t = new Trailer(D.scene);
    t.object.position.set(o.x, o.y - 5.2, o.z);
    const lit = new THREE.Mesh(shared().geo.red, shared().M.redOn); t.object.add(lit);
    t.object.traverse(m => { if (m.isMesh) m.frustumCulled = false; });
    this.warm = { t, frames: 3 };
  }

  update(dt) {
    if (this.warm && --this.warm.frames <= 0) { this.warm.t.dispose(); this.warm = null; }
    if (this.off) return;
    const D = this.drive, ground = (x, z, y) => D.ground(x, z, y);
    // the player's semi
    const car = D.car, isSemi = car && car.rig && SEMIS.has(car.rig.id);
    // (a semi left standing keeps its trailer, hitched where it was: the one the player drove, and back again when
    // the player takes it once more)
    const leftCars = D.onfoot && Array.isArray(D.onfoot.parked) ? D.onfoot.parked : [];
    const isLeft = rig => leftCars.some(e => e && e.rig === rig);
    const letGo = () => { if (isLeft(this.mine.rig) && !this.left.has(this.mine.rig)) this.left.set(this.mine.rig, this.mine.t); else this.mine.t.dispose(); this.mine.rig.camBack = 0; this.mine.rig.camUp = 0; this.mine = null; };
    if (isSemi) {
      if (!this.mine || this.mine.rig !== car.rig) {
        if (this.mine) letGo();
        const kept = this.left.get(car.rig); if (kept) this.left.delete(car.rig);
        this.mine = { rig: car.rig, t: kept || new Trailer(D.scene) }; car.rig.camBack = 13; car.rig.camUp = 2.2;
      }
      const v = car.vehicle;
      this.mine.t.follow(this.kingpin(car.rig, this._K), this.yaw(car.rig), ground, dt, v && v.brake > 0.05);
    } else if (this.mine) letGo();
    if (this.left.size) {
      for (const [rig, t] of this.left) {
        const e = leftCars.find(q => q && q.rig === rig);
        if (!e || !rig.object || !rig.object.parent) { t.dispose(); this.left.delete(rig); continue; }
        t.follow(this.kingpin(rig, this._K), this.yaw(rig), ground, dt, true);
      }
    }
    // the traffic's semis
    const T = D.traffic;
    if (T && T.list) {
      if (T.trailerAhead !== this.aheadFn) T.trailerAhead = this.aheadFn;
      if (T.extraColliders !== this.collFn) T.extraColliders = this.collFn;
      const seen = new Set();
      for (const c of T.list) {
        if (!c.rig || !SEMIS.has(c.rig.id)) continue;
        seen.add(c);
        let t = this.traffic.get(c);
        if (!t) { t = this.pool.pop() || new Trailer(T.group || D.scene); if (!t.object.parent) (T.group || D.scene).add(t.object); t.A = null; this.traffic.set(c, t); }
        t.follow(this.kingpin(c.rig, this._K), this.yaw(c.rig), ground, dt, c.brake > 0.05);
      }
      for (const [c, t] of this.traffic) if (!seen.has(c)) { t.dispose(); this.pool.push(t); this.traffic.delete(c); }
    }
    // (round 5) other players' semis in a multiplayer room (mp.js semis: { rig, brake } each)
    const N = D.net;
    if ((N && N.semis) || (this.remote && this.remote.size)) {
      const R = this.remote || (this.remote = new Map()), seen = this._rseen || (this._rseen = new Set());
      seen.clear();
      if (N && N.semis) for (const s of N.semis()) {
        if (!s.rig || !s.rig.object || !SEMIS.has(s.rig.id)) continue;
        seen.add(s.rig);
        let t = R.get(s.rig);
        if (!t) { t = this.pool.pop() || new Trailer(D.scene); if (!t.object.parent) D.scene.add(t.object); t.A = null; R.set(s.rig, t); }
        t.object.visible = s.rig.object.visible;
        t.follow(this.kingpin(s.rig, this._K), this.yaw(s.rig), ground, dt, !!s.brake);
      }
      for (const [k, t] of R) if (!seen.has(k)) { t.dispose(); this.pool.push(t); R.delete(k); }
    }
  }

  // the player's car hits the traffic semis' trailers (traffic.colliders, through its extraColliders hook)
  colliders(out) {
    for (const [c, t] of this.traffic) for (const k of t.circles) out.push({ x: k.x, z: k.z, r: k.r, vx: t.vx, vz: t.vz, obj: c });
    for (const t of this.left.values()) for (const k of t.circles) out.push({ x: k.x, z: k.z, r: k.r, vx: 0, vz: 0, obj: null });
  }

  // the traffic waits behind any trailer in its way (traffic.ahead, through its trailerAhead hook)
  ahead(c, gap, lv) {
    const fx = Math.sin(c.yaw), fz = -Math.cos(c.yaw);
    const test = t => {
      for (const k of t.circles) {
        const dx = k.x - c.x, dz = k.z - c.z, lon = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
        if (lon > 0 && lon < 40 && lat < k.r + 1.0) { const g = lon - c.len / 2 - k.r - 1.0; if (g < gap) { gap = Math.max(0, g); lv = 0; } }
      }
    };
    if (this.mine) test(this.mine.t);
    for (const t of this.left.values()) test(t);
    for (const [o, t] of this.traffic) if (o !== c) test(t);
    return { gap, lv };
  }

  dispose() {
    if (this.mine) { this.mine.t.dispose(); this.mine.rig.camBack = 0; this.mine.rig.camUp = 0; this.mine = null; }
    for (const t of this.left.values()) t.dispose();
    this.left.clear();
    for (const t of this.traffic.values()) t.dispose();
    this.traffic.clear(); this.pool.length = 0;
    if (this.remote) { for (const t of this.remote.values()) t.dispose(); this.remote.clear(); }
  }
}

// tests: the shared trailer materials (to check their shaders were built during loading)
export function trailerMaterials() { return SHARED ? Object.values(SHARED.M) : []; }
