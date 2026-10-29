// The Roadster's thrusters, after the "SpaceX package" Tesla described for the second Roadster: tanks of gas at high
// pressure behind the seats feed cold-gas thrusters round the car, and the rear number plate flips down to uncover a
// nozzle. Here: four lift nozzles under the corners pointing down, a main nozzle behind the rear plate pointing back,
// and small side nozzles that turn the car in the air.
//
// Space (held) lifts the car through its own up. Let go and it holds for a moment, then sinks slowly and slows again
// near the ground, so it lands on its wheels. Shift pressed in the air brings it down under control, the mirror of
// Space's climb, slowing near the ground so it settles on its wheels (Space and Shift together hold the height; let
// Shift go and it holds a moment, as after Space). In the air W and S tip the nose (W also fires the main nozzle), A
// and D turn and bank, F is the boost (faster up, down and along). On the ground Shift (or F) with W fires the main
// nozzle as before; a Shift pressed on the ground stays the boost if the car then takes off, and a Shift held from
// the air never fires the nozzle on landing until it is let go. Pad: A up, B down, RB boost. An assist keeps the
// car level.
// The gas runs down while the thrusters work and the tanks fill again on the ground. Landing and hitting things are
// the normal wheel and collision physics.
//
// The jets: expanding cold gas cools enough to condense the air's water, so the plumes are white vapour: a dense
// blue-white core at each nozzle that widens into a turbulent cone and breaks into puffs that linger and drift, faint
// shock diamonds in the main jet, and near the ground a ring of vapour and dust blown out along it.
//
// A car flies when its catalogue entry has fly: true (?fly in the address lets every car fly, for tests).
// Hooks: drive.js makes one Flight and calls before() each frame ahead of the physics steps and frame() after the
// camera; vehicle.js calls this.ext() inside each step to add the thrust; camera.js reads vehicle.flyCam.
import * as THREE from 'three';

const G = 9.81;
const SEARCH = typeof location !== 'undefined' ? location.search : '';
const FLY_ALL = /[?&]fly(?=[=&]|$)/.test(SEARCH);
export function canFly(spec) { return !!(spec && spec.fly) || (FLY_ALL && !(spec && spec.air)); } // (aircraft fly by aircraft.js)

// thrust in weights of the car, speeds in m/s
const LIFT_MAX = 1.6, LIFT_BOOST = 2.1;     // the lift jets together, at most
const CLIMB = 5, CLIMB_BOOST = 9;           // climb with Space held
const DESCEND = 5, DESCEND_BOOST = 8;       // down with Shift held in the air (the mirror of the climb)
const SETTLE0 = 0.6, SETTLE = 0.6;          // ...at most SETTLE0 + SETTLE x height near the ground (0.6 m/s at touch-down)
const SINK = 2.4, HOLD = 1.2, SINKA = 0.8;  // once let go: a hover for HOLD s, then down, faster by SINKA a second, to SINK
const MAIN = 0.5, MAIN_BOOST = 0.85, MAIN_GROUND = 1.1; // the main jet (on the ground: 0 to 97 km/h in about 1.1 s, Tesla's claim)
const DRAG = 0.0026;                        // in the air, a = DRAG v^2: about 160 km/h flat out, 200 with the boost
const SLIDE = 0.9;                          // sideways speed taken out a second (the side nozzles keep it pointing)
const KP = 14, KD = 6.5, KYAW = 5, AMAX = 7; // the levelling assist
const USE = 0.025, USE_MAIN = 0.05;         // tank used a second per weight of thrust (about 40 s of hovering)
const REFILL = 0.07;                        // tank filled a second on the ground (14 s from empty)
const MAXP = 900;                           // puffs alive at most

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _h = new THREE.Vector3(), _s = new THREE.Vector3(), _w = new THREE.Vector3(), _t = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _Y = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;
const _FROST = new THREE.Color(0xe4edf4);
const rnd = (a, b) => a + Math.random() * (b - a);

export class Flight {
  constructor(drive) {
    this.d = drive;
    this.group = new THREE.Group(); this.group.name = 'flight';
    this.group.visible = false;
    this.slots = [];
    this.coneGeo = coneGeometry();
    this.glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0x9fd4ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55, fog: false });
    // nine nozzles at most: four lift, one main, four side
    for (let i = 0; i < 9; i++) {
      const mat = coneMaterial();
      const mesh = new THREE.Mesh(this.coneGeo, mat);
      mesh.frustumCulled = false; mesh.renderOrder = 11; mesh.visible = false; mesh.name = 'jet';
      const glow = new THREE.Sprite(this.glowMat);
      glow.visible = false; glow.renderOrder = 13;
      this.group.add(mesh, glow);
      this.slots.push({ kind: -1, pos: new THREE.Vector3(), dir: new THREE.Vector3(0, -1, 0), r0: 0.04, len: 1.5, spread: 0.22, thr: 0, wp: new THREE.Vector3(), wd: new THREE.Vector3(), mesh, glow, mat, acc: 0, gacc: 0, side: 0, front: false });
    }
    this.puffs = new Puffs(MAXP);
    this.group.add(this.puffs.mesh);
    // the ring of dust that races out along the ground as the valves open near it
    const rg = new THREE.PlaneGeometry(1, 1); rg.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ map: ringTexture(), color: 0xd8d4cc, transparent: true, opacity: 0, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    this.ring.name = 'flight_ring'; this.ring.renderOrder = 10; this.ring.visible = false; this.ringT = -1;
    this.group.add(this.ring);
    // in the scene from the start (hidden), so the drive builds these shaders with the rest while a drop loads
    drive.scene.add(this.group);
    this.s = freshState();
    this.v = null; this.rig = null; this.on = false;
    this.jets = { lift: 0, main: 0 };
    // other players' flying cars' jets (mp.js, remoteJets): a group of their own, always shown
    this.rgroup = new THREE.Group(); this.rgroup.name = 'flight_remote'; drive.scene.add(this.rgroup);
    this.remote = new Map();
    this.h = 99; this.gY = 0; this.time = 0; this.warned = 0;
    this.camK = 0; this.ignite = 0; this.sunK = 1; this.lod = 1;
    this.keyThrust = false; this.keyBoost = false; this.keyDown = false; this.shiftMode = 0; this.descK = 0; this.inThr = 0; this.inBrk = 0; this.inSteer = 0;
    try { this.makeHud(); } catch (e) { console.warn('flight hud', e); }
  }

  warn(e) { if (this.warned++ < 3) console.warn('flight', e); }

  // the player's car flying (mp.js sends it)
  get flying() { return !!(this.on && this.v && this.s && this.s.flying && this.driving()); }

  // another player's flying car (mp.js): its four lift jets and the main one drawn from how hard they blow on that
  // page (the cones and their glow; no puffs or sound); called each frame it is shown, rig null once it is gone
  remoteJets(id, rig, lift, main, dt) {
    try {
      let J = this.remote.get(id);
      if (!rig || !(lift > 0.02 || main > 0.02)) {
        if (J) {
          for (const sl of J.slots) { sl.thr = 0; sl.mesh.visible = false; sl.glow.visible = false; }
          if (!rig) { for (const sl of J.slots) { this.rgroup.remove(sl.mesh, sl.glow); sl.mat.dispose(); } this.remote.delete(id); }
        }
        return;
      }
      if (!J || J.rig !== rig) {
        if (J) for (const sl of J.slots) { this.rgroup.remove(sl.mesh, sl.glow); sl.mat.dispose(); }
        J = { rig, slots: [], gY: -1e4, n: 0 };
        const dm = rig.dims || {}, L = dm.length || 4.5, W = dm.width || 1.9;
        const front = dm.front ?? L / 2, rear = dm.rear ?? L / 2;
        const wf = rig.wheels && rig.wheels[0], wr = rig.wheels && rig.wheels[2];
        let fz = -front + 0.4, rz = rear - 0.4;
        if (wf) fz = Math.min(fz, wf.pos.z - wf.radius - 0.14);
        if (wr) rz = Math.max(rz, wr.pos.z + wr.radius + 0.14);
        fz = Math.max(fz, -front + 0.22); rz = Math.min(rz, rear - 0.22);
        const add = (kind, pos, dir, r0, len, spread) => {
          const mat = coneMaterial(), mesh = new THREE.Mesh(this.coneGeo, mat), glow = new THREE.Sprite(this.glowMat);
          mesh.frustumCulled = false; mesh.renderOrder = 11; mesh.visible = false; mesh.name = 'jet';
          glow.visible = false; glow.renderOrder = 13;
          this.rgroup.add(mesh, glow);
          J.slots.push({ kind, pos, dir: dir.normalize(), r0, len, spread, thr: 0, wp: new THREE.Vector3(), wd: new THREE.Vector3(), mesh, glow, mat });
        };
        for (const [sx, sz] of [[-1, fz], [1, fz], [-1, rz], [1, rz]]) add(0, new THREE.Vector3(sx * (W / 2 - 0.3), 0.21, sz), new THREE.Vector3(sx * 0.1, -1, sz < 0 ? -0.06 : 0.06), 0.045, 1.7, 0.3);
        const pl = rig.spec && rig.spec.plate && Array.isArray(rig.spec.plate.pos) ? new THREE.Vector3().fromArray(rig.spec.plate.pos) : new THREE.Vector3(0, 0.44, rear);
        add(1, pl.add(new THREE.Vector3(0, 0, 0.025)), new THREE.Vector3(0, 0, 1), 0.05, 2.8, 0.2);
        this.remote.set(id, J);
      }
      const o = rig.object, P = o.position, Q = o.quaternion;
      // the ground under it now and then (the jets stop where they meet it)
      if ((J.n++ % 10) === 0) { let g = null; try { g = this.d.ground ? this.d.ground(P.x, P.z, P.y + 0.5) : null; } catch (e) {} J.gY = Number.isFinite(g) ? g : P.y - 50; }
      const t = (performance.now() / 1000) % 400;
      for (const sl of J.slots) {
        const want = sl.kind === 0 ? Math.min(1.5, lift) : Math.min(1.4, main);
        sl.thr += (want - sl.thr) * (1 - Math.exp(-dt * (want > sl.thr ? 22 : 9)));
        const thr = sl.thr;
        if (thr < 0.02) { sl.mesh.visible = false; sl.glow.visible = false; continue; }
        sl.wp.copy(sl.pos).applyQuaternion(Q).add(P); sl.wd.copy(sl.dir).applyQuaternion(Q);
        const down = -sl.wd.y, toGround = down > 0.15 ? (sl.wp.y - J.gY) / down : 1e3;
        const full = sl.len * (0.45 + 0.55 * Math.min(1.2, thr));
        const len = Math.max(0.05, Math.min(full, toGround + 0.05));
        const r1 = sl.r0 + full * sl.spread * (0.7 + 0.3 * thr);
        const u = sl.mat.uniforms;
        u.uThr.value = Math.min(1.2, thr); u.uLen.value = len; u.uFull.value = full; u.uR0.value = sl.r0; u.uR1.value = sl.r0 + (r1 - sl.r0) * len / full;
        u.uTime.value = t; u.uGround.value = J.gY; u.uDiamond.value = sl.kind === 1 ? 1 : 0;
        sl.mesh.position.copy(sl.wp); sl.mesh.quaternion.setFromUnitVectors(_Y, sl.wd); sl.mesh.visible = true;
        sl.glow.position.copy(sl.wp).addScaledVector(sl.wd, 0.04); sl.glow.scale.setScalar(0.22 + 0.18 * Math.min(1, thr)); sl.glow.visible = true;
      }
    } catch (e) { this.warn(e); }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // the car being driven

  // is the player at the wheel of drive.car (the people module may have them on foot)
  driving() {
    const d = this.d;
    this.landing = false;
    if (!(d.car && d.car.vehicle && d.car.rig)) return false;
    const of = d.onfoot;
    // getting out (onfoot.js waits for the car to stop first): a flying car is brought down to the ground
    if (of && of.mode === 'exit' && of.seq && of.seq.phase === 'stop' && of.seq.car === d.car) { this.landing = true; return true; }
    if ((of && of.active) || d.onFoot || d.walking) return false;
    return true;
  }

  attach(car) {
    this.detach();
    const rig = car.rig, v = car.vehicle;
    this.v = v; this.rig = rig;
    this.on = canFly(rig.spec || (FLY_ALL ? {} : null));
    if (!this.on) return;
    v.ext = (...a) => this.ext(...a);
    this.s = freshState();
    // (the gas left is the car's own: getting out and back in does not fill it)
    if (Number.isFinite(v._flightTank)) this.s.tank = v._flightTank;
    this.hintT = 9; this.airHintT = 0;
    // the nozzles, the plate and its hinge on this rig (made once a rig)
    try { this.layout(rig); } catch (e) { this.warn(e); }
    try { this.parts(rig); } catch (e) { this.warn(e); }
    this.puffs.clear();
    this.lastO = v.origin(new THREE.Vector3());
  }

  detach() {
    if (this.v && this.v.ext) this.v.ext = null;
    if (this.v && this.s) this.v._flightTank = this.s.tank;
    if (this.v) this.v.flyCam = 0;
    // the plate back up on a car left behind
    const F = this.rig && this.rig._flight;
    if (F && F.pivot && F.rot0) { F.open = 0; F.vel = 0; F.closeT = 0; F.pivot.quaternion.copy(F.rot0); }
    this.v = null; this.rig = null; this.on = false;
    for (const s of this.slots) { s.kind = -1; s.thr = 0; s.mesh.visible = false; s.glow.visible = false; }
    this.puffs.clear();
    this.group.visible = false;
    if (this.hud) this.hud.classList.remove('on');
    // (the touch buttons too: they stayed up over a car that does not fly)
    if (this.flyBtn) this.flyBtn.classList.remove('on');
    if (this.downBtn) this.downBtn.classList.remove('on', 'down');
    if (this.hudState) this.hudState.downOn = null;
    this.shiftMode = 0; this.keyDown = false; this.descK = 0; this.downWas = false;
    this.quiet();
  }

  // where the nozzles are, from the car's size (the car's frame: forward -z, right +x, up +y, origin on the ground)
  layout(rig) {
    const dm = rig.dims || {}, L = dm.length || 4.5, W = dm.width || 1.9;
    const front = dm.front ?? L / 2, rear = dm.rear ?? L / 2;
    const wf = rig.wheels && rig.wheels[0], wr = rig.wheels && rig.wheels[2];
    // in the overhangs, clear of the wheels
    let fz = -front + 0.4, rz = rear - 0.4;
    if (wf) fz = Math.min(fz, wf.pos.z - wf.radius - 0.14);
    if (wr) rz = Math.max(rz, wr.pos.z + wr.radius + 0.14);
    fz = Math.max(fz, -front + 0.22); rz = Math.min(rz, rear - 0.22);
    const x = W / 2 - 0.3, y = 0.21;
    const S = this.slots;
    let k = 0;
    for (const [sx, sz] of [[-1, fz], [1, fz], [-1, rz], [1, rz]]) {
      const s = S[k++];
      s.kind = 0; s.pos.set(sx * x, y, sz); s.dir.set(sx * 0.1, -1, sz < 0 ? -0.06 : 0.06).normalize();
      s.r0 = 0.045; s.len = 1.7; s.spread = 0.3; s.side = sx; s.front = sz < 0;
    }
    const pl = rig._flight && rig._flight.plate;
    const m = S[k++];
    m.kind = 1; m.r0 = 0.05; m.len = 2.8; m.spread = 0.2; m.side = 0; m.front = false;
    if (pl) { m.pos.copy(pl.center).addScaledVector(pl.normal, 0.02); m.dir.copy(pl.normal); }
    else { m.pos.set(0, 0.44, rear + 0.02); m.dir.set(0, 0, 1); }
    // side nozzles at the corners, low on the body's flanks
    for (const [sx, sz] of [[-1, fz + 0.05], [1, fz + 0.05], [-1, rz - 0.05], [1, rz - 0.05]]) {
      const s = S[k++];
      s.kind = 2; s.pos.set(sx * (W / 2 - 0.03), 0.5, sz); s.dir.set(sx, 0, 0);
      s.r0 = 0.025; s.len = 0.75; s.spread = 0.35; s.side = sx; s.front = sz < 0;
    }
    for (; k < S.length; k++) S[k].kind = -1;
  }

  // the number plate on a hinge at its bottom edge, the main nozzle behind it, the nozzle bells under the corners
  parts(rig) {
    if (rig._flight) { this.syncParts(rig); return; }
    const F = rig._flight = { plate: null, pivot: null, open: 0, vel: 0, group: new THREE.Group(), ready: false };
    F.group.name = 'flight_parts';
    const obj = rig.object;
    obj.updateMatrixWorld(true);
    const dm = rig.dims || {}, rear = dm.rear ?? (dm.length || 4.5) / 2;
    // the model's own plate, if it has one, is put on a hinge; else a plate of ours goes on the rear bumper
    const own = rig.model && (rig.model.getObjectByName('plate_rear') || rig.model.getObjectByName('plate_rear_L'));
    let center, normal, pw, ph;
    if (own) {
      const box = new THREE.Box3();
      own.updateMatrixWorld(true);
      // the plate's box in the rig's frame
      const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
      own.traverse(o => { if (o.isMesh) { const g = o.geometry; if (!g.boundingBox) g.computeBoundingBox(); const b = g.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)); box.union(b); } });
      center = box.getCenter(new THREE.Vector3()); normal = new THREE.Vector3(0, 0, 1);
      pw = box.max.x - box.min.x; ph = box.max.y - box.min.y;
      center.z = box.min.z; // (its back: the opening and the nozzle are behind it)
    } else if (rig.spec && rig.spec.plate && Array.isArray(rig.spec.plate.pos)) {
      // the plate's recess as measured on the model (cars.js spec.plate, car frame); the tail's slope there from a ray
      const sp = rig.spec.plate;
      center = new THREE.Vector3().fromArray(sp.pos);
      const hit = rearFace(rig, center.y);
      normal = hit && Math.abs(hit.point.z - center.z) < 0.15 ? hit.normal : new THREE.Vector3(0, 0, 1);
      pw = (sp.size && sp.size[0]) || 0.305; ph = (sp.size && sp.size[1]) || 0.152;
    } else {
      const hit = rearFace(rig, 0.44) || rearFace(rig, 0.5) || rearFace(rig, 0.38);
      center = hit ? hit.point : new THREE.Vector3(0, 0.44, rear);
      normal = hit ? hit.normal : new THREE.Vector3(0, 0, 1);
      const us = !!this.d.mph;
      pw = us ? 0.305 : 0.52; ph = us ? 0.152 : 0.11;
    }
    // the plate's frame: z out of the car, y up along the bumper, x across
    normal.x = 0; if (normal.lengthSq() < 1e-4) normal.set(0, 0, 1); normal.normalize();
    if (normal.z < 0.3) { normal.set(0, normal.y, Math.max(0.3, normal.z)).normalize(); }
    const upP = new THREE.Vector3(0, normal.z, -normal.y);
    const metal = new THREE.MeshStandardMaterial({ name: 'flight_metal', color: 0x55585e, metalness: 0.85, roughness: 0.34 });
    const dark = new THREE.MeshStandardMaterial({ name: 'flight_recess', color: 0x0c0d0f, metalness: 0.4, roughness: 0.7 });
    F.mats = [metal, dark];
    const pivot = new THREE.Group(); pivot.name = 'plate_hinge';
    pivot.position.copy(center).addScaledVector(upP, -ph / 2).addScaledVector(normal, 0.012);
    pivot.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), upP, normal));
    if (own) {
      // keep the model's plate where it is, now hanging from the hinge
      obj.add(pivot); pivot.updateMatrixWorld(true);
      pivot.attach(own);
    } else {
      const tex = plateTexture(pw / ph < 3); // (a US plate's shape or a European one's)
      const pm = new THREE.MeshStandardMaterial({ name: 'flight_plate', map: tex, metalness: 0.2, roughness: 0.42 });
      F.mats.push(pm);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), pm);
      face.position.set(0, ph / 2, 0.005);
      const back = new THREE.Mesh(new THREE.BoxGeometry(pw + 0.012, ph + 0.012, 0.008), metal);
      back.position.set(0, ph / 2, 0.0);
      pivot.add(back, face);
      F.group.add(pivot);
    }
    F.pivot = pivot;
    F.plate = { center: center.clone(), normal: normal.clone(), w: pw, h: ph };
    // the opening behind the plate and the main nozzle's bell in it
    const recess = new THREE.Mesh(new THREE.PlaneGeometry(pw * 0.92, ph * 0.86), dark);
    recess.position.copy(center).addScaledVector(normal, 0.003);
    recess.quaternion.copy(pivot.quaternion);
    F.group.add(recess);
    // bells: the main one and the four lift ones, one mesh
    const bells = [];
    const addBell = (pos, dir, r, len) => {
      const g = bellGeometry(r, len);
      _q.setFromUnitVectors(_Y, dir);
      g.applyQuaternion(_q); g.translate(pos.x, pos.y, pos.z);
      bells.push(g);
    };
    const R = Math.min(pw, ph) * 0.36;
    addBell(_a.copy(center).addScaledVector(normal, 0.006 - R * 1.4), normal, R, R * 1.4);
    for (const s of this.slots) if (s.kind === 0) addBell(_b.copy(s.pos).addScaledVector(s.dir, -0.06), s.dir, 0.05, 0.08);
    else if (s.kind === 2) addBell(_b.copy(s.pos).addScaledVector(s.dir, -0.03), s.dir, 0.022, 0.03);
    const merged = mergeGeos(bells);
    // (their own copy of the metal: frost forms on them as the cold gas runs, see frame)
    const bell = metal.clone(); bell.name = 'flight_bell'; F.mats.push(bell); F.bell = bell; F.frost = 0;
    const bm = new THREE.Mesh(merged, bell); bm.name = 'flight_nozzles';
    F.group.add(bm);
    F.group.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; o.userData.noDamage = true; } });
    if (this.d.carEnv) for (const m of F.mats) m.envMap = this.d.carEnv;
    // hidden until their shaders are built (a draw that meets a new shader holds the page while it compiles)
    F.group.visible = false;
    if (pivot.parent === obj) pivot.visible = true;
    obj.add(F.group);
    const show = () => { F.ready = true; F.group.visible = true; };
    if (this.d.compileScene) this.d.compileScene(F.group, this.d.scene, 6000).then(show, show); else show();
    this.syncParts(rig);
  }

  syncParts(rig) {
    // the main nozzle sits at the plate
    const F = rig._flight, m = this.slots[4];
    if (F && F.plate && m.kind === 1) { m.pos.copy(F.plate.center).addScaledVector(F.plate.normal, 0.025); m.dir.copy(F.plate.normal); }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // each frame, ahead of the physics steps: the keys, the ground under the car, the traffic it may meet

  before(dt, inp, env) {
    try {
      const d = this.d;
      if (!this.driving()) { if (this.v) this.detach(); return; }
      if (d.car.vehicle !== this.v) this.attach(d.car);
      if (!this.on) return;
      const k = d.keys, pad = navigator.getGamepads ? [...navigator.getGamepads()].find(p => p && p.connected) : null;
      const pb = i => pad && pad.buttons[i] ? pad.buttons[i].value > 0.5 : false;
      const live = !d.auto && !this.landing;
      this.keyThrust = live && !!((k && k.has('Space')) || pb(0));
      // Shift: what it means is fixed when it goes down. Pressed while flying it is "down"; pressed on the ground it
      // is the boost (with W the rear jet, and the climb's boost if the car then takes off), as it always was. So a
      // Shift held through a landing never fires the rear jet, and one held through a take-off never stops the climb.
      const shiftK = !!(k && (k.has('ShiftLeft') || k.has('ShiftRight')));
      if (!shiftK) this.shiftMode = 0;
      else if (!this.shiftMode) this.shiftMode = this.s.flying ? 1 : 2;
      this.keyDown = live && ((shiftK && this.shiftMode === 1) || pb(1));
      // F (pad RB) is the boost everywhere; a ground Shift still is
      this.keyBoost = live && !!((k && k.has('KeyF')) || pb(5) || (shiftK && this.shiftMode === 2));
      this.inThr = inp.throttle || 0; this.inBrk = inp.brake || 0; this.inSteer = inp.steer || 0;
      if (this.landing) this.inThr = this.inBrk = this.inSteer = 0;
      // Space is the thrusters on this car, never the handbrake
      if (!d.auto) inp.handbrake = 0;
      const v = this.v, o = v.origin(_a);
      // a jump (respawn, a new drop): the thrusters off, the puffs gone
      const jump = 3 + v.speed * Math.min(dt, 0.1) * 3;
      if (this.lastO && o.distanceToSquared(this.lastO) > jump * jump) { this.s.flying = false; this.s.lift = 0; this.s.main = 0; this.s.stun = 0; this.puffs.clear(); }
      (this.lastO || (this.lastO = new THREE.Vector3())).copy(o);
      // the ground under the car (a roof, a road, the land) and how high the car's floor is over it
      // (with the car's height as a hint the roof or the bridge deck under it; a hint far over every road and over
      // the reach of the photographed mesh finds nothing, so then the column without one)
      let g = null;
      try { g = d.ground(o.x, o.z, o.y + 0.3); if (g === null || g === undefined || !Number.isFinite(g)) g = d.ground(o.x, o.z); } catch (e) {}
      if (g === null || g === undefined || !Number.isFinite(g) || g > o.y + 2) { this.h = 99; this.gY = o.y - 99; }
      else { this.gY = g; this.h = o.y - g; }
      // traffic far below a flying car is not in its way
      if (env && env.others && this.h > 1.4) {
        const bottom = o.y;
        env.others = env.others.filter(c => !(c.obj && Number.isFinite(c.obj.y) && bottom > c.obj.y + 1.7));
      }
    } catch (e) { this.warn(e); }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // inside each physics step (vehicle.js): the thrust, the assist, the gas

  ext(v, F, T, dt, grounded, up, fwd, right) {
    const s = this.s, m = v.p.mass, W = m * G;
    const air = 1 - grounded / 4;
    // a hard knock in the air (the last step's hits) upsets the assist for a moment
    if (s.flying && grounded < 2) for (const h of v.hits) if (h.speed > 6) { s.stun = Math.max(s.stun, Math.min(1.6, h.speed / 9)); s.knock = Math.min(1, s.knock + h.speed / 15); }
    s.stun = Math.max(0, s.stun - dt);
    const gas = s.tank > 0;
    // flying starts with Space and ends once the car stands on its wheels again with Space let go
    if (this.keyThrust && gas) { if (!s.flying) s.started = true; s.flying = true; s.sinkT = 0; s.landT = 0; }
    else if (s.flying) {
      s.sinkT += dt;
      if (grounded >= 3) { s.landT += dt; if (s.landT > 0.3) s.flying = false; } else s.landT = 0;
    }
    if (!gas) s.flying = s.flying && grounded < 3;
    const boost = this.keyBoost;
    // lift: a vertical speed held by the jets, up with Space, a hover then a slow sink without
    let L = 0;
    if (s.flying && gas) {
      // (flying along with W or S held it sinks more slowly, so a cruise needs only a tap of Space now and then)
      const sink = this.inThr > 0.1 || this.inBrk > 0.1 ? SINK * 0.45 : SINK;
      let vzT = this.keyThrust ? (boost ? CLIMB_BOOST : CLIMB) : -Math.min(sink, Math.max(0, s.sinkT - HOLD) * SINKA);
      // Shift: down under control (with Space too: hold the height); let go, it holds a moment as after Space
      const down = this.keyDown && !this.landing;
      if (down) { vzT = this.keyThrust ? 0 : -(boost ? DESCEND_BOOST : DESCEND); s.sinkT = 0; }
      if (this.landing) vzT = -4; // (the driver getting out: straight down, slowing near the ground)
      if (this.hold && !this.keyThrust && !down) vzT = 0; // tests: hold the height
      // slower near the ground, so it lands softly (a firmer approach when it is asked to come down)
      if (vzT < 0) vzT = Math.max(vzT, down ? -(SETTLE0 + Math.max(0, this.h) * SETTLE) : -(0.45 + Math.max(0, this.h) * 0.35));
      const a = clamp((vzT - v.v.y) * 2.6, -7, 9);
      L = m * (G + a) / Math.max(0.4, up.y);
      L = clamp(L, 0, W * (boost ? LIFT_BOOST : LIFT_MAX));
      if (up.y < 0.35) L *= Math.max(0, (up.y - 0.05) / 0.3);
      if (s.stun > 0) L *= 0.55;
    }
    s.lift += (L - s.lift) * Math.min(1, dt * (L > s.lift ? 12 : 7));
    if (s.lift > 1) F.addScaledVector(up, s.lift);
    // the main jet: W in the air, Shift (pressed on the ground) or F with W on the ground
    let Mn = 0;
    if (gas) {
      const airborne = s.flying && grounded < 3;
      if (airborne && this.inThr > 0.1) Mn = (boost ? MAIN_BOOST : MAIN) * this.inThr;
      else if (!airborne && boost && this.inThr > 0.5 && v.fwdSpeed > -0.5 && v.fwdSpeed < 75) Mn = MAIN_GROUND;
    }
    s.main += (Mn * W - s.main) * Math.min(1, dt * 10);
    if (s.main > 1) F.addScaledVector(fwd, s.main);
    s.ax = s.ay = s.az = 0;
    if (s.flying && gas && air > 0) {
      // air drag, and the side nozzles keeping the car going the way it points
      const sp = v.v.length();
      F.addScaledVector(v.v, -m * DRAG * sp * air);
      _h.set(fwd.x, 0, fwd.z);
      if (_h.lengthSq() > 1e-4) { _h.normalize(); _s.set(-_h.z, 0, _h.x); F.addScaledVector(_s, -m * v.v.dot(_s) * SLIDE * air); }
      // no keys: the jets slowly take out what drift is left, so a hover stays where it is
      if (this.inThr < 0.1 && this.inBrk < 0.1 && Math.abs(this.inSteer) < 0.1) F.add(_a.set(v.v.x, 0, v.v.z).multiplyScalar(-m * 0.4 * air));
      // the assist: the car's up towards the wanted one (level, the nose tipped by W and S, banked into a turn),
      // the turn rate towards the wanted one
      const k = air * (s.stun > 0 ? 0.15 : 1);
      const pT = (this.inThr > 0.1 ? -0.16 * this.inThr : 0) + (this.inBrk > 0.1 ? 0.19 * this.inBrk : 0);
      const vh = Math.hypot(v.v.x, v.v.z);
      const rT = this.inSteer * 0.28, yT = this.inSteer * 1.15 / (1 + vh / 22);
      if (_h.lengthSq() < 1e-4) _h.set(0, 0, -1);
      _w.set(-_h.z, 0, _h.x); // the heading's right
      _d.copy(_Y).addScaledVector(_h, -Math.tan(pT)).addScaledVector(_w, -Math.tan(rT)).normalize(); // wanted up
      _c.crossVectors(up, _d);
      const sn = _c.length(), cs = up.dot(_d);
      if (sn < 1e-4) { if (cs < 0) _c.copy(fwd); else _c.set(0, 0, 0); }
      else _c.multiplyScalar(Math.atan2(sn, cs) / sn);
      _q.copy(v.q).invert();
      _c.applyQuaternion(_q);                         // the error in the body's frame
      _t.copy(v.w).applyQuaternion(_q);               // the turn rate in the body's frame
      const ax = clamp(KP * _c.x - KD * _t.x, -AMAX, AMAX), az = clamp(KP * _c.z - KD * _t.z, -AMAX, AMAX);
      const ay = clamp(KYAW * (yT - _t.y), -AMAX, AMAX);
      s.ax = ax; s.ay = ay; s.az = az;
      _t.set(v.Ib.x * ax, v.Ib.y * ay, v.Ib.z * az).multiplyScalar(k).applyQuaternion(v.q);
      T.add(_t);
    }
    // the gas
    const used = (s.lift / W) * USE + (s.main / W) * USE_MAIN;
    if (used > 0.0005) { s.tank = Math.max(0, s.tank - used * dt); s.refillWait = 0; }
    else if (grounded >= 3 && !s.flying) { s.refillWait += dt; if (s.refillWait > 1) s.tank = Math.min(1, s.tank + REFILL * dt); }
    s.airborne = s.flying && grounded < 3;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // each frame, after the camera: the jets, the puffs, the plate, the shake, the HUD, the sound

  frame(dt) {
    try { this._frame(dt); } catch (e) { this.warn(e); }
  }

  _frame(dt) {
    if (!this.on || !this.v || !this.driving()) { if (this.group.visible || this.puffs.n) { this.group.visible = false; this.puffs.clear(); } this.quiet(); return; }
    dt = Math.min(dt, 0.1);
    this.time += dt;
    const v = this.v, rig = this.rig, s = this.s, W = v.p.mass * G, d = this.d, cam = d.camera;
    const M = rig.object.matrixWorld;
    const liftK = Math.min(1.5, s.lift / (W * 1.05));
    const mainK = Math.min(1.4, s.main / (W * 0.55));
    // (for mp.js: the other pages draw this car's jets from these)
    this.jets.lift = liftK; this.jets.main = mainK;
    const sputter = s.tank < 0.04 && (liftK > 0.05 || mainK > 0.05) ? 0.55 + 0.45 * Math.sin(this.time * 47) * Math.sin(this.time * 23) : 1;
    // messages
    if (s.started) {
      s.started = false; this.ignite = 1;
      if (this.h < 2.5) { this.ringT = 0; this.ringK = 1 - this.h / 2.5; }
      if (!this.flownOnce) { this.flownOnce = true; this.airHintT = 9; }
      // the valves opening: a burst of vapour out of every lift nozzle at once
      for (const sl of this.slots) if (sl.kind === 0) {
        sl.wp.copy(sl.pos).applyMatrix4(M); sl.wd.copy(sl.dir).transformDirection(M);
        for (let i = 0; i < 9; i++) {
          const sp = rnd(3, 9), a = Math.random() * 6.283;
          this.puffs.spawn(sl.wp.x + sl.wd.x * 0.2, Math.max(sl.wp.y + sl.wd.y * 0.2, this.gY + 0.15), sl.wp.z + sl.wd.z * 0.2,
            sl.wd.x * sp + Math.cos(a) * sp * 0.6, sl.wd.y * sp * 0.5 + rnd(0, 1), sl.wd.z * sp + Math.sin(a) * sp * 0.6, rnd(0.8, 1.6), 0.25, rnd(1.6, 2.6), 0.55, 0, 2.6, -0.2);
        }
      }
    }
    if (s.tank < 0.15 && !s.warnedLow && s.flying) { s.warnedLow = true; d.hud.flash('Thruster gas low'); }
    if (s.tank <= 0 && !s.warnedOut) { s.warnedOut = true; d.hud.flash('Out of gas: the tanks refill on the ground'); }
    if (s.tank > 0.3) { s.warnedLow = false; s.warnedOut = false; }
    this.ignite = Math.max(0, this.ignite - dt * 1.6);
    // coming down with Shift: the lift valves throttled back (shorter, thinner, pulsing plumes and a lower hiss),
    // until the flare near the ground opens them again; a soft chuff of venting gas as Shift goes down
    const descW = this.keyDown && s.airborne && v.v.y < -0.8 && s.lift < W * 1.04 ? 1 : 0; // (braking near the ground: the flare)
    this.descK += (descW - this.descK) * (1 - Math.exp(-dt * (descW > this.descK ? 6 : 3)));
    const downNow = !!(this.keyDown && s.airborne);
    if (downNow && !this.downWas) this.vent = 1;
    this.downWas = downNow;
    // a hard landing (vehicle.js floorGuard records it): the thump, and dust thrown out from under the car
    if (v.groundHit && v.groundHit.t !== this.slamSeen) { this.slamSeen = v.groundHit.t; s.slam = v.groundHit.speed; }
    if (s.slam > 3) {
      const sp = s.slam; s.slam = 0;
      s.knock = Math.min(1, s.knock + sp / 14);
      try { if (sp > 4) d.hud.bump(sp); if (d.sound && d.sound.hit) d.sound.hit(sp); } catch (e) {}
      // dust thrown out from under the car
      const gh = v.groundHit;
      if (gh) for (let i = 0; i < Math.min(40, sp * 3); i++) {
        const a = Math.random() * 6.283, r = rnd(4, 9) * Math.min(1.5, sp / 10);
        this.puffs.spawn(gh.x + Math.cos(a) * 0.8, gh.y + 0.15, gh.z + Math.sin(a) * 0.8, Math.cos(a) * r, rnd(0.5, 2.5), Math.sin(a) * r, rnd(0.8, 1.6), 0.25, rnd(1.2, 2.4), 0.45, 1, 2.2, 1.5);
      }
    }
    s.knock = Math.max(0, s.knock - dt * 2);
    // fewer puffs when the frame rate is low (they are most of what the jets cost to draw)
    const fps = d.G && d.G.fps ? d.G.fps : 60;
    this.lod += ((fps < 32 ? 0.55 : fps < 40 ? 0.75 : 1) - this.lod) * Math.min(1, dt * 0.5);
    let ge = 0; // ground effect, for the shake and the sound
    let any = false;
    for (const sl of this.slots) {
      if (sl.kind < 0) { sl.mesh.visible = false; sl.glow.visible = false; continue; }
      // how hard this nozzle blows
      let want = 0;
      if (sl.kind === 0) want = liftK * (1 + clamp(0.05 * (sl.front ? s.ax : -s.ax) + 0.05 * sl.side * s.az, -0.35, 0.35))
        * (1 - this.descK * (0.3 - 0.12 * Math.sin(this.time * 29 + sl.side * 1.9 + (sl.front ? 0.8 : 0))));
      else if (sl.kind === 1) want = mainK;
      else { const yaw = s.ay; want = Math.abs(yaw) > 0.25 && ((yaw > 0) === (sl.front === (sl.side > 0))) ? Math.min(1, Math.abs(yaw) * 0.35) : 0; }
      want *= sputter;
      sl.thr += (want - sl.thr) * (1 - Math.exp(-dt * (want > sl.thr ? 22 : 9)));
      const thr = sl.thr;
      sl.wp.copy(sl.pos).applyMatrix4(M);
      sl.wd.copy(sl.dir).transformDirection(M);
      // the air rushing past bends the jets back (a jet leaves the nozzle at a few tens of metres a second)
      _c.copy(sl.wd).multiplyScalar(45).addScaledVector(v.v, -0.7);
      if (_c.lengthSq() > 1) sl.wd.copy(_c.normalize());
      if (thr < 0.02) { sl.mesh.visible = false; sl.glow.visible = false; continue; }
      any = true;
      // the jet's length: shorter where it meets the ground, where it spreads out sideways instead
      const down = -sl.wd.y;
      const toGround = down > 0.15 ? (sl.wp.y - this.gY) / down : 1e3;
      const full = sl.len * (0.45 + 0.55 * Math.min(1.2, thr));
      const len = Math.max(0.05, Math.min(full, toGround + 0.05));
      const r1 = sl.r0 + full * sl.spread * (0.7 + 0.3 * thr);
      const u = sl.mat.uniforms;
      u.uThr.value = Math.min(1.2, thr); u.uLen.value = len; u.uFull.value = full; u.uR0.value = sl.r0; u.uR1.value = sl.r0 + (r1 - sl.r0) * len / full;
      u.uTime.value = this.time % 400; u.uGround.value = this.gY; u.uDiamond.value = sl.kind === 1 ? 1 : 0;
      sl.mesh.position.copy(sl.wp);
      sl.mesh.quaternion.setFromUnitVectors(_Y, sl.wd);
      sl.mesh.visible = true;
      // the blue-white glow at the nozzle's mouth
      sl.glow.position.copy(sl.wp).addScaledVector(sl.wd, 0.04);
      sl.glow.scale.setScalar((sl.kind === 2 ? 0.12 : 0.22) + 0.18 * Math.min(1, thr));
      sl.glow.visible = true;
      // puffs breaking off the jet, carried along it and left behind by the car
      const vx = v.v.x, vy = v.v.y, vz = v.v.z;
      const jv = (sl.kind === 2 ? 5 : 11) * (0.6 + 0.4 * thr);
      sl.acc += dt * thr * (sl.kind === 1 ? 55 : sl.kind === 0 ? 26 : 22) * this.lod;
      while (sl.acc >= 1) {
        sl.acc -= 1;
        const f = rnd(0.25, 1) * len;
        const px = sl.wp.x + sl.wd.x * f + rnd(-0.06, 0.06), py = sl.wp.y + sl.wd.y * f + rnd(-0.06, 0.06), pz = sl.wp.z + sl.wd.z * f + rnd(-0.06, 0.06);
        const sv = jv * rnd(0.5, 1.1), j = jv * 0.18;
        this.puffs.spawn(px, Math.max(py, this.gY + 0.12), pz,
          vx * 0.55 + sl.wd.x * sv + rnd(-j, j), vy * 0.55 + sl.wd.y * sv + rnd(-j, j), vz * 0.55 + sl.wd.z * sv + rnd(-j, j),
          rnd(0.6, 1.25) * (sl.kind === 2 ? 0.6 : 1), (sl.kind === 2 ? 0.1 : 0.18) + r1 * 0.6, (sl.kind === 2 ? 0.8 : sl.kind === 1 ? 1.4 : 1.9) + thr * 0.9, (sl.kind === 1 ? 0.34 : 0.5) * Math.min(1, thr + 0.2), 0, 2.8, -0.25);
      }
      // the ground effect: where the jet meets the ground the gas runs out along it as a ring, raising dust and grit
      const reach = sl.len * 1.7;
      if (toGround < reach && down > 0.3) {
        const e = thr * (1 - toGround / reach);
        ge = Math.max(ge, e);
        const ix = sl.wp.x + sl.wd.x * toGround, iz = sl.wp.z + sl.wd.z * toGround, iy = this.gY;
        sl.gacc += dt * e * 42 * this.lod;
        while (sl.gacc >= 1) {
          sl.gacc -= 1;
          const ang = Math.random() * Math.PI * 2, c = Math.cos(ang), sn = Math.sin(ang), sp = rnd(5, 13) * (0.5 + 0.5 * e);
          const kind = Math.random();
          if (kind < 0.62) this.puffs.spawn(ix + c * 0.3, iy + rnd(0.15, 0.4), iz + sn * 0.3, c * sp + vx * 0.3, rnd(0.2, 1.2), sn * sp + vz * 0.3, rnd(1.3, 2.4), 0.35, rnd(2.0, 3.0), 0.52 * Math.min(1, e + 0.3), 0, 1.9, -0.15);
          else if (kind < 0.86) this.puffs.spawn(ix + c * 0.4, iy + 0.1, iz + sn * 0.4, c * sp * 0.8, rnd(1, 3.2), sn * sp * 0.8, rnd(0.8, 1.5), 0.12, rnd(0.7, 1.4), 0.5 * Math.min(1, e + 0.2), 1, 1.4, 4);
          else this.puffs.spawn(ix + c * 0.3, iy + 0.05, iz + sn * 0.3, c * sp * 1.2, rnd(2, 5), sn * sp * 1.2, rnd(0.5, 1), 0.025, 0.03, 1, 2, 0.4, 9.8);
        }
      } else sl.gacc = 0;
      // the main jet low over the ground blows dust back along it
      if (sl.kind === 1 && this.h < 1.2) {
        const e = thr * (1 - this.h / 1.2);
        ge = Math.max(ge, e * 0.6);
        sl.gacc += dt * e * 30;
        while (sl.gacc >= 1) {
          sl.gacc -= 1;
          const f = rnd(0.6, 2.2);
          this.puffs.spawn(sl.wp.x + sl.wd.x * f, this.gY + 0.2, sl.wp.z + sl.wd.z * f, sl.wd.x * rnd(6, 12) + vx * 0.4 + rnd(-2, 2), rnd(0.3, 1.5), sl.wd.z * rnd(6, 12) + vz * 0.4 + rnd(-2, 2), rnd(1, 2), 0.3, rnd(1.8, 3), 0.35, Math.random() < 0.7 ? 0 : 1, 1.8, 0.5);
        }
      }
    }
    this.puffs.update(dt, cam, this.gY, d.G && d.G.sky ? d.G.sky.dir : null);
    if (this.ringT >= 0) {
      this.ringT += dt;
      const t = this.ringT / 0.7;
      if (t >= 1) { this.ringT = -1; this.ring.visible = false; }
      else {
        _a.set(0, 0, 0).applyMatrix4(M);
        this.ring.position.set(_a.x, this.gY + 0.04, _a.z);
        this.ring.scale.setScalar(2 + 12 * (1 - (1 - t) * (1 - t)));
        this.ring.material.opacity = 0.55 * this.ringK * (1 - t) * Math.min(1, t * 8);
        this.ring.visible = true;
      }
    }
    this.group.visible = (any || this.puffs.n > 0 || this.ringT >= 0) && !this.noFx; // (noFx: tests, the cost of drawing them)
    // is the car in the sun or in a building's shadow (a ray towards the sun a few times a second)
    if (any || this.puffs.n) {
      if (((this.sunN = (this.sunN || 0) + 1) % 6) === 0 && d.G && d.G.sky && d.world && d.world.raycast) {
        let lit = 1;
        try { _a.set(0, 1.2, 0).applyMatrix4(M); const h = d.world.raycast(_a, d.G.sky.dir, 500); lit = h ? 0 : 1; } catch (e) {}
        this.sunWant = lit;
      }
      this.sunK += ((this.sunWant ?? 1) * 0.8 + 0.2 - this.sunK) * (1 - Math.exp(-dt * 4));
      this.puffs.mat.uniforms.uSunK.value = this.sunK;
    }
    if (any) for (const sl of this.slots) if (sl.mesh.visible) { const u = sl.mat.uniforms; if (d.G && d.G.sky) u.uSun.value.copy(d.G.sky.dir); u.uSunK.value = this.sunK; }
    // frost on the nozzles: it builds while the cold gas runs and melts away slowly
    const Fp = rig._flight;
    if (Fp && Fp.bell) {
      const use = liftK + mainK;
      Fp.frost = clamp(Fp.frost + (use > 0.05 ? dt * use * 0.07 : -dt * 0.025), 0, 1);
      if (Math.abs(Fp.frost - (Fp.frostShown ?? -1)) > 0.01) {
        Fp.frostShown = Fp.frost;
        Fp.bell.color.setHex(0x55585e).lerp(_FROST, Fp.frost * 0.85);
        Fp.bell.roughness = 0.34 + 0.5 * Fp.frost; Fp.bell.metalness = 0.85 - 0.7 * Fp.frost;
      }
    }
    // the plate flips down once a nozzle behind it is wanted, and back up a little after
    const F = rig._flight;
    if (F && F.pivot) {
      const want = (s.flying || s.main > 1 || this.slots[4].thr > 0.02) ? 1 : 0;
      if (want) F.closeT = 1.2; else F.closeT = Math.max(0, (F.closeT || 0) - dt);
      const target = (want || F.closeT > 0) ? 160 * Math.PI / 180 : 0;
      // the latch: a click as it starts to move either way
      if (target !== F.lastTarget) { if (F.lastTarget !== undefined) try { if (d.sound && d.sound.tick) d.sound.tick(target ? 700 : 520); } catch (e) {} F.lastTarget = target; }
      // a stiff spring with a little bounce
      const acc = (target - F.open) * 160 - F.vel * 16;
      F.vel += acc * dt; F.open += F.vel * dt;
      if (F.open < 0) { F.open = 0; F.vel = 0; }
      if (F.open > Math.PI) { F.open = Math.PI; F.vel = -F.vel * 0.3; }
      if (F.rot0 === undefined) F.rot0 = F.pivot.quaternion.clone();
      _q2.setFromAxisAngle(_a.set(1, 0, 0), F.open);
      F.pivot.quaternion.copy(F.rot0).multiply(_q2);
    }
    // the camera: a little further back in the air, a shake from the jets
    const airK = s.airborne ? 1 : 0;
    this.camK += (airK - this.camK) * (1 - Math.exp(-dt * 1.5));
    v.flyCam = this.camK;
    const amp = 0.004 * liftK + 0.01 * mainK + 0.025 * ge + 0.05 * this.ignite + 0.12 * s.knock;
    if (amp > 0.0005) {
      const t = this.time;
      const ox = (Math.sin(t * 61.0) * 0.6 + Math.sin(t * 37.3 + 1.3) * 0.4) * amp, oy = (Math.sin(t * 53.7 + 2.1) * 0.6 + Math.sin(t * 29.1) * 0.4) * amp;
      const k = d.cam && d.cam.inside && d.cam.inside() ? 0.5 : 1;
      cam.position.addScaledVector(_a.set(1, 0, 0).applyQuaternion(cam.quaternion), ox * k).addScaledVector(_b.set(0, 1, 0).applyQuaternion(cam.quaternion), oy * k);
    }
    this.updateHud(dt);
    this.sound(dt, liftK, mainK, ge);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // the HUD: how much gas is left, the height, a hint

  makeHud() {
    if (typeof document === 'undefined' || !this.d.hud || !this.d.hud.el) return;
    if (!document.getElementById('flight-css')) {
      const st = document.createElement('style'); st.id = 'flight-css';
      st.textContent = `
.fl-hud { position: absolute; right: 24px; bottom: 116px; width: 172px; color: #fff; font: 500 12px/1.25 Roboto, system-ui, sans-serif; text-shadow: 0 1px 3px rgba(0,0,0,.6); display: none; pointer-events: none; }
.fl-hud.on { display: block; }
.fl-top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
.fl-alt { font-variant-numeric: tabular-nums; opacity: .9; }
.fl-bar { height: 6px; border-radius: 3px; background: rgba(0,0,0,.42); overflow: hidden; box-shadow: 0 0 0 1px rgba(255,255,255,.12) inset; }
.fl-bar i { display: block; height: 100%; width: 100%; border-radius: 3px; background: linear-gradient(90deg, #7cc7ff, #eaf6ff); transform-origin: left; }
.fl-hud.firing .fl-bar i { box-shadow: 0 0 8px rgba(160,215,255,.9); }
.fl-hud.low .fl-bar i { background: linear-gradient(90deg, #ff7a59, #ffb199); }
.fl-hint { margin-top: 6px; opacity: .85; font-weight: 400; }
.fl-hint:empty { display: none; }
.fl-fly { display: none; }
.hud.touch .fl-hud { bottom: 236px; right: 96px; width: 164px; }
.hud.touch .fl-fly.on { display: block; position: absolute; right: 18px; bottom: 300px; width: 64px; height: 64px; border-radius: 50%; border: 0; background: rgba(32,33,36,.55); color: #fff; font: 500 14px Roboto, system-ui; pointer-events: auto; touch-action: none; user-select: none; -webkit-user-select: none; }
.hud.touch .fl-fly.on.down { background: rgba(26,115,232,.85); }
.hud.touch .fl-fly.fl-down.on { right: 92px; bottom: 304px; width: 56px; height: 56px; font-size: 13px; }`;
      document.head.appendChild(st);
    }
    const el = this.hud = document.createElement('div');
    el.className = 'fl-hud';
    el.innerHTML = '<div class="fl-top"><span>Thrusters</span><span class="fl-alt"></span></div><div class="fl-bar"><i></i></div><div class="fl-hint"></div>';
    this.d.hud.el.appendChild(el);
    this.hudBar = el.querySelector('.fl-bar i'); this.hudAlt = el.querySelector('.fl-alt'); this.hudHint = el.querySelector('.fl-hint');
    // touch screens: a button that holds Space
    const b = this.flyBtn = document.createElement('button');
    b.className = 'fl-fly'; b.textContent = 'Fly'; b.setAttribute('aria-label', 'Fly');
    const keys = this.d.keys;
    const on = e => { e.preventDefault(); if (keys) keys.add('Space'); b.classList.add('down'); };
    const off = e => { e.preventDefault(); if (keys) keys.delete('Space'); b.classList.remove('down'); };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
    this.d.hud.el.appendChild(b);
    // and one that holds Shift, shown while flying: down
    const db = this.downBtn = document.createElement('button');
    db.className = 'fl-fly fl-down'; db.textContent = 'Down'; db.setAttribute('aria-label', 'Fly down');
    const dOn = e => { e.preventDefault(); if (keys) keys.add('ShiftLeft'); db.classList.add('down'); };
    const dOff = e => { e.preventDefault(); if (keys) keys.delete('ShiftLeft'); db.classList.remove('down'); };
    db.addEventListener('pointerdown', dOn); db.addEventListener('pointerup', dOff); db.addEventListener('pointercancel', dOff); db.addEventListener('pointerleave', dOff);
    this.d.hud.el.appendChild(db);
    this.hudState = { w: -1, alt: '', hint: null, cls: '', downOn: null };
  }

  updateHud(dt) {
    if (!this.hud) return;
    const s = this.s, H = this.hudState;
    this.hud.classList.add('on');
    if (this.flyBtn) this.flyBtn.classList.add('on');
    const w = Math.round(s.tank * 200) / 2;
    if (w !== H.w) { H.w = w; this.hudBar.style.transform = `scaleX(${(w / 100).toFixed(3)})`; }
    const mph = this.d.mph, hh = Math.max(0, this.h);
    const alt = s.airborne || hh > 1.5 ? (hh > 90 ? '' : (mph ? Math.round(hh * 3.281) + ' ft' : Math.round(hh) + ' m')) : Math.round(s.tank * 100) + '%';
    if (alt !== H.alt) { H.alt = alt; this.hudAlt.textContent = alt; }
    const cls = (s.tank < 0.15 ? 'low ' : '') + (s.lift > 1 || s.main > 1 ? 'firing' : '');
    if (cls !== H.cls) { H.cls = cls; this.hud.classList.toggle('low', s.tank < 0.15); this.hud.classList.toggle('firing', s.lift > 1 || s.main > 1); }
    this.hintT = Math.max(0, (this.hintT || 0) - dt); this.airHintT = Math.max(0, (this.airHintT || 0) - dt);
    const hint = this.airHintT > 0 ? 'Space\u00a0up, Shift\u00a0down, W\u00a0S\u00a0tip, A\u00a0D\u00a0turn, F\u00a0boost' : (!s.flying && this.hintT > 0 && !this.flownOnce ? 'Hold Space to fly' : (s.tank <= 0 ? 'Refills on the ground' : ''));
    if (hint !== H.hint) { H.hint = hint; this.hudHint.textContent = hint; }
    // touch screens: the Down button only while flying (on the ground it would be the rear jet's Shift)
    if (this.downBtn) { const on = !!s.flying; if (on !== H.downOn) { H.downOn = on; this.downBtn.classList.toggle('on', on); if (!on) this.downBtn.classList.remove('down'); } }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // the sound: a rushing hiss from the nozzles over a low roar, louder near the ground, a bang as the valves open

  sound(dt, lift, main, ge) {
    const S = this.d.sound, ctx = S && S.ctx;
    if (!ctx || !S.master || !S.on) { this.snd = null; return; }
    if (!this.snd || this.snd.ctx !== ctx) this.snd = makeSound(ctx, S.master);
    const n = this.snd, t = ctx.currentTime;
    const p = Math.min(1.4, lift + main * 1.1);
    // (coming down: the valves throttled back, a lower, softer hiss and less roar)
    const dk = this.descK || 0;
    n.hiss.gain.setTargetAtTime(0.13 * p * (1 - 0.3 * dk), t, 0.04);
    n.hissF.frequency.setTargetAtTime((3200 + 1800 * Math.min(1, p)) * (1 - 0.32 * dk), t, 0.08);
    n.roar.gain.setTargetAtTime(0.3 * Math.min(1.3, lift * 0.7 + main) * (1 - 0.4 * dk), t, 0.06);
    n.roarF.frequency.setTargetAtTime((180 + 320 * Math.min(1.2, p)) * (1 - 0.2 * dk), t, 0.1);
    if (this.vent) { this.vent = 0; try { vent(ctx, S.master, n.noise); } catch (e) {} }
    n.ground.gain.setTargetAtTime(0.28 * ge, t, 0.08);
    if (this.ignite > 0.98 && !this.igniteSounded) { this.igniteSounded = true; bang(ctx, S.master, n.noise); }
    if (this.ignite < 0.5) this.igniteSounded = false;
  }

  quiet() {
    if (!this.snd) return;
    const n = this.snd, t = n.ctx.currentTime;
    try { n.hiss.gain.setTargetAtTime(0, t, 0.05); n.roar.gain.setTargetAtTime(0, t, 0.05); n.ground.gain.setTargetAtTime(0, t, 0.05); } catch (e) {}
  }

  // for tests: the state in one object
  status() {
    const s = this.s, v = this.v;
    return { on: this.on, flying: s.flying, airborne: s.airborne, tank: +s.tank.toFixed(3), lift: v ? +(s.lift / (v.p.mass * G)).toFixed(3) : 0, main: v ? +(s.main / (v.p.mass * G)).toFixed(3) : 0, h: +this.h.toFixed(2), vy: v ? +v.v.y.toFixed(2) : 0, puffs: this.puffs.n, stun: +s.stun.toFixed(2), plate: this.rig && this.rig._flight ? +this.rig._flight.open.toFixed(2) : null, down: !!this.keyDown, boost: !!this.keyBoost, shift: this.shiftMode, desc: +this.descK.toFixed(2) };
  }
}

function freshState() {
  return { flying: false, airborne: false, slam: 0, lift: 0, main: 0, tank: 1, sinkT: 0, landT: 0, refillWait: 0, stun: 0, knock: 0, ax: 0, ay: 0, az: 0, started: false, warnedLow: false, warnedOut: false };
}

// ---------------------------------------------------------------------------------------------------------------
// the rear face of the car at a height: a ray from behind against the body (in the rig's own frame)

function rearFace(rig, y) {
  const obj = rig.object, dm = rig.dims || {};
  const rear = dm.rear ?? (dm.length || 4.5) / 2;
  const meshes = [];
  // only the car's own model (people sitting in it, effects and the like are other modules' children)
  (rig.model || obj).traverse(o => {
    if (!o.isMesh || !o.visible || o.isSkinnedMesh || o.isInstancedMesh || (o.geometry && o.geometry.isInstancedBufferGeometry)) return;
    const n = o.name || '', mn = o.material && !Array.isArray(o.material) ? (o.material.name || '') : '';
    if (/shadow|contact|^lamp_|flight/.test(n) || mn === 'glass' || mn === 'shadow_proxy') return;
    meshes.push(o);
  });
  obj.updateMatrixWorld(true);
  const ro = obj.localToWorld(new THREE.Vector3(0, y, rear + 2));
  const rd = new THREE.Vector3(0, 0, -1).transformDirection(obj.matrixWorld);
  const rc = new THREE.Raycaster(ro, rd, 0, 4);
  const hits = rc.intersectObjects(meshes, false);
  if (!hits.length) return null;
  const h = hits[0];
  const point = obj.worldToLocal(h.point.clone());
  let normal = new THREE.Vector3(0, 0, 1);
  if (h.face) { normal.copy(h.face.normal).transformDirection(h.object.matrixWorld); _q.copy(obj.quaternion); obj.getWorldQuaternion(_q); normal.applyQuaternion(_q.invert()); }
  if (normal.z < 0) normal.negate();
  return { point, normal };
}

// ---------------------------------------------------------------------------------------------------------------
// geometry and textures

// a cone of unit size along +y, 0 at the nozzle, 1 at the end; the shader gives it its radius and length
function coneGeometry() {
  const g = new THREE.CylinderGeometry(1, 1, 1, 28, 20, true);
  g.translate(0, 0.5, 0);
  return g;
}

// a nozzle's bell along +y, its mouth at the top: a lathe of the outer wall, the lip and the inner wall
function bellGeometry(r, len) {
  const P = [
    new THREE.Vector2(r * 0.45, 0), new THREE.Vector2(r * 0.55, len * 0.35), new THREE.Vector2(r * 0.8, len * 0.75),
    new THREE.Vector2(r * 1.0, len), new THREE.Vector2(r * 0.86, len * 0.98), new THREE.Vector2(r * 0.62, len * 0.6),
    new THREE.Vector2(r * 0.35, len * 0.25), new THREE.Vector2(0.001, len * 0.18),
  ];
  const g = new THREE.LatheGeometry(P, 20);
  g.deleteAttribute('uv');
  return g;
}

function mergeGeos(list) {
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), idx = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const g of list) {
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position.array, ov * 3); nor.set(g.attributes.normal.array, ov * 3);
    const n = g.attributes.position.count;
    if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i++) idx[oi + i] = a[i] + ov; oi += a.length; }
    else { for (let i = 0; i < n; i++) idx[oi + i] = ov + i; oi += n; }
    ov += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

let _glow = null;
function glowTexture() {
  if (_glow) return _glow;
  const n = 64, data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = (x + 0.5) / n * 2 - 1, w = (y + 0.5) / n * 2 - 1, r = Math.sqrt(u * u + w * w);
    const a = Math.max(0, 1 - r) ** 2.2;
    const k = (y * n + x) * 4; data[k] = data[k + 1] = data[k + 2] = 255; data[k + 3] = Math.round(255 * a);
  }
  _glow = new THREE.DataTexture(data, n, n); _glow.magFilter = THREE.LinearFilter; _glow.minFilter = THREE.LinearMipmapLinearFilter; _glow.generateMipmaps = true; _glow.needsUpdate = true;
  return _glow;
}

// a soft ring of dust, thick at its leading edge and thinning behind it
let _ring = null;
function ringTexture() {
  if (_ring) return _ring;
  const n = 128, data = new Uint8Array(n * n * 4);
  let seed = 7; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const lump = new Float32Array(64); for (let i = 0; i < 64; i++) lump[i] = 0.6 + 0.4 * rand();
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = (x + 0.5) / n * 2 - 1, w = (y + 0.5) / n * 2 - 1, r = Math.sqrt(u * u + w * w);
    const ang = (Math.atan2(w, u) / (Math.PI * 2) + 0.5) * 64, i0 = Math.floor(ang) % 64, f = ang - Math.floor(ang);
    const lk = lump[i0] * (1 - f) + lump[(i0 + 1) % 64] * f;
    const front = Math.exp(-(((r - 0.86) / 0.07) ** 2)), wake = r < 0.86 ? Math.max(0, (r - 0.35) / 0.51) ** 2 * 0.45 : 0;
    const a = Math.min(1, (front + wake) * lk) * (r < 1 ? 1 : 0);
    const k = (y * n + x) * 4; data[k] = data[k + 1] = data[k + 2] = 255; data[k + 3] = Math.round(255 * a);
  }
  _ring = new THREE.DataTexture(data, n, n); _ring.magFilter = THREE.LinearFilter; _ring.minFilter = THREE.LinearMipmapLinearFilter; _ring.generateMipmaps = true; _ring.needsUpdate = true;
  return _ring;
}

function plateTexture(us) {
  const c = document.createElement('canvas'); c.width = us ? 256 : 416; c.height = us ? 128 : 88;
  const g = c.getContext('2d');
  g.fillStyle = us ? '#f4f4ef' : '#f2f2ec'; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#2b2b2b'; g.lineWidth = 4; g.strokeRect(5, 5, c.width - 10, c.height - 10);
  if (!us) { g.fillStyle = '#1d4fa8'; g.fillRect(7, 7, 30, c.height - 14); }
  g.fillStyle = '#1b1b1b'; g.font = `700 ${us ? 64 : 60}px "Arial Narrow", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('FLY 001', c.width / 2 + (us ? 0 : 14), c.height / 2 + 3);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// ---------------------------------------------------------------------------------------------------------------
// the jet: a cone drawn as a soft volume (denser where the line of sight crosses more of it), white condensed vapour
// with a blue-white core at the nozzle, turbulence that streams along it, faint shock diamonds in the main jet, and
// fading where it meets the ground

// value noise on a permutation polynomial kept under 289, so it stays clean however far the coordinates run
const NOISE = /* glsl */`
vec4 fperm(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float fn3(vec3 p) {
  vec3 a = floor(p); vec3 d = p - a; d = d * d * (3.0 - 2.0 * d);
  a = mod(a, 289.0);
  vec4 b = a.xxyy + vec4(0.0, 1.0, 0.0, 1.0);
  vec4 k1 = fperm(b.xyxy); vec4 k2 = fperm(k1.xyxy + b.zzww);
  vec4 c = k2 + a.zzzz; vec4 k3 = fperm(c); vec4 k4 = fperm(c + 1.0);
  vec4 o1 = fract(k3 * (1.0 / 41.0)); vec4 o2 = fract(k4 * (1.0 / 41.0));
  vec4 o3 = o2 * d.z + o1 * (1.0 - d.z); vec2 o4 = o3.yw * d.x + o3.xz * (1.0 - d.x);
  return o4.y * d.y + o4.x * (1.0 - d.y);
}
float ffbm(vec3 p) { return fn3(p) * 0.55 + fn3(p * 2.13 + 3.1) * 0.3 + fn3(p * 4.7 + 7.7) * 0.15; }`;

function coneMaterial() {
  return new THREE.ShaderMaterial({
    name: 'flight_jet', transparent: true, depthWrite: false, side: THREE.FrontSide, fog: false,
    uniforms: {
      uThr: { value: 0 }, uLen: { value: 1 }, uFull: { value: 1 }, uR0: { value: 0.04 }, uR1: { value: 0.3 }, uTime: { value: 0 },
      uGround: { value: -1e4 }, uDiamond: { value: 0 }, uSun: { value: new THREE.Vector3(0.5, 0.7, -0.5) }, uSunK: { value: 1 },
    },
    vertexShader: /* glsl */`
      uniform float uLen, uFull, uR0, uR1, uTime;
      varying vec3 vP; varying float vU; varying vec3 vN; varying vec3 vV; varying float vWY; varying vec3 vWN; varying float vR;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        float u = position.y;
        float r = mix(uR0, uR1, pow(u, 0.7));
        vec2 dir = normalize(position.xz);
        float ang = atan(dir.y, dir.x);
        // eddies passing down the jet swell and pinch its outline, more so further out
        float z = u * uLen;
        float bil = 1.0 + min(1.0, z * 0.9) * (0.22 * sin(z * 9.0 - uTime * 23.0 + ang * 2.0) + 0.14 * sin(z * 4.1 - uTime * 14.0 - ang * 3.0));
        r *= bil;
        vec3 p = vec3(dir.x * r, z, dir.y * r);
        // the jet wanders a little more the further it goes
        float wob = u * u * uLen * 0.045;
        p.x += sin(u * 8.0 - uTime * 17.0) * wob; p.z += cos(u * 6.0 - uTime * 13.0) * wob;
        vP = p; vR = r; vU = z / max(uFull, 0.01);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float sl = (uR1 - uR0) / max(uLen, 0.01);
        vN = normalize(normalMatrix * vec3(dir.x, -sl, dir.y));
        vWN = normalize(mat3(modelMatrix) * vec3(dir.x, -sl, dir.y));
        vV = -mv.xyz;
        vWY = (modelMatrix * vec4(p, 1.0)).y;
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float uThr, uTime, uGround, uDiamond, uLen, uR0, uSunK;
      uniform vec3 uSun;
      varying vec3 vP; varying float vU; varying vec3 vN; varying vec3 vV; varying float vWY; varying vec3 vWN; varying float vR;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      ${NOISE}
      void main() {
        #include <logdepthbuf_fragment>
        // how far the line of sight runs through the jet here: most across its middle, nothing at its edge
        float f = abs(dot(normalize(vN), normalize(vV)));
        float u = vU;
        float R = max(vR, 0.01);
        // turbulence carried down the jet, its eddies as big as the jet is wide
        float Rn = max(R, 0.09);
        vec3 np = vec3(vP.x / Rn * 1.7, vP.y / (Rn * 1.3) - uTime * 11.0, vP.z / Rn * 1.7);
        float n = ffbm(np);
        // condensed vapour: densest in the first few widths, thinning as it spreads and mixes and evaporates
        float spread = R / uR0;
        float fade = smoothstep(0.0, 0.02, u) * pow(1.0 - smoothstep(0.04, 1.0, u), 1.5);
        float od = fade * (0.5 + 3.0 / pow(spread, 0.8)) * f * (0.15 + 1.7 * n * n * 1.6);
        // ragged edges: the thin parts eaten away by the eddies, more so downstream
        od *= smoothstep(0.1, 0.5, f + (n - 0.5) * (0.6 + 0.8 * u));
        // and the jet breaking into wisps and gaps as it mixes with the air
        float n2 = fn3(vec3(vP.x / Rn * 1.1 + 7.0, vP.y / (Rn * 0.8) - uTime * 7.0, vP.z / Rn * 1.1));
        od *= mix(1.0, smoothstep(0.2, 0.8, n2 * 0.7 + n * 0.5), smoothstep(0.08, 0.6, u));
        // a bright knot (the Mach disk) a couple of widths out of the main nozzle, then fainter diamonds
        float z = vP.y, D = uR0 * 2.0;
        float dia = uDiamond * pow(0.5 + 0.5 * cos(6.2832 * (z / (D * 1.5) - 0.35)), 10.0) * exp(-z / (D * 3.5)) * pow(f, 7.0) * smoothstep(D * 0.4, D * 1.0, z);
        od += dia * 0.9;
        float a = (1.0 - exp(-od * 1.8)) * min(1.0, uThr * 1.15);
        // into the ground softly
        a *= smoothstep(uGround - 0.02, uGround + 0.2, vWY);
        if (a < 0.004) discard;
        // white vapour lit by the sun on its sunny side, the sky's blue on the other; the dense core blue-white
        float sun = 0.5 + 0.5 * dot(normalize(vWN), uSun);
        vec3 col = mix(vec3(0.62, 0.68, 0.78), vec3(1.08, 1.05, 1.0), (0.3 + 0.7 * sun) * uSunK) * (0.74 + 0.45 * n);
        float core = pow(f, 3.0) * (1.0 - smoothstep(0.0, 0.25, u));
        col = mix(col, vec3(0.9, 0.96, 1.05) * 1.15, core * 0.6);
        col += vec3(0.6, 0.8, 1.0) * dia * 0.45;
        gl_FragColor = vec4(col, clamp(a, 0.0, 0.94));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// puffs: camera-facing soft blobs drawn in one call (vapour, dust, grit), lit as soft balls by the sun

class Puffs {
  constructor(max) {
    this.max = max; this.n = 0;
    const F = () => new Float32Array(max);
    this.px = F(); this.py = F(); this.pz = F(); this.vx = F(); this.vy = F(); this.vz = F();
    this.age = F(); this.life = F(); this.s0 = F(); this.s1 = F(); this.a0 = F(); this.rot = F(); this.rv = F();
    this.drag = F(); this.grav = F(); this.kind = new Uint8Array(max); this.vr = new Uint8Array(max);
    this.ord = new Uint16Array(max); this.dep = F();
    const g = this.geo = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(1, 1);
    g.setIndex(base.index); g.setAttribute('position', base.attributes.position); g.setAttribute('uv', base.attributes.uv);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3); this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aSz = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); this.aSz.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iSz', this.aSz);
    g.instanceCount = 0;
    this.mat = puffMaterial();
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 12; this.mesh.name = 'flight_puffs';
    this._sunV = new THREE.Vector3(); this._m3 = new THREE.Matrix3();
  }
  clear() { this.n = 0; this.geo.instanceCount = 0; }
  // position, velocity, life (s), size at birth and at the end, opacity, kind (0 vapour, 1 dust, 2 grit),
  // drag (1/s), gravity (m/s^2, negative rises)
  spawn(x, y, z, vx, vy, vz, life, s0, s1, a0, kind, drag, grav) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z; this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.age[i] = 0; this.life[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a0;
    this.rot[i] = Math.random() * 6.283; this.rv[i] = (Math.random() - 0.5) * (kind === 2 ? 8 : 1.2);
    this.drag[i] = drag; this.grav[i] = grav; this.kind[i] = kind; this.vr[i] = (Math.random() * 4) | 0;
  }
  update(dt, cam, ground, sun) {
    let n = this.n;
    const gy = ground + 0.06;
    for (let i = 0; i < n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this.copy(--n, i); i--; continue; }
      const k = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= k; this.vz[i] *= k; this.vy[i] = this.vy[i] * k - this.grav[i] * dt;
      // a slow drift on the breeze
      this.vx[i] += 0.35 * dt; this.vz[i] += 0.12 * dt;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      if (this.py[i] < gy) {
        if (this.kind[i] === 0) { this.py[i] = gy; this.vy[i] = Math.abs(this.vy[i]) * 0.15; }
        else { this.py[i] = gy; this.vy[i] = Math.abs(this.vy[i]) * 0.25; this.vx[i] *= 0.6; this.vz[i] *= 0.6; }
      }
      this.rot[i] += this.rv[i] * dt;
    }
    this.n = n;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (!n) return;
    // far to near, so the soft blobs lay over each other properly
    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    for (let i = 0; i < n; i++) { const dx = this.px[i] - cx, dy = this.py[i] - cy, dz = this.pz[i] - cz; this.dep[i] = dx * dx + dy * dy + dz * dz; this.ord[i] = i; }
    const ord = this.ord.subarray(0, n), dep = this.dep;
    ord.sort((a, b) => dep[b] - dep[a]);
    const P = this.aPos.array, S = this.aSz.array;
    for (let j = 0; j < n; j++) {
      const i = ord[j], t = this.age[i] / this.life[i];
      const size = this.s0[i] + (this.s1[i] - this.s0[i]) * (1 - (1 - t) * (1 - t));
      const a = this.a0[i] * Math.min(1, this.age[i] / 0.07) * Math.pow(1 - t, 1.3);
      P[j * 3] = this.px[i]; P[j * 3 + 1] = this.py[i]; P[j * 3 + 2] = this.pz[i];
      S[j * 4] = size; S[j * 4 + 1] = a; S[j * 4 + 2] = this.rot[i]; S[j * 4 + 3] = this.kind[i] * 4 + this.vr[i];
    }
    this.aPos.clearUpdateRanges(); this.aPos.addUpdateRange(0, n * 3); this.aPos.needsUpdate = true;
    this.aSz.clearUpdateRanges(); this.aSz.addUpdateRange(0, n * 4); this.aSz.needsUpdate = true;
    const U = this.mat.uniforms;
    U.uGround.value = ground;
    if (sun) { cam.updateMatrixWorld(); this._sunV.copy(sun).transformDirection(cam.matrixWorldInverse); U.uSunV.value.copy(this._sunV); }
  }
  copy(from, to) {
    if (from === to) return;
    for (const k of ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'age', 'life', 's0', 's1', 'a0', 'rot', 'rv', 'drag', 'grav', 'kind', 'vr']) this[k][to] = this[k][from];
  }
}

// four soft blobs in one texture: their outline in alpha, a lumpy thickness in red, a dome in green
let _atlas = null;
function puffAtlas() {
  if (_atlas) return _atlas;
  const S = 128, N = 256, data = new Uint8Array(N * N * 4);
  const lat = new Float32Array(33 * 33 * 4);
  for (let i = 0; i < lat.length; i++) lat[i] = Math.random();
  const vn = (x, y, v) => {
    const X = Math.floor(x), Y = Math.floor(y), fx = x - X, fy = y - Y, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const at = (i, j) => lat[(((j & 31) * 33 + (i & 31)) * 4) + v];
    return (at(X, Y) * (1 - sx) + at(X + 1, Y) * sx) * (1 - sy) + (at(X, Y + 1) * (1 - sx) + at(X + 1, Y + 1) * sx) * sy;
  };
  for (let v = 0; v < 4; v++) {
    const ox = (v & 1) * S, oy = (v >> 1) * S;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S * 2 - 1, w = (y + 0.5) / S * 2 - 1, r = Math.sqrt(u * u + w * w);
      const q = 3.2;
      const n = vn(u * q + 8, w * q + 8, v) * 0.5 + vn(u * q * 2.1 + 3, w * q * 2.1 + 3, v) * 0.3 + vn(u * q * 4.3 + 1, w * q * 4.3 + 1, v) * 0.2;
      // a billowy edge: the outline eaten into by the noise
      const e = r + (n - 0.5) * 0.75;
      let a = 1 - Math.min(1, Math.max(0, (e - 0.25) / 0.6));
      a = a * a * (3 - 2 * a) * (0.6 + 0.4 * n);
      const k = ((oy + y) * N + ox + x) * 4;
      data[k] = Math.round(255 * n); data[k + 1] = Math.round(255 * Math.sqrt(Math.max(0, 1 - r * r))); data[k + 2] = 255; data[k + 3] = Math.round(255 * a);
    }
  }
  _atlas = new THREE.DataTexture(data, N, N);
  _atlas.magFilter = THREE.LinearFilter; _atlas.minFilter = THREE.LinearMipmapLinearFilter; _atlas.generateMipmaps = true;
  _atlas.needsUpdate = true;
  return _atlas;
}

function puffMaterial() {
  return new THREE.ShaderMaterial({
    name: 'flight_puffs', transparent: true, depthWrite: false, fog: false,
    uniforms: { uMap: { value: puffAtlas() }, uSunV: { value: new THREE.Vector3(0.3, 0.8, 0.4) }, uGround: { value: -1e4 }, uSunK: { value: 1 } },
    vertexShader: /* glsl */`
      attribute vec3 iPos; attribute vec4 iSz;
      varying vec2 vUv; varying vec2 vQ; varying float vA; varying float vKind; varying float vWY; varying float vSize; varying vec3 vView;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        vec4 mv = viewMatrix * vec4(iPos, 1.0);
        // near the camera: fading out and kept from filling the screen (they cost the most there and show the least)
        float dist = -mv.z;
        float nearK = smoothstep(0.35, 1.8, dist);
        if (nearK <= 0.0) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
        float size = min(iSz.x, max(0.05, dist * 0.9));
        float c = cos(iSz.z), s = sin(iSz.z);
        vec2 q = position.xy * size;
        vec2 rq = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
        mv.xy += rq;
        // the world height of this corner (the view's x and y axes are the view matrix's rows)
        vWY = iPos.y + viewMatrix[0][1] * rq.x + viewMatrix[1][1] * rq.y;
        float w = iSz.w;
        vKind = floor(w / 4.0 + 0.01);
        float vr = w - vKind * 4.0;
        vUv = (uv + vec2(mod(vr, 2.0), floor(vr / 2.0 + 0.01))) * 0.5;
        vQ = rq / max(size, 1e-3);
        vA = iSz.y * nearK; vSize = size; vView = mv.xyz;
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap; uniform vec3 uSunV; uniform float uGround, uSunK;
      varying vec2 vUv; varying vec2 vQ; varying float vA; varying float vKind; varying float vWY; varying float vSize; varying vec3 vView;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        vec4 t = texture2D(uMap, vUv);
        float a = t.a * vA;
        // fade into the ground rather than cut by it
        a *= smoothstep(uGround - 0.02, uGround + 0.15 + vSize * 0.25, vWY);
        if (a < 0.004) discard;
        vec3 col;
        if (vKind < 0.5) {
          // vapour: a soft ball lit by the sun, bluish in its own shade, bright at the edges against the sun
          vec3 nrm = normalize(vec3(vQ * 1.6, t.g + 0.15));
          float sun = max(dot(nrm, uSunV), 0.0);
          float thick = t.r;
          col = vec3(0.6, 0.66, 0.76) + vec3(1.0, 0.97, 0.92) * (0.18 + 0.5 * sun * uSunK) * (0.85 + 0.3 * thick);
          float fw = pow(max(dot(normalize(vView), uSunV), 0.0), 5.0);
          col += vec3(1.0, 0.96, 0.9) * fw * (1.0 - t.a) * 0.6 * uSunK;
          col *= 0.92;
        } else if (vKind < 1.5) {
          vec3 nrm = normalize(vec3(vQ * 1.6, t.g + 0.2));
          float sun = max(dot(nrm, uSunV), 0.0);
          col = vec3(0.44, 0.40, 0.35) * (0.55 + 0.6 * sun * uSunK);
          a *= 0.85;
        } else {
          col = vec3(0.16, 0.15, 0.14);
          a = step(0.35, t.a) * vA;
        }
        gl_FragColor = vec4(col, clamp(a, 0.0, 0.95));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// sound nodes

function makeSound(ctx, master) {
  const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  // a little pink: the rush of gas rather than a radio's hiss
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.997 * b0 + w * 0.029591; b1 = 0.985 * b1 + w * 0.032534; b2 = 0.95 * b2 + w * 0.048056; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.9; }
  const src = (type, f, q) => {
    const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.loopStart = Math.random(); s.loopEnd = len / ctx.sampleRate;
    const bf = ctx.createBiquadFilter(); bf.type = type; bf.frequency.value = f; bf.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    s.connect(bf); bf.connect(g); g.connect(master); s.start(ctx.currentTime, Math.random() * 1.5);
    return { g, bf };
  };
  const hiss = src('bandpass', 4200, 0.6), roar = src('lowpass', 300, 0.9), ground = src('lowpass', 160, 0.7);
  return { ctx, noise: buf, hiss: hiss.g, hissF: hiss.bf, roar: roar.g, roarF: roar.bf, ground: ground.g };
}

// the valves opening: a sharp bang of gas and a thump
function bang(ctx, master, buf) {
  const t = ctx.currentTime;
  const s = ctx.createBufferSource(); s.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 0.5;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random()); s.stop(t + 0.4);
  const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
  const og = ctx.createGain(); og.gain.setValueAtTime(0.35, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  o.connect(og); og.connect(master); o.start(t); o.stop(t + 0.32);
}

// the lift valves throttling back (Shift in the air): a soft falling chuff of gas, no thump
function vent(ctx, master, buf) {
  const t = ctx.currentTime;
  const s = ctx.createBufferSource(); s.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.8;
  f.frequency.setValueAtTime(2400, t); f.frequency.exponentialRampToValueAtTime(700, t + 0.45);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random()); s.stop(t + 0.55);
}
