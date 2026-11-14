/* (W, round 10) Any mountain on Earth: its real lifts from OpenStreetMap, ridden with the game's own chairlift (lift.js).
   lift.js lays a lift out along z (its line running up the hill towards -z), so each real one is planned and run in a
   frame of its own, turned and moved so its line runs that way there: its bottom station at the frame's origin, its top
   up the frame's -z. Everything lift.js does is unchanged: these wrap each lift and turn what goes in and comes out
   (the rider's place, turn and speed, the camera, the chairs drawn, the towers hit) between the frame and the world.
   Gondolas, cable cars, T-bars, platters and the rest ride as the chair (Leon's brief allows it); the shortest ones,
   magic carpets and rope tows under 150 m, are left out. All the lifts share one kit: four draw calls for them all. */
import * as THREE from 'three';
import { Lift, planLift, liftHeights, liftKit } from './lift.js?v=26';
import { height, ground } from './terrain.js?v=26';

const ST_FRONT = 13.29;      // (lift.js ST.front: a station's bull wheel to its line end)
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const Y = new THREE.Vector3(0, 1, 0);

// a frame: local (x, z) -> world, turned by th about y and moved to (ox, oz)
class Frame2 {
  constructor(ox, oz, th) {
    this.ox = ox; this.oz = oz; this.th = th; this.c = Math.cos(th); this.s = Math.sin(th);
    this.M = new THREE.Matrix4().makeRotationY(th).setPosition(ox, 0, oz);
    this.Mi = this.M.clone().invert();
    this.q = new THREE.Quaternion().setFromAxisAngle(Y, th); this.qi = this.q.clone().invert();
  }
  wx(x, z) { return this.ox + this.c * x + this.s * z; }
  wz(x, z) { return this.oz - this.s * x + this.c * z; }
  lx(x, z) { const dx = x - this.ox, dz = z - this.oz; return this.c * dx - this.s * dz; }
  lz(x, z) { const dx = x - this.ox, dz = z - this.oz; return this.s * dx + this.c * dz; }
  toW(v, out = v) { const x = v.x, z = v.z; out.set(this.wx(x, z), v.y, this.wz(x, z)); return out; }
  toL(v, out = v) { const x = v.x, z = v.z; out.set(this.lx(x, z), v.y, this.lz(x, z)); return out; }
}

/* the lifts worth riding from the map's list: the higher end is the top; a bent line split where it bends most (more
   than 40 m off the straight), a long one split into stretches of 3.5 km at most; only those whose both ends are in the
   area that is built (inArea) */
export function liftLines(lifts, inArea, maxN = 40) {
  const out = [];
  const add = (L, pts, part) => {
    let a = pts[0], b = pts[pts.length - 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 150) return;
    // bent: split at the point furthest off the straight line
    const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
    let far = 0, at = -1;
    for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs((pts[i].x - a.x) * dz - (pts[i].z - a.z) * dx); if (d > far) { far = d; at = i; } }
    if (far > 40 && part < 3) { add(L, pts.slice(0, at + 1), part + 1); add(L, pts.slice(at), part + 1); return; }
    if (len > 3500) { const n = Math.ceil(len / 3500); for (let k = 0; k < n; k++) add(L, [{ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n }, { x: a.x + (b.x - a.x) * (k + 1) / n, z: a.z + (b.z - a.z) * (k + 1) / n }], part + 1); return; }
    if (!inArea(a.x, a.z) || !inArea(b.x, b.z)) return;
    if (ground(a.x, a.z) > ground(b.x, b.z)) { const t = a; a = b; b = t; }
    out.push({ src: L, bot: { x: a.x, z: a.z }, top: { x: b.x, z: b.z }, len, name: L.name || kindName(L.kind) });
  };
  for (const L of lifts) { if (/funicular|carpet|rope_tow|goods|zip/.test(L.kind)) continue; add(L, L.pts, 0); }
  // (the most rise first, if there are too many to build)
  out.sort((p, q) => (ground(q.top.x, q.top.z) - ground(q.bot.x, q.bot.z)) - (ground(p.top.x, p.top.z) - ground(p.bot.x, p.bot.z)));
  return out.slice(0, maxN);
}
export const kindName = k => ({ chair_lift: 'Chairlift', gondola: 'Gondola', cable_car: 'Cable car', 't-bar': 'T-bar', 'j-bar': 'J-bar', platter: 'Platter lift', drag_lift: 'Drag lift', mixed_lift: 'Chair and gondola', magic_carpet: 'Magic carpet', rope_tow: 'Rope tow' })[k] || 'Lift';

/* ---- planning: every line's lift.js plan in its frame, and the pads under its stations for the world's park --------
   park: the world park (its height functions are added to here: the pads), lines from liftLines. */
export function planWorldLifts(park, lines) {
  const plans = [];
  for (const L of lines) {
    const ux = (L.top.x - L.bot.x) / L.len, uz = (L.top.z - L.bot.z) / L.len, th = Math.atan2(-ux, -uz);
    const F = new Frame2(L.bot.x, L.bot.z, th);
    // in the frame: the line along x 0, the bottom bull wheel near the map's bottom end, the top one near its top end
    const fake = { height: () => -Infinity, heightTerrainOnly: () => -Infinity, surface: () => false, fences: [], kickers: [], liftLines: [{ x: 0, top: -L.len + ST_FRONT - 4, bot: -ST_FRONT + 4, name: L.name }] };
    const lH = (x, z) => height(F.wx(x, z), F.wz(x, z)), lG = (x, z) => ground(F.wx(x, z), F.wz(x, z));
    liftHeights(lH, lG);
    let plan;
    try { plan = planLift(fake); } finally { liftHeights(); }
    plan.name = L.name; plan.ends = false;     // (only E boards a real lift: riders going past its bottom are not caught)
    plans.push({ L, F, plan, fake, lH, lG });
  }
  // the pads into the world park's height (a grid of 64 m cells listing the lifts whose stations are near)
  const B = 64, grid = new Map(), key = (i, j) => i * 100003 + j;
  plans.forEach((P, n) => {
    for (const st of [P.plan.top, P.plan.bot]) {
      const cx = P.F.wx(0, st.z), cz = P.F.wz(0, st.z);
      for (let i = Math.floor((cx - 70) / B); i <= Math.floor((cx + 70) / B); i++) for (let j = Math.floor((cz - 70) / B); j <= Math.floor((cz + 70) / B); j++) {
        const k = key(i, j); if (!grid.has(k)) grid.set(k, []); const l = grid.get(k); if (!l.includes(n)) l.push(n);
      }
    }
  });
  const padAt = (x, z, g, terr) => {
    const l = grid.get(key(Math.floor(x / B), Math.floor(z / B))); if (!l) return -Infinity;
    let best = -Infinity;
    for (const n of l) { const P = plans[n]; const y = (terr ? P.fake.heightTerrainOnly : P.fake.height)(P.F.lx(x, z), P.F.lz(x, z), g); if (y > best) best = y; }
    return best;
  };
  const surf = (x, z) => { const l = grid.get(key(Math.floor(x / B), Math.floor(z / B))); if (!l) return false; for (const n of l) { const P = plans[n]; if (P.fake.surface(P.F.lx(x, z), P.F.lz(x, z))) return true; } return false; };
  return { plans, padAt, surf };
}

/* ---- running: the lifts behind the one lift interface main.js uses (as lift.js Lifts) ---------------------------------- */
class WLift {
  constructor(scene, P, q, i) {
    this.P = P; this.F = P.F; this.i = i; this.inner = new Lift(scene, P.plan, q); this.plan = P.plan;
    // the rider as the lift sees it, in its frame
    const self = this;
    this.real = null;
    this.sk = {
      p: new THREE.Vector3(), q: new THREE.Quaternion(), v: new THREE.Vector3(),
      get state() { return self.real.state; }, get liftKind() { return self.real.liftKind; }, set liftKind(k) { self.real.liftKind = k; },
      toLift() { self.real.toLift(); },
      offLift(x, z, yaw, sp) { self.out = true; self.real.offLift(self.F.wx(x, z), self.F.wz(x, z), yaw + self.F.th, sp); },
      spawn(x, z, v, yaw) { self.out = true; self.real.spawn(self.F.wx(x, z), self.F.wz(x, z), v, yaw + self.F.th); },
    };
    // the camera as the lift sees it (for the chairs in view, the sounds, the tripod by the stations)
    this.cam = { position: new THREE.Vector3(), projectionMatrix: null, matrixWorldInverse: new THREE.Matrix4(), up: new THREE.Vector3(0, 1, 0), near: 0.15, fov: 70, real: null,
      lookAt(t) { const c = this.real; self.F.toW(this.position, c.position); c.up.set(0, 1, 0); c.lookAt(self.F.toW(t, _v2.copy(t))); },
      updateProjectionMatrix() { const c = this.real; c.fov = this.fov; c.near = this.near; c.updateProjectionMatrix(); } };
    this.cams = { mode: 'chase', pos: new THREE.Vector3(), look: new THREE.Vector3(), real: null,
      get orbitAuto() { return this.real.orbitAuto; }, set orbitAuto(v) { this.real.orbitAuto = v; },
      get first() { return this.real.first; }, set first(v) { this.real.first = v; } };
    this.view = { p: new THREE.Vector3(), state: 'ground' };
    this.feetW = new THREE.Vector3();
    // the line's box in the world, for skipping lifts far from the camera
    const pts = [[0, P.plan.top.z - 20], [0, P.plan.bot.z + 20]];
    this.cx = (P.F.wx(0, pts[0][1]) + P.F.wx(0, pts[1][1])) / 2; this.cz = (P.F.wz(0, pts[0][1]) + P.F.wz(0, pts[1][1])) / 2;
    this.half = (pts[1][1] - pts[0][1]) / 2;
  }
  heights(on) { if (on) liftHeights(this.P.lH, this.P.lG); else liftHeights(); }
  near(p, r) { return Math.hypot(p.x - this.cx, p.z - this.cz) < this.half + r; }
  // the instances this lift wrote into the kit from n0 on (in its frame) turned into the world
  turn(M, from, to) {
    if (to <= from) return;
    const a = M.instanceMatrix.array;
    for (let i = from; i < to; i++) { _m.fromArray(a, i * 16); _m2.multiplyMatrices(this.F.M, _m); _m2.toArray(a, i * 16); }
  }
  update(dt, g, kit) {
    const I = this.inner, F = this.F, sk = g.skier;
    this.real = sk;
    const mine = !!I.ride;
    // (a lift far from the camera and not being ridden: its chairs are not drawn, so not placed; they are put where the
    // clock says when it is near again)
    if (!mine && g.camera && !this.near(g.camera.position, I.farR + 40) && !this.near(sk.p, 60)) return;
    const S = this.sk; F.toL(sk.p, S.p); S.q.copy(F.qi).multiply(sk.q); S.v.copy(sk.v).applyQuaternion(F.qi);
    const C = this.cam; C.real = g.camera; F.toL(g.camera.position, C.position); C.projectionMatrix = g.camera.projectionMatrix;
    C.matrixWorldInverse.multiplyMatrices(g.camera.matrixWorldInverse, F.M);
    const n0 = kit.nn, f0 = kit.nf, w0 = kit.nw;
    this.out = false;
    this.heights(true);
    try { I.update(dt, Object.assign(this.g || (this.g = {}), g, { skier: S, camera: C })); }
    finally { this.heights(false); }
    this.turn(kit.chNear, n0, kit.nn); this.turn(kit.chFar, f0, kit.nf); this.turn(kit.wheels, w0, kit.nw);
    // on the lift (or just boarded): the rider where the lift put them, in the world
    if (I.ride && !this.out) { F.toW(S.p, sk.p); sk.q.copy(F.q).multiply(S.q); sk.v.copy(S.v).applyQuaternion(F.q); }
    if (I.feetOn) F.toW(I.feet, this.feetW);
  }
  camera(dt, cam, cams, sk) {
    const I = this.inner, F = this.F;
    if (!I.ride && !(I.after > 0) && !this.near(cams.pos, 30)) return;
    const C = this.cam; C.real = cam; F.toL(cam.position, C.position); C.near = cam.near; C.fov = cam.fov;
    const K = this.cams; K.real = cams; K.mode = cams.mode; F.toL(cams.pos, K.pos); F.toL(cams.look, K.look);
    const V = this.view; F.toL(sk.p, V.p); V.state = sk.state;
    this.heights(true);
    try { I.camera(dt, C, K, V); } finally { this.heights(false); }
  }
  remoteSeat(x, p, q, out, kit) {
    const I = this.inner, F = this.F;
    F.toL(p); q.premultiply(F.qi);
    const n0 = kit.chNear.count, f0 = kit.chFar.count;
    this.heights(true);
    let r; try { r = I.remoteSeat(x, p, q, out); } finally { this.heights(false); }
    F.toW(p); q.premultiply(F.q);
    if (r && r.feet) F.toW(r.feet);
    this.turn(kit.chNear, n0, kit.chNear.count); this.turn(kit.chFar, f0, kit.chFar.count);
    return r;
  }
  colliders() { return this.plan.colliders.map(c => Object.assign({}, c, { x: this.F.wx(c.x, c.z), z: this.F.wz(c.x, c.z) })); }
  // where a rider starts at the top: beside the top station, a little down from its end, on the unloading side
  topStart() {
    const P = this.plan, lx = P.XL - 8, lz = P.top.front + 10;
    return { x: this.F.wx(lx, lz), z: this.F.wz(lx, lz), yaw: this.F.th - 0.25 };
  }
}

export class WorldLifts {
  constructor(scene, planned, q) {
    this.scene = scene; this.q = q;
    this.lifts = planned.plans.map((P, i) => new WLift(scene, P, q, i));
    this.ready = false; this.feetW = new THREE.Vector3();
  }
  /* (the stations, towers and cables of a real resort's twenty or forty lifts are hundreds of thousands of triangles:
     lift.js merges every lift into one mesh, drawn whole wherever you look. Here each lift has its own: its own detailed
     mesh near the camera (within 500 m on the low tier, 900 m on medium, 1400 m on high), and further off it is a few
     grey columns and blocks among the others' in one instanced mesh, a draw call for all of them; the cables stay one
     set of lines for all) */
  async load() {
    const kit = await liftKit(this.q), low = this.q.tier === 'low';
    kit.make(this.lifts.reduce((s, l) => s + l.plan.N + 8, 0), 2 * this.lifts.length);
    kit.owner = this;
    const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
    this.nearD = low ? 500 : this.q.tier === 'medium' ? 900 : 1400;
    const stillMat = kit.mat.clone(), shadowMat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
    const group = this.group = new THREE.Group(); group.name = 'lift';
    // the far stand-in: a unit box standing on its base
    const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0); box.deleteAttribute('uv');
    const nBox = this.lifts.reduce((s, l) => s + l.plan.towers.length + 2, 0);
    const far = this.far = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({ color: 0x8d969f }), nBox);
    far.frustumCulled = false; far.matrixAutoUpdate = false; far.castShadow = false; far.name = 'lift far';
    let nb = 0; const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
    let tris = 0;
    for (const l of this.lifts) {
      const p0 = kit.parts.length, t0 = kit.tubes.length, c0 = kit.lines.length;
      l.heights(true);
      try { await l.inner.load(kit); } finally { l.heights(false); }
      for (let i = c0; i < kit.lines.length; i++) for (const v of kit.lines[i]) v.applyMatrix4(l.F.M);
      const parts = kit.parts.splice(p0).map(g => g.applyMatrix4(l.F.M)), tubes = kit.tubes.splice(t0).map(g => g.applyMatrix4(l.F.M));
      const g = mergeGeometries([...parts, ...tubes], false);
      const near = l.mesh = new THREE.Mesh(g, stillMat); near.matrixAutoUpdate = false; near.visible = false; near.receiveShadow = true; near.name = 'lift ' + l.plan.name;
      g.computeBoundingSphere(); tris += g.index.count / 3;
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', g.attributes.position); sg.setIndex(g.index);
      const sh = l.shadow = new THREE.Mesh(sg, shadowMat); sh.layers.set(5); sh.castShadow = true; sh.matrixAutoUpdate = false; sh.visible = false; sh.name = 'lift shadow';
      sg.boundingSphere = g.boundingSphere;
      group.add(near, sh);
      // its stand-ins: a column for each tower, a block for each station
      l.box0 = nb; l.boxes = [];
      q4.setFromAxisAngle(Y, l.F.th);
      for (const t of l.plan.towers) { const x = l.F.wx(t.x, t.z), z = l.F.wz(t.x, t.z); m4.compose(ps.set(x, t.y, z), q4, sc.set(0.45, (t.h || 9.2) + 0.3, 0.45)); l.boxes.push(m4.clone()); far.setMatrixAt(nb++, m4); }
      for (const st of [l.plan.top, l.plan.bot]) { const x = l.F.wx(0, st.z), z = l.F.wz(0, st.z); m4.compose(ps.set(x, st.pad.y - 0.5, z), q4, sc.set(6.5, 5.5, 13)); l.boxes.push(m4.clone()); far.setMatrixAt(nb++, m4); }
      l.isNear = false;
      // the line's two ends in the world, for the distance to it
      l.ax = l.F.wx(0, l.plan.bot.z); l.az = l.F.wz(0, l.plan.bot.z); l.bx = l.F.wx(0, l.plan.top.z); l.bz = l.F.wz(0, l.plan.top.z);
    }
    far.count = nb; far.instanceMatrix.needsUpdate = true;
    const seg = []; for (const pts of kit.lines) for (let i = 0; i < pts.length - 1; i++) seg.push(pts[i], pts[i + 1]);
    const line = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seg), new THREE.LineBasicMaterial({ color: 0x23262b })); line.matrixAutoUpdate = false;
    group.add(far, line, kit.chNear, kit.chFar, kit.wheels);
    for (const o of group.children) o.updateMatrixWorld(true);
    this.scene.add(group);
    kit.lines.length = 0;
    this.stillTris = tris; for (const l of this.lifts) l.inner.stillTris = tris;
    this.kit = kit; this.ready = true; this.lodAt = null;
    return this;
  }
  // which lifts are near the camera (their detailed meshes) and which far (their stand-ins), when the camera has moved 20 m
  lod(cam) {
    if (this.lodAt && this.lodAt.distanceToSquared(cam) < 400) return;
    (this.lodAt || (this.lodAt = new THREE.Vector3())).copy(cam);
    const D = this.nearD, Z = new THREE.Matrix4().makeScale(0, 0, 0); let dirty = false;
    for (const l of this.lifts) {
      const dx = l.bx - l.ax, dz = l.bz - l.az, l2 = dx * dx + dz * dz || 1;
      let t = ((cam.x - l.ax) * dx + (cam.z - l.az) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(cam.x - l.ax - dx * t, cam.z - l.az - dz * t), near = d < D;
      l.shadow.visible = near && d < 350;
      if (near === l.isNear) continue;
      l.isNear = near; l.mesh.visible = near; dirty = true;
      for (let i = 0; i < l.boxes.length; i++) this.far.setMatrixAt(l.box0 + i, near ? Z : l.boxes[i]);
    }
    if (dirty) this.far.instanceMatrix.needsUpdate = true;
  }
  get active() { for (const l of this.lifts) if (l.inner.ride) return l; return null; }
  get riding() { return !!this.active; }
  get sit() { const a = this.active; return a ? a.inner.sit : 0; }
  get feet() { const a = this.active; return a ? a.feetW : this.feetW; }
  get feetOn() { const a = this.active; return a ? a.inner.feetOn : false; }
  pastBottom() { return false; }
  boardNow() { return false; }
  update(dt, g) {
    if (!this.ready) return;
    if (g.camera) this.lod(g.camera.position);
    this.kit.begin();
    for (const l of this.lifts) l.update(dt, g, this.kit);
    this.kit.end();
  }
  camera(dt, cam, cams, sk) { if (!this.ready) return; for (const l of this.lifts) l.camera(dt, cam, cams, sk); }
  lookMouse(cams, input, I, dt) { const a = this.active || this.lifts[0]; if (a) a.inner.lookMouse(cams, input, I, dt); }
  netX(x) { const a = this.active; if (!a) return; a.inner.netX(x); if (a.i > 0) x.li = a.i; }
  remoteSeat(x, p, q, out) { if (!this.ready) return null; const l = this.lifts[x ? x.li | 0 : 0]; return l ? l.remoteSeat(x, p, q, out, this.kit) : null; }
  // the towers and the stations' piers, as trees are (a grid of 32 m cells)
  withTowers(forest) {
    const B = 32, grid = new Map(), key = (i, j) => i * 100003 + j;
    for (const l of this.lifts) for (const c of l.colliders()) {
      const k = key(Math.floor(c.x / B), Math.floor(c.z / B)); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(c);
    }
    const hit = (x, z, r) => {
      const i0 = Math.floor(x / B), j0 = Math.floor(z / B);
      for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
        const l = grid.get(key(i, j)); if (!l) continue;
        for (const c of l) { const d = Math.hypot(c.x - x, c.z - z), R = c.r + r; if (d < R) return { t: { x: c.x, y: c.y, z: c.z, s: c.s }, d, R, nx: (x - c.x) / (d || 1), nz: (z - c.z) / (d || 1) }; }
      }
      return null;
    };
    return { hit: (x, z, r) => forest.hit(x, z, r) || hit(x, z, r), forest };
  }
  // E near a lift's load line: lift.js asks each lift itself (update), so nothing here
  stats() { return this.lifts.map(l => Object.assign(l.inner.stats(), { name: l.plan.name, len: Math.round(l.P.L.len) })); }
}
