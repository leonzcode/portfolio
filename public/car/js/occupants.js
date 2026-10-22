// People in the cars: every car near the camera (the player's, the traffic, the parked ones, the ones the player
// left) gets from nobody to a full car in its seats, seated with the sit or drive pose, seen through the glass.
// Traffic cars always have a driver; a school bus is full of children with an adult at the wheel. The player's own
// person sits in the driver's seat of the car being driven (its head hidden in the driver's camera). In a hard crash
// some occupants are thrown out through a door that bursts open or a broken window, tumble along the road and lie
// there or get up hurt and angry; the rest jolt with the impact.
//
// Seats come from the catalogue (spec.seats, hip points in the car's frame: forward -z, right +x, up +y), else are
// guessed from the car's size and its driver's eye point.
import * as THREE from 'three';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _c = new THREE.Vector3(), _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0), X_AXIS = new THREE.Vector3(1, 0, 0);
const ROOF_COLS = new Map(); // model -> the roof's height over each seat
export const RECLINE = 0.22;

// ------------------------------------------------------------------------------------------------------------
// the people module: people.js / person.js from the people agent, or the plain stand-in

let H = null, Hp = null;
// both kinds of person face -z (the car frame): a person facing (sin a, 0, cos a) is turned a + YAW0 about y
export const YAW0 = Math.PI;
export function loadPeople(drive) {
  if (Hp) return Hp;
  Hp = (async () => {
    if (!/[?&]standin/.test(location.search)) {
      try {
        const M = await import('./people.js?v=18');
        if (M && M.People && typeof M.People.createPerson === 'function') {
          const P = M.People;
          await P.load(drive && drive.G ? drive.G.renderer : undefined, drive ? drive.camera : undefined);
          if (drive) P.camera = drive.camera;
          if (drive && !P.env) P.env = peopleEnv(drive);
          H = wrapPeople(P);
          return H;
        }
      } catch (e) { console.warn('people module', e && e.message); }
    }
    const M = await import('./standin.js?v=18');
    H = wrapStandin(M);
    return H;
  })();
  return Hp;
}
export function people() { return H; }

// what a ragdoll lands on and bounces off, if the pedestrians module has not said already
function peopleEnv(D) {
  let at = -1, list = [];
  const cars = () => {
    if (D.G.frames === at) return list;
    at = D.G.frames; list = [];
    const add = (rig, v, x, y, z, yaw, vx, vz) => { if (rig && rig.dims) list.push({ x, y, z, yaw, len: rig.dims.length, wid: rig.dims.width, hgt: rig.dims.height, vx, vz }); };
    const veh = (rig, v) => { const o = v.origin(_c); add(rig, v, o.x, o.y, o.z, v.heading * Math.PI / 180, v.v.x, v.v.z); };
    if (D.car && D.car.vehicle) veh(D.car.rig, D.car.vehicle);
    if (D.onfoot) for (const e of D.onfoot.parked) veh(e.rig, e.vehicle);
    if (D.traffic) for (const c of D.traffic.list) { const y = c.yaw + (c.offYaw || 0); add(c.rig, null, c.x, c.y, c.z, y, Math.sin(y) * c.v + c.push.x, -Math.cos(y) * c.v + c.push.y); }
    return list;
  };
  return { ground: (x, z, y) => D.ground(x, z, y), get collide() { return D.collide; }, cars };
}

const ANIM_MAP = { exit_car: 'exit_L', enter_car: 'enter_L', pull_out: 'open_door', hurt: 'limp', flail: 'fall' };
function wrapPeople(P) {
  const has = n => P.anims.includes(n);
  return {
    name: 'people', P,
    create(look, opts = {}) {
      const p = P.createPerson(look, { kid: !!look.kid, lod: opts.lod === 'high' ? 'near' : 'auto', shadow: opts.shadow !== false && !opts.seated });
      return Promise.resolve(p);
    },
    randomLook(o = {}) { return P.randomLook(Math.random, o); },
    playerLook() {
      try { const s = JSON.parse(localStorage.getItem('car_look') || 'null'); if (s && typeof s === 'object') return s; } catch (e) {}
      return { ...P.DEFAULT_LOOK };
    },
    anim(name, side) {
      if (name === 'exit_car' || name === 'enter_car') { const n = (name === 'exit_car' ? 'exit_' : 'enter_') + (side === 'R' ? 'R' : 'L'); if (has(n)) return n; }
      if (has(name)) return name;
      const m = ANIM_MAP[name]; return m && has(m) ? m : 'idle';
    },
  };
}
function wrapStandin(M) {
  return {
    name: 'standin', M,
    create(look, opts = {}) { return Promise.resolve(M.createPerson(look, opts)); },
    randomLook(o) { return M.randomLook(o); },
    playerLook() { return M.playerLook(); },
    anim(name) { return name; },
  };
}

// a person's hip point relative to its root in the sitting pose (measured on the posed skeleton)
export function seatOffset(p) {
  if (p.seatOffset) return p.seatOffset();
  const h = p.bone && p.bone('hips');
  if (h) { p.object.updateMatrixWorld(true); const w = h.getWorldPosition(new THREE.Vector3()); return p.object.worldToLocal(w); }
  return new THREE.Vector3(0, 0.95, 0);
}
export function play(p, name, opts = {}) { try { if (p.play) return p.play(H ? H.anim(name, opts.side) : name, opts); } catch (e) {} return null; }
export function tick(p, dt) { try { if (p.update) p.update(dt); } catch (e) {} }
export function ragdoll(p, v, spin, opts) { try { p.ragdoll(v, spin || null, opts || {}); } catch (e) { console.warn('ragdoll', e); } }
export const isRagdoll = p => !!(p.isRagdoll || p.ragdolling);
export const settled = p => !!(p.settled || (p.isRagdoll && p.restTime > 0.7));
export function getUp(p) {
  return new Promise(res => {
    let done = false; const f = () => { if (!done) { done = true; res(); } };
    try { const r = p.getUp(f); if (r && typeof r.then === 'function') r.then(f, f); } catch (e) { f(); }
    setTimeout(f, 4000);
  });
}

// ------------------------------------------------------------------------------------------------------------
// seats

const seatCache = new WeakMap();
export function seatsOf(rig) {
  if (!rig) return [];
  let s = seatCache.get(rig);
  if (s) return s;
  const spec = rig.spec || {};
  if (Array.isArray(spec.seats) && spec.seats.length) s = spec.seats.map((q, i) => ({ x: q.x, y: q.y, z: q.z, side: q.side || (q.x < -0.1 ? 'L' : q.x > 0.1 ? 'R' : 'C'), door: q.door ?? -1, kid: !!q.kid, i }));
  else s = guessSeats(rig);
  seatCache.set(rig, s);
  return s;
}
export function guessSeats(rig) {
  const d = rig.dims || { length: 4.6, width: 1.85, height: 1.45, front: 2.3, rear: 2.3 };
  const eye = rig.mounts && rig.mounts.driver ? rig.mounts.driver : new THREE.Vector3(-0.37, 1.15, 0.2);
  const kind = (rig.spec && rig.spec.kind) || 'sedan';
  const x = THREE.MathUtils.clamp(Math.abs(eye.x) || 0.37, 0.3, d.width / 2 - 0.42);
  const y = eye.y - 0.62, z = eye.z + 0.02;
  const out = [{ x: -x, y, z, side: 'L', door: 0 }, { x, y, z, side: 'R', door: 1 }];
  const back = d.rear !== undefined ? d.rear : d.length / 2;
  if (kind === 'bus') {
    // a school bus: the driver at the front left, then rows of two-seat benches each side of the aisle, children
    // (the width measured includes the mirrors: the body's own side is a little outside the wheels)
    const kidY = y - 0.08, outer = Math.min(d.width / 2 - 0.45, (d.track || d.width * 0.75) / 2 - 0.08), inner = outer - 0.42;
    for (let zz = z + 1.15; zz < back - 0.9; zz += 0.78) for (const sx of [-1, 1]) for (const k of [outer, inner]) out.push({ x: sx * k, y: kidY, z: zz, side: sx < 0 ? 'L' : 'R', door: -1, kid: true });
    out.splice(1, 1); // no seat beside the driver
    out.forEach((q, i) => { q.i = i; });
    return out;
  }
  if (kind === 'van') {
    for (let r = 1; r <= 2; r++) { const zz = z + 0.95 * r; if (zz > back - 0.5) break; out.push({ x: -x, y: y + 0.05, z: zz, side: 'L', door: -1 }, { x, y: y + 0.05, z: zz, side: 'R', door: r === 1 ? 3 : -1 }); }
  } else if (kind !== 'sports' && kind !== 'pickup' && d.length > 3.7 && z + 0.85 < back - 0.5) {
    const zz = z + 0.86;
    out.push({ x: -x, y: y + 0.03, z: zz, side: 'L', door: 2 }, { x, y: y + 0.03, z: zz, side: 'R', door: 3 });
    if (d.width > 1.78) out.push({ x: 0, y: y + 0.06, z: zz, side: 'C', door: -1 });
  }
  out.forEach((s, i) => { s.i = i; });
  return out;
}

// ------------------------------------------------------------------------------------------------------------

const NEAR = 42, BUS_NEAR = 34, PARKED_NEAR = 26, MAX_CARS = 12, MAX_PARKED = 6, MAKE_PER_FRAME = 2;
const isBus = rig => !!(rig && rig.spec && (rig.spec.bus || rig.spec.kind === 'bus' || /bus/i.test(rig.spec.id || '')));

// a car's seats filled at random, kept on the car so it shows the same people each time it comes near
function plan(rig, kind, rand = Math.random) {
  const seats = seatsOf(rig), n = seats.length;
  const fill = new Array(n).fill(false);
  if (!n) return fill;
  if (isBus(rig)) {
    fill[0] = true;
    for (let i = 1; i < n; i++) fill[i] = rand() < 0.9;
    return fill;
  }
  // how many: none to full, ordinary trips mostly one or two people
  let k;
  if (kind === 'parked') { const r = rand(); k = r < 0.62 ? 0 : r < 0.84 ? 1 : r < 0.94 ? 2 : Math.floor(rand() * (n + 1)); }
  else { const r = rand(); k = r < 0.48 ? 1 : r < 0.75 ? 2 : r < 0.88 ? 3 : 1 + Math.floor(rand() * n); }
  if (kind === 'player') k = Math.floor(rand() * rand() * (n + 1)); // the player's passengers: often nobody
  k = Math.min(n, k);
  if (kind === 'traffic') fill[0] = true;
  // the front passenger seat first, then the back
  const order = [0, 1, ...seats.map((s, i) => i).filter(i => i > 1).sort(() => rand() - 0.5)];
  let have = fill.filter(Boolean).length;
  for (const i of order) { if (have >= k) break; if (kind === 'player' && i === 0) continue; if (!fill[i]) { fill[i] = true; have++; } }
  return fill;
}

export class Occupants {
  constructor(drive) {
    this.drive = drive; this.scene = drive.scene;
    this.recs = new Map(); // rig (or parked record) -> { seats, people: [{ seat, person, look, state }], frame }
    this.loose = [];       // people thrown out or fleeing, in the scene
    this.makeQ = 0; this.frame = 0;
    this.player = null;    // the player's person while sitting
    this.ready = loadPeople(drive).then(h => { this.H = h; return h; }).catch(e => { console.warn('people', e); return null; });
    this.onImpact = e => { try { this.impact(e); } catch (er) { console.warn('occupants impact', er); } };
    this.listened = null;
    this.stats = { made: 0, ejected: 0, visible: 0, cars: 0 };
  }

  rec(key) { return this.recs.get(key) || null; }

  // a car's record, made (with its plan) the first time it is asked for
  ensure(key, rig, kind, carRec) {
    let R = this.recs.get(key);
    // a pooled traffic model now carries another car: its people go and the new car's come
    if (R && kind === 'traffic' && carRec && R.car && R.car !== carRec) { this.release(R); R = null; }
    if (R) { R.kind = kind; if (carRec) R.car = carRec; return R; }
    // the plan is kept on the car, so it shows the same people each time it comes near
    const store = (carRec && carRec.occ) || { fill: plan(rig, kind), looks: [] };
    if (carRec) carRec.occ = store;
    if (this.fillAll || /[?&]fullcars/.test(location.search)) store.fill.fill(true); // (tests: every seat taken)
    R = { key, rig, kind, car: carRec || null, seats: seatsOf(rig), fill: store.fill, looks: store.looks, people: [], made: false, root: null, near: false, jolt: null };
    this.recs.set(key, R);
    return R;
  }

  driverOf(key) {
    const R = this.recs.get(key);
    if (!R) return null;
    const p = R.people.find(o => o.seat === 0 && !o.player);
    return p || null;
  }
  // somebody in a seat (planned, even if not yet made)
  occupied(key, seat) {
    const R = this.recs.get(key);
    return !!(R && (R.people.some(o => o.seat === seat) || (!R.made && R.fill[seat])));
  }

  // the root the people of a record hang from: the rig's object, or a group placed where a parked car stands
  rootOf(R) {
    if (R.rig && R.rig.object) return R.rig.object;
    if (!R.root) { R.root = new THREE.Group(); R.root.name = 'parked-occupants'; R.root.matrixAutoUpdate = false; this.scene.add(R.root); }
    if (R.car && R.car.m) { R.root.matrix.copy(R.car.m); R.root.matrixWorldNeedsUpdate = true; }
    return R.root;
  }

  // put a person in a seat of a record (sitting pose, its hip on the seat's hip point)
  seat(R, i, person, opts = {}) {
    const s = R.seats[i]; if (!s) return;
    const root = this.rootOf(R);
    root.add(person.object);
    // facing forward: -z in the car's frame, as the people face
    person.object.quaternion.identity();
    person.object.scale.setScalar(1);
    person.object.visible = true;
    if (person.setCabin) try { person.setCabin(1); } catch (e) {}
    // the car's own stand-in casts the shadow
    person.shadow = false;
    person.object.traverse(o => { if (o.isMesh) o.castShadow = false; });
    if (person.setSeated) try { person.setSeated(true); } catch (e) {}
    const drv = i === 0 && opts.drive !== false;
    play(person, drv ? 'drive' : 'sit', { fade: 0 });
    const o = { seat: i, person, look: opts.look || person.look, player: !!opts.player, kid: !!opts.kid, state: 'seated', still: 0, placed: 0, drv };
    this.footTargets(R, o);
    tick(person, 0.016);
    this.place(R, o);
    R.people = R.people.filter(q => q.seat !== i);
    R.people.push(o);
    return o;
  }

  // a seated person darker, as the car's own cabin is (the cars' interiors have the sky's light cut by a shader in
  // cars.js; the people get the same by a darker copy of their materials, which reuses the same shader program)
  shadeOf(R) {
    const rig = R.rig;
    if (rig && !rig.npc && rig._cabinU) return 1 - 0.5 * (rig.spec && rig.spec.cabinDark !== undefined ? rig.spec.cabinDark : 0.7);
    return 0.72;
  }
  shade(p, k) {
    if (!p || !p.object) return;
    p.object.traverse(m => {
      if (!m.isMesh || m.name === 'shadow_proxy') return;
      const U = m.userData;
      if (U.shadeOrig && (k >= 0.999 || U.shadeK !== k)) {
        for (const c of [].concat(m.material)) if (c && c.userData && c.userData.shadeClone) c.dispose();
        m.material = U.shadeOrig; U.shadeOrig = null; U.shadeK = 1;
      }
      if (k >= 0.999 || U.shadeOrig) return;
      U.shadeOrig = m.material; U.shadeK = k;
      const mk = src => {
        if (!src || !src.isMaterial) return src;
        const c = src.clone();
        c.onBeforeCompile = src.onBeforeCompile; c.customProgramCacheKey = src.customProgramCacheKey;
        if (c.color) c.color.multiplyScalar(k);
        if (c.envMapIntensity !== undefined) c.envMapIntensity = (src.envMapIntensity ?? 1) * k;
        c.userData = { ...src.userData, shadeClone: true };
        return c;
      };
      m.material = Array.isArray(m.material) ? m.material.map(mk) : mk(m.material);
    });
  }

  // the hips on the seat's hip point (measured on the posed skeleton: again once the model has loaded, or the
  // stand-in model it showed first is swapped for its own)
  // The captured 'sit' is upright, as on a chair; a car seat leans back about 17 degrees (the eyes end up behind the
  // hips, where the cars' driver cameras are): the person turned back about the hip point (less on a bus bench).
  place(R, o) {
    const s = R.seats[o.seat], p = o.person;
    if (!s) return;
    // (a far person skips frames of its clip: a few updates make sure the sitting pose is on the skeleton)
    for (let i = 0; i < 4; i++) tick(p, 0);
    const off = seatOffset(p);
    p._sitOff = off.clone(); // (the way in and out of a seat uses it)
    const th = o.kid || isBus(R.rig) ? 0.12 : RECLINE;
    p._recline = th;
    // the top of the head from the hips, in the person's own frame (the skull's top is about 0.2 m over the head bone)
    const hb = p.bone && p.bone('head');
    let vTop = null;
    if (hb) { p.object.updateMatrixWorld(true); vTop = p.object.worldToLocal(hb.getWorldPosition(new THREE.Vector3())).sub(off); vTop.y += 0.2 * (p.height || 1.75) / 1.75; }
    const fit = this.fit(R, o, th, vTop);
    o.baseQ = (o.baseQ || new THREE.Quaternion()).copy(fit.q);
    o.hipAt = fit.hip; o.hidden = fit.hide;
    p.object.quaternion.copy(o.baseQ);
    const r = off.applyQuaternion(o.baseQ);
    p.object.position.copy(fit.hip).sub(r);
    if (o.model !== p.model || !o.placed) this.shade(p, this.shadeOf(R));
    o.model = p.model; o.placed++; o.jbase = null;
  }

  // Where a seated person goes and how they lean so the head stays under the roof (tall people slouch: hips a little
  // forward, leaning back further), and after a crash under the roof as it was pushed in, and away from a side that
  // came in: slumped sideways towards the middle of the car (forward on a middle seat), as an occupant knocked out
  // in a crash is. Nothing fits (the roof down on the seat): hidden.
  fit(R, o, recline, vTop) {
    const s = R.seats[o.seat];
    const I = R.intr && R.intr[o.seat];
    const sx = s.side === 'L' ? -1 : s.side === 'R' ? 1 : 0;
    const side = I ? Math.min(0.35, I.side) : 0;
    const hip0 = new THREE.Vector3(s.x - sx * side, s.y, s.z - 0.04);
    const q = new THREE.Quaternion().setFromAxisAngle(X_AXIS, recline);
    if (this.noFit) return { q, hip: new THREE.Vector3(s.x, s.y, s.z - 0.04), hide: false }; // (tests: as before)
    const col = this.roofCols(R);
    const top = col ? col[o.seat] : null;
    if (!vTop || top === null || top === undefined) return { q, hip: hip0, hide: false };
    const lim = top - 0.08 - (I ? I.roof : 0) - (I && I.roof > 0.02 ? 0.03 : 0);
    const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), v = new THREE.Vector3();
    const slumpAxis = sx ? new THREE.Vector3(0, 0, 1) : X_AXIS, slumpSign = sx ? sx : -1;
    for (const ts of [0, 0.12, 0.24, 0.36, 0.5, 0.65, 0.8, 0.95, 1.1, 1.25]) {
      for (const tb of [0, 0.08, 0.16, 0.24, 0.34, 0.45]) {
        qa.setFromAxisAngle(slumpAxis, slumpSign * ts); qb.setFromAxisAngle(X_AXIS, recline + tb);
        qa.multiply(qb);
        const hip = hip0.clone(); hip.z -= tb * 0.45; hip.y -= tb * 0.1;
        v.copy(vTop).applyQuaternion(qa);
        if (hip.y + v.y <= lim) return { q: qa.clone(), hip, hide: false };
      }
      if (!I) break; // (no crash: a slouch only, never a slump)
    }
    // no crash and still too tall: as low as a slouch goes; after a crash with nowhere to fit: hidden
    if (!I) { qb.setFromAxisAngle(X_AXIS, recline + 0.45); const hip = hip0.clone(); hip.z -= 0.2; hip.y -= 0.045; return { q: qb.clone(), hip, hide: false }; }
    return { q, hip: hip0, hide: true };
  }

  // the top of the car's roof over each seat (outer skin, at rest), or null where the seat is open to the sky; from
  // the model's own points, once per model
  roofCols(R) {
    const rig = R.rig;
    if (!rig || !rig.object) return null;
    if (rig._roofCols && rig._roofColsN === R.seats.length) return rig._roofCols;
    const key = (rig.id || (rig.spec && rig.spec.id) || '?') + (rig.npc ? ':n' : ':p') + ':' + R.seats.length;
    if (ROOF_COLS.has(key)) { rig._roofCols = ROOF_COLS.get(key); rig._roofColsN = R.seats.length; return rig._roofCols; }
    const seats = R.seats, cols = seats.map(() => -Infinity);
    rig.object.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(rig.object.matrixWorld).invert(), M = new THREE.Matrix4(), v = new THREE.Vector3();
    rig.object.traverse(m => {
      if (!m.isMesh || m.isSkinnedMesh || m.isInstancedMesh || m.name === 'contact_shadow' || m.name === 'shadow_proxy' || !m.geometry || !m.geometry.attributes.position) return;
      for (let a = m, k = 0; a && k < 8; a = a.parent, k++) { if (a.userData && a.userData.person) return; if (a.name === 'person' || a.name === 'far' || /^lamp_|^dmgpart_/.test(a.name)) return; }
      M.multiplyMatrices(inv, m.matrixWorld);
      const pos = m.geometry.attributes.position, n = pos.count;
      for (let i = 0; i < n; i += 2) {
        v.fromBufferAttribute(pos, i).applyMatrix4(M);
        for (let k = 0; k < seats.length; k++) { const s = seats[k]; if (v.y > cols[k] && Math.abs(v.x - s.x) < 0.18 && v.z > s.z - 0.1 && v.z < s.z + 0.35) cols[k] = v.y; }
      }
    });
    const H = rig.dims ? rig.dims.height : 1.45;
    const out = cols.map(c => Number.isFinite(c) && c > H - 0.2 ? c : null);
    ROOF_COLS.set(key, out);
    rig._roofCols = out; rig._roofColsN = seats.length;
    return out;
  }

  // how far the crash pushed the roof down over each seat and a side in beside it (damage.js moves the body's points:
  // its own copies of them before and after, in the car's frame)
  measureCrush(R) {
    const rig = R.rig, rd = rig && rig._dmg;
    if (!rd || !rd.entries || !rd.damaged) { R.intr = null; return; }
    const S = R.seats, cols = this.roofCols(R) || [];
    const out = S.map(() => ({ roof: 0, side: 0 }));
    const lo = Math.min(...S.map(s => s.y)) + 0.15;
    for (const e of rd.entries) {
      if (!e.cur || !e.rest || (e.role !== 'paint' && e.role !== 'body' && e.role !== 'glass')) continue;
      const r = e.rest, c = e.cur, n = Math.min(r.length, c.length);
      for (let i = 0; i < n; i += 6) {
        const y = r[i + 1]; if (y < lo) continue;
        const x = r[i], z = r[i + 2], dy = y - c[i + 1], din = Math.abs(x) - Math.abs(c[i]);
        if (dy < 0.015 && din < 0.015) continue;
        for (let k = 0; k < S.length; k++) {
          const s = S[k], dz = z - (s.z + 0.12);
          if (dz < -0.55 || dz > 0.55) continue;
          const O = out[k], t = cols[k];
          if (dy > O.roof && Math.abs(x - s.x) < 0.4 && t !== null && t !== undefined && y > t - 0.12) O.roof = dy;
          if (din > O.side && s.side !== 'C' && Math.sign(x) === Math.sign(s.x) && Math.abs(x) > Math.abs(s.x) + 0.12 && y > s.y + 0.1) O.side = din;
        }
      }
    }
    R.intr = out;
  }

  // how far the hips are from the seat's hip point (a model that arrived late, or a pose measured too early)
  hipsOff(R, o) {
    const p = o.person, s = R.seats[o.seat], h = p.bone && p.bone('hips');
    if (!h || !s || p.lodLevel === 2) return 0;
    const root = this.rootOf(R);
    root.updateWorldMatrix(true, false); h.updateWorldMatrix(true, false);
    _c.setFromMatrixPosition(h.matrixWorld); root.worldToLocal(_c);
    const a = o.hipAt || _w.set(s.x, s.y, s.z - 0.04);
    return Math.hypot(_c.x - a.x, _c.y - a.y, _c.z - a.z);
  }

  // a driver's hands on the steering wheel (the player's car has one; for the others it is where it would be)
  // the feet on the car's floor, forward in the footwell: the captured sitting clip is for a chair (shins upright,
  // the feet half a metre under the hips), which in a car puts the shoes through the floor pan. Two-bone IK puts the
  // heels on the floor, the legs stretched forward as a driver's are (knees up a little in a low car).
  footTargets(R, o) {
    const p = o.person; if (!p.ik) return;
    const s = R.seats[o.seat]; if (!s) return;
    const root = this.rootOf(R);
    root.updateWorldMatrix(true, false);
    if (!o.ftL) { o.ftL = new THREE.Vector3(); o.ftR = new THREE.Vector3(); }
    const bus = isBus(R.rig || R.fakeRig), front = o.seat < 2 && !bus;
    // the floor: a car's heel point is about 0.3 m under its seat's hip point, never under 0.17 m off the road
    const floor = Math.max(0.17, s.y - (bus ? 0.4 : 0.3));
    const legs = THREE.MathUtils.clamp((p.height || 1.7) / 1.75, 0.6, 1.1);
    const ahead = (bus ? 0.4 : front ? 0.72 : 0.5) * Math.min(1, legs + 0.05);
    const ax = 0.11 * legs, y = floor + 0.08 * legs, z = s.z - ahead;
    o.ftL.set(s.x - ax, y, z).applyMatrix4(root.matrixWorld);
    o.ftR.set(s.x + ax, y, z).applyMatrix4(root.matrixWorld);
    p.ik.footL = o.ftL; p.ik.footR = o.ftR;
  }

  wheelTargets(R, o) {
    const p = o.person; if (!p.ik) return;
    const rig = R.rig;
    if (!o.ikL) { o.ikL = new THREE.Vector3(); o.ikR = new THREE.Vector3(); }
    const st = rig && rig._steer && rig._steer.node;
    if (st) {
      st.updateWorldMatrix(true, false);
      const d = st.userData.diameter || 0.38;
      o.ikL.set(-d * 0.46, d * 0.1, 0.02).applyMatrix4(st.matrixWorld); o.ikR.set(d * 0.46, d * 0.1, 0.02).applyMatrix4(st.matrixWorld);
    } else {
      const s = R.seats[o.seat], root = this.rootOf(R);
      root.updateWorldMatrix(true, false);
      const cx = s.x, cy = s.y + 0.36, cz = s.z - 0.52;
      o.ikL.set(cx - 0.17, cy + 0.04, cz + 0.02).applyMatrix4(root.matrixWorld); o.ikR.set(cx + 0.17, cy + 0.04, cz + 0.02).applyMatrix4(root.matrixWorld);
    }
    p.ik.handL = o.ikL; p.ik.handR = o.ikR;
  }

  // the people of a record made, a couple a frame (each is a model to clone)
  async make(R) {
    if (R.made || R.making) return;
    R.making = true;
    const h = this.H || await this.ready;
    if (!h) { R.making = false; return; }
    const kid = isBus(R.rig);
    for (let i = 0; i < R.seats.length; i++) {
      if (!R.fill[i] || R.people.some(o => o.seat === i)) continue;
      if (R.dead) break;
      // the player sits in seat 0 of the car being driven
      if (i === 0 && R.kind === 'player') continue;
      const seat = R.seats[i];
      const isKid = !!seat.kid || (kid && i > 0);
      const look = R.looks[i] || (R.looks[i] = h.randomLook({ kid: isKid }));
      while (this.makeQ >= MAKE_PER_FRAME) await new Promise(r => requestAnimationFrame(r));
      this.makeQ++;
      let p = null;
      try { p = await h.create(look, { lod: 'low', kid: isKid, seated: true }); } catch (e) { console.warn('person', e); }
      if (!p || R.dead || !this.recs.has(R.key)) { if (p && p.dispose) p.dispose(); continue; }
      this.stats.made++;
      this.seat(R, i, p, { look, kid: isKid });
    }
    R.made = true; R.making = false;
  }

  // a record's people all taken away (the car went out of range or was freed)
  release(R, keep = null) {
    for (const o of R.people) {
      this.shade(o.person, 1);
      if (o.player || o.person === keep) { if (o.person.object.parent) o.person.object.parent.remove(o.person.object); continue; }
      if (o.person.dispose) o.person.dispose(); else if (o.person.object.parent) o.person.object.parent.remove(o.person.object);
    }
    R.people = []; R.made = false; R.dead = true;
    if (R.root) { this.scene.remove(R.root); R.root = null; }
    this.recs.delete(R.key);
  }

  // a person out of a seat into the world (keeps where it is on screen)
  take(R, i) {
    const k = R.people.findIndex(o => o.seat === i);
    if (k < 0) return null;
    const o = R.people[k];
    R.people.splice(k, 1);
    R.fill[i] = false;
    this.scene.attach(o.person.object);
    return o;
  }

  // the people of one car moved to another (a traffic car's cheap model swapped for the detailed one)
  transfer(fromKey, toKey, toRig) {
    const R = this.recs.get(fromKey);
    if (!R) return;
    this.recs.delete(fromKey);
    R.key = toKey; R.rig = toRig; R.seats = seatsOf(toRig); R.fakeRig = null;
    if (R.root) { this.scene.remove(R.root); R.root = null; }
    for (const o of R.people) {
      if (!R.seats[o.seat]) { if (o.person.dispose) o.person.dispose(); continue; }
      this.seat(R, o.seat, o.person, { look: o.look, player: o.player, drive: o.seat === 0 });
    }
    this.recs.set(toKey, R);
  }

  // the player's person in the driver's seat of the car being driven (or out of it)
  seatPlayer(key, rig, person) {
    const R = this.ensure(key, rig, 'player');
    // whoever planned for the driver's seat goes to make room
    const was = R.people.find(o => o.seat === 0 && !o.player);
    if (was) { R.people = R.people.filter(o => o !== was); if (was.person.dispose) was.person.dispose(); }
    const o = this.seat(R, 0, person, { player: true });
    this.player = { R, o };
    return o;
  }
  unseatPlayer() {
    if (!this.player) return;
    const { R, o } = this.player;
    R.people = R.people.filter(q => q !== o);
    this.player = null;
    const p = o.person;
    if (p.ik) p.ik.handL = p.ik.handR = p.ik.footL = p.ik.footR = null;
    if (p.setSeated) try { p.setSeated(false); } catch (e) {}
    this.shade(p, 1);
    p.shadow = true; if (p.setLod) try { p.setLod('near'); } catch (e) {}
  }

  // which cars have people now: the player's, the ones it left, the nearest traffic, the nearest parked
  update(dt) {
    const D = this.drive;
    this.frame++; this.makeQ = 0;
    if (D.events && this.listened !== D.events) { if (this.listened) this.listened.removeEventListener('impact', this.onImpact); D.events.addEventListener('impact', this.onImpact); this.listened = D.events; }
    if (!this.H) return;
    const cam = D.camera.position;
    const want = new Set();
    // the player's car and the ones left behind always
    if (D.car && D.car.rig) { const R = this.ensure(D.car.rig, D.car.rig, 'player'); want.add(R); }
    const left = D.onfoot && D.onfoot.parked ? D.onfoot.parked : [];
    for (const e of left) { const R = this.ensure(e.rig, e.rig, e.kind || 'parked'); want.add(R); }
    // traffic, nearest first
    const T = D.traffic;
    if (T && T.list) {
      const cand = [];
      for (const c of T.list) {
        const d2 = (c.x - cam.x) ** 2 + (c.z - cam.z) ** 2, bus = isBus(c.rig);
        if (d2 < (bus ? BUS_NEAR : NEAR) ** 2 || this.recs.has(c.rig)) cand.push([d2, c]);
      }
      cand.sort((a, b) => a[0] - b[0]);
      for (let i = 0; i < cand.length; i++) {
        const [d2, c] = cand[i];
        if (i >= MAX_CARS || d2 > (NEAR + 8) ** 2) continue;
        const R = this.ensure(c.rig, c.rig, 'traffic', c);
        want.add(R);
      }
    }
    // parked cars (instanced: no object of their own) near the camera
    const P = D.parked;
    if (P && P.list && P.list.length && (this.frame % 10 === 0 || this.parkedNear)) {
      if (this.frame % 10 === 0) {
        const cand = [];
        for (const o of P.list) { if (!o.K || o.skip || o.taken) continue; const d2 = (o.x - cam.x) ** 2 + (o.z - cam.z) ** 2; if (d2 < PARKED_NEAR * PARKED_NEAR) cand.push([d2, o]); }
        cand.sort((a, b) => a[0] - b[0]);
        this.parkedNear = cand.slice(0, MAX_PARKED).map(a => a[1]);
      }
      for (const o of this.parkedNear) {
        if (o.taken) continue;
        const fake = o.rigLike || (o.rigLike = { dims: o.K.dims, spec: (D.mods.cars && D.mods.cars.carInfo ? D.mods.cars.carInfo(o.model) : null) || { kind: 'sedan' }, mounts: null, userData: {} });
        const R = this.ensure(o, fake, 'parked', o);
        R.rig = null; R.fakeRig = fake;
        want.add(R);
      }
    }
    // let go of what is no longer wanted
    for (const R of [...this.recs.values()]) if (!want.has(R)) this.release(R);
    // make, show and pose
    let vis = 0;
    for (const R of want) {
      if (!R.made && !R.making) this.make(R);
      // after a crash (or a repair): where everyone sits again
      const now = performance.now();
      if ((R.crushCheck && R.crushCheck.length && now > R.crushCheck[0]) || (R.intr && R.rig && R.rig._dmg && !R.rig._dmg.damaged)) {
        if (R.crushCheck) R.crushCheck.shift();
        try { this.measureCrush(R); } catch (e) { R.intr = null; }
        for (const o of R.people) if (o.state === 'seated') this.place(R, o);
      }
      const root = this.rootOf(R);
      // hidden past the distance a traffic car's far model takes over (its glass is part of the body there)
      root.updateWorldMatrix(true, false);
      _v.setFromMatrixPosition(root.matrixWorld);
      const d = _v.distanceTo(cam);
      const show = d < (R.kind === 'traffic' ? 60 : 90);
      for (const o of R.people) {
        if (o.state !== 'seated') continue;
        const p = o.person;
        p.object.visible = (show || o.player) && !this.hideAll && !o.hidden;
        // behind glass a few metres off, the cheaper model does (the player's own always the detailed one)
        if (!o.player && p.setLod) { const want = d < 9 ? 'near' : 'far'; if (o.lod !== want) { o.lod = want; try { p.setLod(want); } catch (e) {} } }
        if (p.object.visible) vis++;
        else if (!o.player) continue;
        // a sitting pose needs few new frames: the player's every frame, the near ones now and then (breathing,
        // looking about), the rest only until they are placed
        const busy = o.player || o.placed < 3 || o.model !== p.model;
        if (busy || (show && d < 16 && (this.frame + o.seat) % 3 === 0) || (show && (this.frame + o.seat * 7) % 30 === 0)) {
          if (o.drv && (o.player || d < 20)) this.wheelTargets(R, o);
          this.footTargets(R, o);
          tick(p, busy ? dt : (d < 16 ? dt * 3 : dt * 30));
          if (o.placed < 3 || o.model !== p.model || (!R.jolt && this.hipsOff(R, o) > 0.05)) this.place(R, o);
        }
      }
      if (R.jolt) this.joltStep(R, dt);
    }
    this.stats.visible = vis; this.stats.cars = want.size;
    // the thrown and the fleeing
    this.looseStep(dt);
  }

  // ----------------------------------------------------------------------------------------------------------
  // crashes

  // the car's velocity just before this frame's hit (kept each frame by onfoot for the cars it runs; traffic: lane speed)
  velOf(R) {
    const D = this.drive;
    if (D.car && R.rig === D.car.rig) return D.onfoot && D.onfoot.preVel ? D.onfoot.preVel.clone() : D.car.vehicle.v.clone();
    const e = D.onfoot && D.onfoot.parked ? D.onfoot.parked.find(q => q.rig === R.rig) : null;
    if (e) return e.preVel ? e.preVel.clone() : e.vehicle.v.clone();
    if (R.car && Number.isFinite(R.car.yaw)) { const y = R.car.yaw + (R.car.offYaw || 0), v = R.car.vPre ?? R.car.v ?? 0; return new THREE.Vector3(Math.sin(y) * v, 0, -Math.cos(y) * v); }
    return new THREE.Vector3();
  }

  impact(e) {
    const rig = e.car || (e.vehicle && e.vehicle.rig);
    if (!rig) return;
    const R = this.recs.get(rig);
    const speed = e.speed || 0;
    const roll = !!e.rollover;
    const D = this.drive;
    // the player thrown from their own car only in an extreme crash
    if (D.car && rig === D.car.rig && D.onfoot && D.onfoot.mode === 'car' && !this.noPlayerEject && (speed > 36 || (roll && speed > 24)) && Math.random() < 0.6) {
      D.onfoot.ejectPlayer(e, this.velOf(R || { rig }));
    }
    if (!R) return;
    // everyone feels it
    if (speed > 3) {
      // (the push in the car's frame: the people lurch the other way)
      const root = this.rootOf(R); root.updateWorldMatrix(true, false);
      const n = new THREE.Vector3(e.normal ? e.normal.x : 0, 0, e.normal ? e.normal.z : 0).applyQuaternion(root.getWorldQuaternion(_q).invert());
      R.jolt = { t: 0, k: Math.min(1, speed / 25), n };
    }
    // one crash comes as several hits (a few circles of the body, a bounce): one roll of the dice per crash, again
    // only for a harder hit
    const now = performance.now();
    // the people kept under a roof pushed in (measured once the crush is done, and again as parts settle)
    if (speed > 4) R.crushCheck = [now + 120, now + 700, now + 2000];
    if (now - (R.crashAt || 0) < 1200 && speed < (R.crashSpeed || 0) * 1.2) return;
    R.crashAt = now; R.crashSpeed = speed;
    // who goes out: unbelted people in a hard crash, a few belted ones in a very hard one or a rollover
    const out = [];
    for (const o of R.people) {
      if (o.player || o.state !== 'seated') continue;
      o.belted = o.belted ?? (Math.random() < (R.kind === 'traffic' ? 0.7 : 0.8));
      let p = o.belted ? THREE.MathUtils.smoothstep(speed, 24, 45) * 0.3 : THREE.MathUtils.smoothstep(speed, 10, 28) * 0.9;
      if (roll) p = Math.min(0.95, p + (o.belted ? 0.12 : 0.55));
      if (this.forceEject) p = 1;
      if (this.noEject) p = 0; // (tests)
      if (Math.random() < p) out.push(o);
    }
    out.forEach((o, k) => { if (k === 0) this.eject(R, o, e); else setTimeout(() => { if (R.people.includes(o)) this.eject(R, o, e); }, 40 + k * 60); });
  }

  // out through a door that burst open, a side window, or the windscreen in a head-on hit, with the speed the car
  // had before the hit and the hit's push
  eject(R, o, e) {
    const root = this.rootOf(R), s = R.seats[o.seat];
    if (!s) return;
    const dims = (R.rig && R.rig.dims) || (R.fakeRig && R.fakeRig.dims) || { width: 1.85, height: 1.45 };
    const vPre = this.velOf(R);
    root.updateWorldMatrix(true, false);
    const rot = new THREE.Quaternion().setFromRotationMatrix(_m.extractRotation(root.matrixWorld));
    // the push on the car, in its frame
    const n = e.normal ? new THREE.Vector3(e.normal.x, 0, e.normal.z) : new THREE.Vector3();
    const nl = n.clone().applyQuaternion(rot.clone().invert());
    const side = e.side || (Math.abs(nl.z) > Math.abs(nl.x) ? (nl.z > 0 ? 'front' : 'rear') : (nl.x > 0 ? 'left' : 'right'));
    let sx = s.side === 'L' ? -1 : s.side === 'R' ? 1 : (Math.random() < 0.5 ? -1 : 1);
    let how;
    if (e.rollover) { sx = Math.random() < 0.5 ? -1 : 1; how = Math.random() < 0.35 && s.door >= 0 && Math.sign(s.x || sx) === sx ? 'door' : 'window'; }
    else if (side === 'front' && o.seat < 2 && !o.belted) how = 'windscreen';
    else if (side === 'left' || side === 'right') {
      // thrown to the far side of the hit (the car is pushed that way): the door there if it is the person's own
      const far = Math.sign(nl.x) || sx;
      sx = Math.random() < 0.7 ? far : sx;
      how = s.door >= 0 && Math.sign(s.x || sx) === sx && Math.random() < 0.6 ? 'door' : 'window';
    } else how = s.door >= 0 && Math.random() < 0.5 ? 'door' : 'window';
    const exit = how === 'windscreen' ? new THREE.Vector3(s.x * 0.6, s.y + 0.5, s.z - 1.1) : new THREE.Vector3(sx * (dims.width / 2 + 0.22), s.y + (how === 'window' ? 0.42 : 0.18), s.z);
    const exitW = exit.clone().applyMatrix4(root.matrixWorld);
    const F = this.drive.onfoot;
    if (F) {
      if (how === 'door') F.burstDoor(R.rig, s.door, e);
      else F.breakWindow(R.rig, how === 'windscreen' ? 'front' : 'side', exit, e);
    }
    const taken = this.take(R, o.seat);
    if (!taken) return;
    const p = taken.person;
    p.object.visible = true;
    p.object.position.copy(exitW);
    p.object.quaternion.copy(rot);
    const outDir = (how === 'windscreen' ? new THREE.Vector3(0, 0.2, -1) : new THREE.Vector3(sx, 0.15, 0)).applyQuaternion(rot);
    const sp = e.speed || 10;
    const v = vPre.clone().multiplyScalar(how === 'windscreen' ? 0.9 : 0.75).addScaledVector(outDir, 2 + sp * 0.1).addScaledVector(n, sp * 0.3);
    v.y += 1.2 + Math.random() * 1.8 + (e.rollover ? 2.5 : 0);
    this.stats.ejected++;
    this.throwPerson(p, v, { hurt: true, look: taken.look, low: 0.05 });
  }

  // a person into the world as a ragdoll; when it has settled it lies there a while, then gets up hurt and angry
  // a person out of a car into the street: no longer seated, casting a shadow, hands free
  toWorld(p) {
    if (p.object.parent !== this.scene) this.scene.attach(p.object);
    this.shade(p, 1);
    if (p.setCabin) try { p.setCabin(0); } catch (e) {}
    if (p.setSeated) try { p.setSeated(false); } catch (e) {}
    if (p.ik) { p.ik.handL = p.ik.handR = p.ik.footL = p.ik.footR = null; }
    p.shadow = true; if (p.setLod) try { p.setLod(p.isPlayer ? 'near' : 'auto'); } catch (e) {}
    p.object.visible = true;
  }

  throwPerson(p, v, opts = {}) {
    this.toWorld(p);
    const ground = (x, z, y) => this.drive.ground(x, z, y);
    const spin = opts.spin || new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 6);
    ragdoll(p, v, spin, { low: opts.low ?? 0.2, ground });
    const L = { person: p, state: 'flying', t: 0, hurt: !!opts.hurt, angry: opts.angry !== false, onUp: opts.onUp || null, keep: !!opts.keep, look: opts.look };
    if (!opts.keep) this.loose.push(L);
    return L;
  }

  // the people out of the cars: flying, lying, getting up, angry, walking off
  looseStep(dt) {
    const D = this.drive, cam = D.camera.position;
    for (let i = this.loose.length - 1; i >= 0; i--) {
      const L = this.loose[i], p = L.person;
      L.t += dt;
      tick(p, dt);
      const still = settled(p) || (!isRagdoll(p) && L.state === 'flying' && L.t > 0.5);
      if (L.state === 'flying' && (still || L.t > 8)) { L.state = 'lying'; L.t = 0; L.lieFor = (L.hurt ? 2.5 : 1) + Math.random() * 1.5; }
      else if (L.state === 'lying' && L.t > L.lieFor) {
        L.state = 'rising'; L.t = 0;
        getUp(p).then(() => {
          if (L.state !== 'rising') return;
          L.state = 'angry'; L.t = 0;
          const pick = ['angry', 'angry2', 'shout', 'fist'][(Math.random() * 4) | 0];
          play(p, L.hurt && Math.random() < 0.35 ? 'hurt' : pick, { fade: 0.3 });
          if (L.onUp) L.onUp(L);
        }).catch(() => { L.state = 'angry'; L.t = 0; });
      } else if (L.state === 'angry' && L.t <= 4) {
        // at whoever did it: the player on foot, or the car the player is in
        const F = D.onfoot, tgt = F && F.active ? F.pos : (D.car ? D.car.vehicle.pos : null), o = p.object;
        if (tgt) {
          const a = Math.atan2(tgt.x - o.position.x, tgt.z - o.position.z) + YAW0;
          let d = ((a - o.rotation.y) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
          o.rotation.y += d * Math.min(1, dt * 4);
          if (p.lookAt) p.lookAt(_v.set(tgt.x, tgt.y + 1.4, tgt.z));
        }
      } else if (L.state === 'angry' && L.t > 4) {
        if (p.lookAt) p.lookAt(null);
        // a pedestrian now: handed to the pedestrians if they take people, else it walks off
        const peds = D.peds;
        if (peds && typeof peds.adopt === 'function') { try { peds.adopt(p, { mood: 'angry' }); this.loose.splice(i, 1); continue; } catch (e) {} }
        L.state = 'walk'; L.t = 0; L.dir = Math.random() * Math.PI * 2;
        play(p, 'walk', { fade: 0.3 });
      } else if (L.state === 'walk' || L.state === 'flee') {
        // (after a few seconds' run, a pedestrian like the others: peds.js walks them off on the pavement)
        if (L.t > 3 && D.peds && typeof D.peds.adopt === 'function') { try { D.peds.adopt(p, { mood: L.state === 'flee' ? 'scared' : 'calm' }); this.loose.splice(i, 1); continue; } catch (e) { console.warn('adopt', e); } }
        const sp = L.state === 'flee' ? 3.6 : 1.3, o = p.object;
        if (L.dir === undefined) L.dir = Math.random() * Math.PI * 2;
        const nx = o.position.x + Math.sin(L.dir) * sp * dt, nz = o.position.z + Math.cos(L.dir) * sp * dt;
        const g = D.ground(nx, nz, o.position.y + 0.5);
        const hit = D.collide && D.collide.contacts([{ x: nx, z: nz, r: 0.3, y0: o.position.y + 0.4, y1: o.position.y + 1.6 }]).length;
        if (g === null || hit || Math.abs(g - o.position.y) > 0.5) L.dir += Math.PI * (0.5 + Math.random());
        else { o.position.set(nx, g, nz); }
        o.rotation.set(0, L.dir + YAW0, 0);
      }
      // far away, or long gone: taken off the stage
      const d2 = (p.object.position.x - cam.x) ** 2 + (p.object.position.z - cam.z) ** 2;
      if (!L.keep && (d2 > 160 * 160 || L.t > 120 || (L.state === 'walk' && d2 > 70 * 70))) {
        if (p.dispose) p.dispose(); else this.scene.remove(p.object);
        this.loose.splice(i, 1);
      }
    }
  }

  // a person running away from the car (passengers when it is taken)
  flee(p, from) {
    this.toWorld(p);
    const d = p.object.position.clone().sub(from); d.y = 0;
    const L = { person: p, state: 'flee', t: 0, dir: Math.atan2(d.x, d.z) + (Math.random() - 0.5) * 0.6 };
    play(p, 'run', { fade: 0.2 });
    this.loose.push(L);
    return L;
  }

  // a short lean with the hit for the people who stay in their seats
  joltStep(R, dt) {
    const J = R.jolt; J.t += dt;
    const k = J.k * Math.exp(-J.t * 5) * Math.sin(J.t * 22);
    for (const o of R.people) {
      if (o.state !== 'seated') continue;
      const obj = o.person.object;
      if (!o.jbase) o.jbase = obj.position.clone();
      obj.position.copy(o.jbase);
      obj.position.x -= J.n.x * k * 0.1; obj.position.z -= J.n.z * k * 0.1;
      _e.set(J.n.z * k * 0.35, 0, -J.n.x * k * 0.3);
      obj.quaternion.copy(o.baseQ || _q.identity()).multiply(_q2.setFromEuler(_e));
      if (J.t > 0.8) { obj.position.copy(o.jbase); obj.quaternion.copy(o.baseQ || _q.identity()); o.jbase = null; }
    }
    if (J.t > 0.8) R.jolt = null;
  }

  // every car's people gone (a new drop)
  clear() {
    for (const R of [...this.recs.values()]) this.release(R);
    for (const L of this.loose) { if (L.keep) continue; if (L.person.dispose) L.person.dispose(); else this.scene.remove(L.person.object); }
    this.loose = this.loose.filter(L => L.keep);
    this.player = null;
  }
}
