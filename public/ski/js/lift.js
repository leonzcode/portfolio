/* The chairlift beside the Jump Line: a detachable quad chair from the bottom of the line up to the top.
   The chair, the towers and the stations are Kagelok's "Chair Lift" (Sketchfab, CC BY 4.0): cut into its parts, made
   lighter and baked into one small texture (models/lift/lift.glb, see CREDITS.md). The cable is drawn here along the
   loop the chairs run round: up the park side, round the top bull wheel, down the other side and round the bottom one.
   As on a real detachable lift the chairs slow to a walk in the stations and run at line speed between them; every
   chair's place is worked out from one clock (the wall clock), so chairs never bunch up and every page in a room sees
   them in the same places.

   Riding it: ski into the lift line at the bottom (or press E near it, or reach the end of the run); you are taken to
   the load line facing up the hill, a chair comes round behind you and you sit down. Up the hill the turn keys look
   round (camera.js), Space held makes the ride quicker when you ride alone (a pause holds the lift then), Backspace
   goes straight to the top as always. At the top you stand up and ski off the unloading ramp towards the start.
   In a room each rider sends the chair's number (net.js, the state's x) and the others seat them on their own chair of
   that number.

   Cheap to draw: four draw calls (and two in the shadow pass) for all of it. The chairs are two instanced meshes
   (detailed near the camera, a coarse copy further off, nothing outside the view) whose matrices are written straight
   into their buffers each frame; everything that never moves (the stations, the towers, the cable's tube) is one
   merged mesh; the cable far off is a line. One material and one 1024 px texture. The stations stand on flat snow pads
   added to the park's height (planLift), so the terrain, the physics and the trees all see them. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { ground, height } from './terrain.js?v=16';

// ---- the model's numbers (metres, from models/lift/lift.glb) --------------------------------------------------------
const HALF = 2.388;                  // half the gauge: each cable's distance from the line's middle (the chairs' grips)
const SEAT_Y = -2.757;               // the top of the seat cushion under the grip
const SEAT_Z = 0.04;                 // where the hips sit on it, along the chair (+z is the way it faces)
const SEATS = [-0.78, -0.26, 0.26, 0.78];   // the four seats across the chair
const CHAIR_BOTTOM = -3.05;          // the lowest point of a chair under its grip
const HC = 9.2;                      // the cable over a tower's foot (on its sheaves)
const ST = { back: 4.09, front: 13.29, base: -4.42, half: 3.79 };   // a station round its bull wheel (+z towards the line)
const LOAD = 3.26;                   // the cable over the snow at the load and unload lines (the seat half a metre up)
// ---- the lift's running -----------------------------------------------------------------------------------------------
let XL = 36;                         // the line's middle, on the run's right-hand side riding down (planLift sets it)
const V = 9;                         // line speed (m/s; a real detachable runs at 5, a game wants it quicker)
const V0 = 1.3;                      // through the stations
const RAMP = 26;                     // metres to slow down or speed up between the two
const GAP = 5;                       // seconds between chairs (about) at any point of the loop
const SPAN = 78;                     // longest span between towers
const SAG = 0.00022;                 // cable sag: metres per metre squared of span (a 70 m span sags about a metre)
const PAD_SLOPE = 0.36, PAD_ROUND = 3;   // the station pads' sides
let xU = XL - HALF, xD = XL + HALF;      // the up line (on the park side) and the down line

/* ---- the plan: where everything goes, and the station pads ------------------------------------------------------
   Called with the park before the terrain is built (main.js). The pads are flat snow under the stations: the top one at
   the height of its uphill end (so the chairs clear the snow going round the bull wheel), which leaves a raised
   unloading platform at its downhill end with a ramp off it; the bottom one at its uphill end's height. */
export function planLift(park) {
  // the line's place: clear of the park's right-hand fence and the floodlight towers 2.5 m outside it (env.js), the up
  // line's chairs at least 2.6 m from them, and the stations inside the groomed run
  const fR = park.fences && park.fences.length ? Math.max(...park.fences.map(f => Math.max(f[0], f[2]))) : 16.5;
  XL = Math.max(36, Math.min(41, fR + 7.5)); xU = XL - HALF; xD = XL + HALF;
  const lastMeet = Math.max(...park.kickers.map(k => k.zMeet || k.z0 || 0));
  const top = { front: -45 }; top.z = top.front - ST.front;              // bull wheel z (the station runs from z - back to z + front)
  const bot = { front: lastMeet + 42 }; bot.z = bot.front + ST.front;
  // pads: x from the park side of the load line to past the down line; z over the station and a few metres round it
  const padOf = (z0, z1, uphillZ) => {
    const x0 = XL - 12, x1 = XL + 8;
    let lvl = -Infinity;
    for (let x = x0; x <= x1; x += 1) for (let z = z0; z <= z1; z += 1) lvl = Math.max(lvl, ground(x, z));
    return { x0, x1, z0, z1, y: lvl + 0.05 };
  };
  top.pad = padOf(top.z - ST.back - 3, top.front + 3);
  bot.pad = padOf(bot.front - 2, bot.z + ST.back + 3);
  const pads = [top.pad, bot.pad];
  const padY = (x, z) => {
    let best = -Infinity;
    for (const p of pads) {
      const dx = x < p.x0 ? p.x0 - x : x > p.x1 ? x - p.x1 : 0, dz = z < p.z0 ? p.z0 - z : z > p.z1 ? z - p.z1 : 0;
      if (dx > 40 || dz > 40) continue;
      const d = Math.hypot(dx, dz);
      const y = d < PAD_ROUND ? p.y - PAD_SLOPE * d * d / (2 * PAD_ROUND) : p.y - PAD_SLOPE * (d - PAD_ROUND / 2);
      if (y > best) best = y;
    }
    return best;
  };
  const onPad = (x, z) => pads.some(p => x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1);
  // into the park's height, so the terrain's patches, the physics and everything placed on the snow see the pads
  const H = park.height.bind(park), HT = park.heightTerrainOnly.bind(park), SU = park.surface.bind(park);
  const near = x => x > XL - 60 && x < XL + 52;
  park.height = (x, z, g) => { const a = H(x, z, g); if (!near(x)) return a; const b = padY(x, z); return b > a ? b : a; };
  park.heightTerrainOnly = (x, z, g) => { const a = HT(x, z, g); if (!near(x)) return a; const b = padY(x, z); return b > a ? b : a; };
  park.surface = (x, z) => SU(x, z) || (near(x) && onPad(x, z));
  park.hasLift = true;                 // (world.js makeProps leaves its old placeholder lift out)
  top.y = top.pad.y + LOAD; bot.y = bot.pad.y + LOAD;   // the cable's height through each station

  // the towers: from the bottom station up, as long a span as keeps the chairs well over a skier's head
  const sup = [{ z: bot.front, y: bot.y }];
  const towers = [];
  const clear = (a, b) => {
    const L = a.z - b.z;
    for (let t = 0.05; t < 0.96; t += 0.05) {
      const z = a.z - L * t, y = a.y + (b.y - a.y) * t - 4 * SAG * L * L * t * (1 - t);
      const g = Math.max(height(xU, z), height(xD, z));
      const nearSt = Math.min(Math.abs(z - bot.front), Math.abs(z - top.front)) < 16;
      if (y + CHAIR_BOTTOM - g < (nearSt ? 0.4 : 2.6)) return false;
    }
    return true;
  };
  let a = sup[0];
  for (let guard = 0; guard < 40; guard++) {
    const endS = { z: top.front, y: top.y };
    if (a.z - endS.z <= SPAN && clear(a, endS) && a !== sup[0]) { sup.push(endS); break; }
    let placed = null;
    for (let span = a === sup[0] ? 22 : SPAN; span >= 20; span -= 4) {
      const z = a.z - span; if (z < top.front + 18) continue;
      const c = { z, y: height(XL, z) + HC };
      if (clear(a, c) || span <= 20) { placed = c; break; }
    }
    if (!placed) { sup.push(endS); break; }
    towers.push({ x: XL, z: placed.z, y: height(XL, placed.z) });
    sup.push(placed); a = placed;
  }
  // the cable between supports: straight, less the sag of the span
  const cableY = z => {
    for (let i = 0; i < sup.length - 1; i++) {
      const s0 = sup[i], s1 = sup[i + 1];
      if (z <= s0.z && z >= s1.z) { const L = s0.z - s1.z, t = (s0.z - z) / L; return s0.y + (s1.y - s0.y) * t - 4 * SAG * L * L * t * (1 - t); }
    }
    return z > sup[0].z ? sup[0].y : sup[sup.length - 1].y;
  };

  /* ---- the loop: samples along it in the order the chairs go, each with its place, the way along and the speed
     (bottom bull wheel -> up the park side -> top bull wheel -> down the other side) */
  const P = [];
  const add = (x, y, z) => P.push({ x, y, z });
  const arc = (cz, cy, a0, a1, n) => { for (let i = 0; i <= n; i++) { const t = a0 + (a1 - a0) * i / n; add(XL + HALF * Math.cos(t), cy, cz + HALF * Math.sin(t)); } };
  const line = (x, z0, z1, yf, step) => { const n = Math.max(1, Math.ceil(Math.abs(z1 - z0) / step)); for (let i = 1; i <= n; i++) { const z = z0 + (z1 - z0) * i / n; add(x, yf(z), z); } };
  arc(bot.z, bot.y, 0, Math.PI, 24);                                   // round the bottom wheel, east to west by the back (+z)
  line(xU, bot.z, bot.front, () => bot.y, 1);                          // the bottom station's up side: the load line
  line(xU, bot.front, top.front, cableY, 2);                           // up the line
  line(xU, top.front, top.z, () => top.y, 1);                          // the top station's up side: the unload line
  const n0 = P.length;
  arc(top.z, top.y, Math.PI, 2 * Math.PI, 24);                         // round the top wheel, west to east by the back (-z)
  P.splice(n0, 1);                                                     // (the arc's first point repeats the line's last)
  line(xD, top.z, top.front, () => top.y, 1);
  line(xD, top.front, bot.front, cableY, 2);
  line(xD, bot.front, bot.z, () => bot.y, 1);
  P.pop();                                                             // (back where the loop began)
  const n = P.length;
  const S = new Float32Array(n + 1);
  for (let i = 1; i <= n; i++) { const a = P[i - 1], b = P[i % n]; S[i] = S[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z); }
  const len = S[n];
  // the load and unload lines (arc lengths): 4.5 m short of the bottom station's front, 4 m in from the top's
  const sAt = (x, z) => { let best = 0, bd = Infinity; for (let i = 0; i < n; i++) { const d = (P[i].x - x) ** 2 + (P[i].z - z) ** 2; if (d < bd) { bd = d; best = i; } } return S[best]; };
  const sLoad = sAt(xU, bot.front + 4.5), sUnload = sAt(xU, top.front - 4);
  // the slow stretches: from the bottom station's down-side entry round to the load line; from the unload line round
  // the top wheel and out of the top station's down side
  const sBotIn = sAt(xD, bot.front), sTopOut = sAt(xD, top.z + 2);
  const zones = [[sBotIn, sLoad + len], [sUnload, sTopOut]];
  const dist = s => {      // metres from s to the nearest slow stretch (0 inside one), round the loop
    let d = Infinity;
    for (const [a0, a1] of zones) for (const k of [-len, 0, len]) {
      const lo = a0 + k, hi = a1 + k;
      d = Math.min(d, s < lo ? lo - s : s > hi ? s - hi : 0);
    }
    return d;
  };
  const acc = (V * V - V0 * V0) / (2 * RAMP);
  const vel = new Float32Array(n + 1), tau = new Float32Array(n + 1);
  for (let i = 0; i <= n; i++) vel[i] = Math.min(V, Math.sqrt(V0 * V0 + 2 * acc * dist(S[i])));
  for (let i = 1; i <= n; i++) tau[i] = tau[i - 1] + (S[i] - S[i - 1]) * 2 / (vel[i] + vel[i - 1]);
  const T = tau[n], N = Math.max(4, Math.round(T / GAP));
  const px = new Float32Array(n + 1), py = new Float32Array(n + 1), pz = new Float32Array(n + 1);
  for (let i = 0; i <= n; i++) { const p = P[i % n]; px[i] = p.x; py[i] = p.y; pz[i] = p.z; }
  // where a rider stands and faces at the load and unload lines (the second seat from the park side)
  const seat = 1;
  // (a chair going up faces -z: its +x is the world's -x, its +z the world's -z)
  const load = { x: xU - SEATS[seat], z: bot.front + 4.5 - SEAT_Z, y: bot.pad.y };
  const unload = { x: xU - SEATS[seat], z: top.front - 4 - SEAT_Z, y: top.pad.y };
  const colliders = towers.map(t => ({ x: t.x, z: t.z, r: 0.55, y: t.y, s: 11 }));
  // the stations' piers: the big one under the middle, the thin one at the line end
  for (const st of [top, bot]) {
    const dir = st === top ? 1 : -1;            // +1: the station's line end is down the hill (+z)
    colliders.push({ x: XL, z: st.z + dir * 2.0, r: 1.3, y: st.pad.y, s: 6 }, { x: XL, z: st.z + dir * 11.5, r: 0.4, y: st.pad.y, s: 6 });
  }
  return { XL, top, bot, pads, towers, sup, cableY, px, py, pz, S, vel, tau, n, len, T, N, sLoad, sUnload, load, unload, seat, colliders };
}

// ---- the lift: meshes, the chairs' motion, and riding ---------------------------------------------------------------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _f = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sph = new THREE.Sphere();
const _cp = new THREE.Vector3(), _ct = new THREE.Vector3(), _cl = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);
const smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);

export class Lift {
  constructor(scene, plan, q) {
    this.scene = scene; this.plan = plan; this.q = q;
    const low = q.tier === 'low';
    this.nearR = low ? 75 : 170; this.farR = low ? 520 : 900;
    this.offset = 0;                   // seconds added to the wall clock (the ride made quicker, or held while paused alone)
    this.ride = null;                  // the rider's own ride: { phase, chair, t, ... }
    this.sit = 0; this.feet = new THREE.Vector3(); this.feetOn = false;   // for the pose (poseState: liftSit, liftFeet)
    const N = plan.N;
    this.s = new Float32Array(N); this.v = new Float32Array(N); this.cur = new Int32Array(N);
    this.sw = new Float32Array(N); this.swV = new Float32Array(N); this.yaw = new Float32Array(N);
    this.gx = new Float32Array(N); this.gy = new Float32Array(N); this.gz = new Float32Array(N);
    this.hint = 0; this.ready = false;
  }
  // the clock every page shares
  clock() { return Date.now() / 1000 + this.offset; }

  async load() {
    const loader = new GLTFLoader();
    const draco = new DRACOLoader(); draco.setDecoderPath('/car/vendor/three/addons/libs/draco/'); loader.setDRACOLoader(draco);
    const gltf = await loader.loadAsync('./models/lift/lift.glb?v=16');
    draco.dispose();
    const part = name => { let m = null; gltf.scene.traverse(o => { if (o.isMesh && o.name === name) m = o; }); if (!m) throw new Error('lift: no ' + name); return m; };
    const chair = part('chair'), chairLo = part('chair_lo'), tower = part('tower'), towerLo = part('tower_lo'), station = part('station'), bull = part('bull');
    const map = chair.material.map;
    if (map) { map.anisotropy = this.q.tier === 'low' ? 1 : 4; map.colorSpace = THREE.SRGBColorSpace; }
    // one material for every part (the cable too: its uvs sit on a dark grey spot of the texture)
    const mat = this.mat = new THREE.MeshStandardMaterial({ map, roughness: 0.62, metalness: 0.25 });
    const geo = m => { const g = m.geometry; g.applyMatrix4(m.matrixWorld); return g; };
    gltf.scene.updateMatrixWorld(true);
    const P = this.plan, N = P.N, low = this.q.tier === 'low';
    const group = this.group = new THREE.Group(); group.name = 'lift';
    // chairs
    this.chNear = new THREE.InstancedMesh(geo(chair), mat, N + 8);
    this.chFar = new THREE.InstancedMesh(geo(chairLo), mat, N + 8);
    for (const m of [this.chNear, this.chFar]) { m.frustumCulled = false; m.count = 0; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.matrixAutoUpdate = false; }
    this.chNear.castShadow = true; this.chNear.receiveShadow = !low;
    // everything that never moves in one mesh (one draw call, one more for its shadow): the stations, their bull
    // wheels, the towers and the cable's tube
    const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
    // (the towers: on the low tier a lighter copy, the same but for the ladder's rungs)
    const stG = geo(station), bw = geo(bull), twG = geo(low ? towerLo : tower), parts = [];
    for (const st of [P.top, P.bot]) {
      // the station on its pad, the base under the snow, the up line on the park side (the model mirrored across);
      // the model's line end is +z: the top station faces down the hill as it is, the bottom one is turned round
      const m4 = new THREE.Matrix4().compose(_p.set(XL, st.y, st.z), _q.setFromAxisAngle(Y, st === P.top ? 0 : Math.PI), _v.set(-1, 1, 1));
      for (const g0 of [stG, bw]) {
        const g1 = g0.clone().applyMatrix4(m4);
        // (mirrored, so each triangle's corners go the other way round to keep its front face outward)
        const ix = g1.index.array; for (let k = 0; k < ix.length; k += 3) { const t = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = t; }
        parts.push(g1);
      }
    }
    for (const t of P.towers) parts.push(twG.clone().translate(t.x, t.y, t.z));
    const cable = this.cableMeshes();
    parts.push(cable.tube);
    const still = this.still = new THREE.Mesh(mergeGeometries(parts, false), mat);
    still.castShadow = true; still.receiveShadow = true; still.matrixAutoUpdate = false; still.updateMatrixWorld(true);
    this.stillTris = still.geometry.index.count / 3;
    group.add(still, cable.line);
    group.add(this.chNear, this.chFar);
    for (const m of [this.chNear, this.chFar, cable.line]) m.updateMatrixWorld(true);
    this.scene.add(group);
    this.place(0, null);
    this.ready = true;
    return this;
  }
  cableMeshes() {
    const P = this.plan;
    // resample: a point every 3 m on the line, every sample round the wheels
    const pts = [];
    for (let i = 0; i < P.n; i++) {
      const last = pts[pts.length - 1];
      if (!last || i === P.n - 1 || Math.hypot(P.px[i] - last.x, P.pz[i] - last.z) > 2.9 || Math.abs(P.px[i] - last.x) > 0.01) pts.push(new THREE.Vector3(P.px[i], P.py[i] + 0.03, P.pz[i]));
    }
    pts.push(pts[0].clone());
    const R = 0.028, sides = 3, pos = [], uv = [], nor = [], idx = [];
    const t = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
    for (let i = 0; i < pts.length; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(pts.length - 1, i + 1)];
      t.subVectors(p1, p0).normalize();
      a.crossVectors(t, Y); if (a.lengthSq() < 1e-6) a.set(1, 0, 0); a.normalize(); b.crossVectors(a, t).normalize();
      for (let k = 0; k < sides; k++) {
        const ang = k / sides * Math.PI * 2, c = Math.cos(ang), s = Math.sin(ang);
        pos.push(pts[i].x + (a.x * c + b.x * s) * R, pts[i].y + (a.y * c + b.y * s) * R, pts[i].z + (a.z * c + b.z * s) * R);
        nor.push(a.x * c + b.x * s, a.y * c + b.y * s, a.z * c + b.z * s);
        uv.push(0.88, 0.88);                       // an empty (black) corner of the texture: the cable is dark steel
      }
      if (i < pts.length - 1) for (let k = 0; k < sides; k++) {
        const i0 = i * sides + k, i1 = i * sides + (k + 1) % sides, j0 = i0 + sides, j1 = i1 + sides;
        idx.push(i0, j0, i1, i1, j0, j1);
      }
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); tg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    tg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); tg.setIndex(idx);
    const lg = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0x23262b }));
    line.matrixAutoUpdate = false;
    this.tubeTris = idx.length / 3;
    return { tube: tg, line };
  }

  // the place of a chair's grip at loop time tau (seconds into the loop), into the chair's slot i
  locate(i, tau) {
    const P = this.plan, T = P.tau;
    let k = this.cur[i];
    if (tau < T[k] || tau > T[k + 1] + 3) {               // a jump (the start, a new clock): look it up
      let lo = 0, hi = P.n;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T[mid] <= tau) lo = mid; else hi = mid; }
      k = lo;
    } else while (k < P.n - 1 && T[k + 1] < tau) k++;
    this.cur[i] = k;
    const f = (tau - T[k]) / Math.max(1e-6, T[k + 1] - T[k]);
    const k1 = k + 1;
    this.gx[i] = P.px[k] + (P.px[k1] - P.px[k]) * f; this.gy[i] = P.py[k] + (P.py[k1] - P.py[k]) * f; this.gz[i] = P.pz[k] + (P.pz[k1] - P.pz[k]) * f;
    this.s[i] = P.S[k] + (P.S[k1] - P.S[k]) * f;
    const v = P.vel[k] + (P.vel[k1] - P.vel[k]) * f;
    const dx = P.px[k1] - P.px[k], dz = P.pz[k1] - P.pz[k];
    if (dx * dx + dz * dz > 1e-8) this.yaw[i] = Math.atan2(dx, dz);
    return v;
  }
  // the chair's own frame: its grip, turned the way it goes, swung on its hanger
  chairQ(i, out) { _q.setFromAxisAngle(Y, this.yaw[i]); _q2.setFromAxisAngle(X, this.sw[i]); return out.multiplyQuaternions(_q, _q2); }
  seatAt(i, seat, outP, outQ) {
    this.chairQ(i, outQ);
    outP.set(SEATS[seat] ?? 0, SEAT_Y, SEAT_Z).applyQuaternion(outQ);
    outP.x += this.gx[i]; outP.y += this.gy[i]; outP.z += this.gz[i];
    return outP;
  }
  // where every chair is now, and the instance buffers for the ones in view
  place(dt, camera) {
    const P = this.plan, N = P.N, gap = P.T / N, c = this.clock();
    for (let i = 0; i < N; i++) {
      let tau = (c + i * gap) % P.T; if (tau < 0) tau += P.T;
      const v = this.locate(i, tau);
      // swing on the hanger: a pendulum about 3 m long pushed by the chair's speeding up and slowing down
      if (dt > 0) {
        const a = (v - this.v[i]) / dt;
        const want = Math.max(-0.25, Math.min(0.25, Math.atan2(a, 9.81)));
        this.swV[i] += (-(this.sw[i] - want) * 3.2 - this.swV[i] * 0.55) * dt;
        this.sw[i] += this.swV[i] * dt;
      }
      this.v[i] = v;
    }
    if (!camera) return;
    _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _f.setFromProjectionMatrix(_pm);
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const nr2 = this.nearR * this.nearR, fr2 = this.farR * this.farR;
    const an = this.chNear.instanceMatrix.array, af = this.chFar.instanceMatrix.array;
    let nn = 0, nf = 0;
    for (let i = 0; i < N; i++) {
      const x = this.gx[i], y = this.gy[i], z = this.gz[i];
      const d2 = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2;
      if (d2 > fr2) continue;
      _sph.center.set(x, y - 1.6, z); _sph.radius = 2.2;
      if (!_f.intersectsSphere(_sph)) continue;
      this.chairQ(i, _q); _p.set(x, y, z); _m.compose(_p, _q, _s);
      if (d2 < nr2) { _m.toArray(an, nn * 16); nn++; } else { _m.toArray(af, nf * 16); nf++; }
    }
    // other riders' chairs are their own chairs here too, so nothing more to draw for them
    this.chNear.count = nn; this.chFar.count = nf;
    if (nn) this.chNear.instanceMatrix.needsUpdate = true;
    if (nf) this.chFar.instanceMatrix.needsUpdate = true;
  }
  // the chair that will next reach loop place s at least `lead` seconds from now: its slot and how long until then
  nextTo(s, lead) {
    const P = this.plan, N = P.N, gap = P.T / N, c = this.clock();
    // loop time at s
    let k = 0; { let lo = 0, hi = P.n; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (P.S[mid] <= s) lo = mid; else hi = mid; } k = lo; }
    const f = (s - P.S[k]) / Math.max(1e-6, P.S[k + 1] - P.S[k]), tauS = P.tau[k] + (P.tau[k + 1] - P.tau[k]) * f;
    let best = -1, bw = Infinity;
    for (let i = 0; i < N; i++) {
      let tau = (c + i * gap) % P.T; if (tau < 0) tau += P.T;
      let w = (tauS - tau) % P.T; if (w < 0) w += P.T;
      if (w >= lead && w < bw) { bw = w; best = i; }
    }
    return { i: best, wait: bw };
  }

  // ---- the rider ---------------------------------------------------------------------------------------------------
  // near the load line and on the snow: take the chairlift
  nearLoad(sk, r) { const L = this.plan.load; return Math.hypot(sk.p.x - L.x, sk.p.z - L.z) < r && Math.abs(sk.p.y - L.y) < 3; }
  // the loading area: the flat pad round the load line, on the park side and in front of the station's piers
  inLoadArea(sk) {
    const L = this.plan.load, pad = this.plan.bot.pad;
    return sk.p.x > pad.x0 && sk.p.x < XL - 0.6 && sk.p.z > this.plan.bot.front - 16 && sk.p.z < L.z + 7 && sk.p.y < pad.y + 6;
  }
  pastBottom(p) { return p.z > this.plan.bot.z + ST.back + 22; }
  board(sk, fromWhere) {
    const P = this.plan, L = P.load;
    const from = sk.p.clone(), fd = Math.hypot(from.x - L.x, from.z - L.z);
    sk.toLift();
    const walk = fromWhere === 'here' ? 0 : Math.min(2.2, Math.max(0.5, fd / 4));
    const pick = this.nextTo(P.sLoad, walk + 0.6);
    // the way the rider faced, to turn from
    const fw = _v.set(0, 0, 1).applyQuaternion(sk.q); const yaw0 = Math.atan2(fw.x, fw.z);
    this.ride = { phase: 'walk', t: 0, walk, from, yaw0, chair: pick.i, seat: P.seat, sit: 0 };
    if (this.input) this.input.stick = 0;     // (the mouse scheme's pointer looks round on the chair: start it behind)
    this.camShot = 'bot';
    this.feet.set(L.x, L.y, L.z); this.feetOn = true;
    if (walk === 0) { from.set(L.x, L.y, L.z); this.ride.yaw0 = Math.PI; }
    return true;
  }
  // the end of the run: straight to the load line
  boardNow(sk) { sk.spawn(this.plan.load.x, this.plan.load.z, 0, Math.PI); return this.board(sk, 'here'); }
  get riding() { return !!this.ride; }

  /* once a frame (main.js, after the physics and before the pose): the chairs, and the rider on one.
     g: { skier, input, I, live, paused, solo, camera, hud, sound } */
  update(dt, g) {
    if (!this.ready) return;
    this.input = g.mouse ? g.input : null;
    const P = this.plan, sk = g.skier, R = this.ride;
    // the clock: riding alone, a pause holds the lift, and Space held on a chair makes the ride four times quicker
    if (g.solo && R) {
      if (g.paused) this.offset -= dt;
      else if (R && R.phase === 'ride' && g.live && g.I && g.I.crouch) this.offset += dt * 3;
    }
    this.place(dt, g.camera);
    this.sounds(dt, g);
    // a ride ended elsewhere (Backspace, a reset, a new start): let go
    if (R && sk.state !== 'lift') { this.ride = null; this.sit = 0; this.feetOn = false; }
    if (!this.ride) {
      this.sit = 0; this.feetOn = false;
      if (g.live && sk.state === 'ground') {
        const near = this.nearLoad(sk, 34);
        if (near && this.hint <= 0) { g.hud && g.hud.flash('The chairlift: ski into the lift line (or press E)', 2600); this.hint = 30; }
        this.hint -= dt;
        if (this.inLoadArea(sk) && sk.v.length() < 16) this.board(sk);
        else if (near && g.input && g.input.took && g.input.took('KeyE')) this.board(sk);
        if (this.ride && g.hud) g.hud.flash(g.solo ? 'Chairlift: steer to look round, hold Space to speed up' : 'Chairlift: steer to look round', 2800);
      }
      if (!this.ride) return;
    }
    const r = this.ride, L = P.load;
    r.t += dt;
    const i = r.chair;
    if (r.phase === 'walk' || r.phase === 'wait') {
      // shuffle to the load line, turning to face up the hill, and stand there till the chair comes
      const k = r.walk > 0 ? smooth(r.t / r.walk) : 1;
      this.feet.set(r.from.x + (L.x - r.from.x) * k, 0, r.from.z + (L.z - r.from.z) * k);
      this.feet.y = height(this.feet.x, this.feet.z);
      let dy = Math.PI - r.yaw0; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const yaw = r.yaw0 + dy * k;
      sk.q.setFromAxisAngle(Y, yaw);
      sk.p.set(this.feet.x, this.feet.y + 0.5, this.feet.z);
      sk.v.set(0, 0, 0);
      this.sit = 0; this.feetOn = true;
      if (k >= 1) r.phase = 'wait';
      // the chair comes: sit down as it reaches the back of the knees (one already gone by, after the page was away
      // for a while: the next one)
      const left = this.untilAt(i, P.sLoad);
      if (r.phase === 'wait' && left < -0.6) r.chair = this.nextTo(P.sLoad, 0.6).i;
      else if (left < 0.45 && r.phase === 'wait') { r.phase = 'sit'; r.t = 0; }
    }
    if (r.phase === 'sit' || r.phase === 'ride' || r.phase === 'stand') {
      this.seatAt(i, r.seat, _p, _q);
      if (r.phase === 'sit') {
        const k = smooth(r.t / 0.45);
        this.sit = k;
        sk.p.lerpVectors(_v2.set(L.x, this.feet.y + 0.5, L.z), _p, k);
        sk.q.slerp(_q, Math.min(1, dt * 10));
        if (k >= 1) { r.phase = 'ride'; r.t = 0; this.feetOn = false; }
      } else if (r.phase === 'ride') {
        this.sit = 1; sk.p.copy(_p); sk.q.copy(_q);
        // at the top: stand up at the unload line (gone past it while the page was away: set down there)
        if (this.s[i] >= P.sUnload - 0.3 && this.s[i] < P.sUnload + 20) { r.phase = 'stand'; r.t = 0; }
        else if (this.s[i] >= P.sUnload + 20) {
          sk.offLift(P.unload.x - 0.4, P.unload.z, Math.atan2(-0.85, 0.53), 4.2);
          this.ride = null; this.sit = 0; this.feetOn = false;
          this.offLifted(g);
          return;
        }
      } else {
        // standing up: the hips leave the seat, the skis on the unloading platform, turning off towards the start
        const k = smooth(r.t / 0.45);
        this.sit = 1 - k;
        this.feet.set(_p.x, 0, _p.z); this.feet.y = height(_p.x, _p.z); this.feetOn = true;
        sk.p.copy(_p);
        const yawOut = Math.atan2(-0.85, 0.53);
        let dy = yawOut - this.yaw[i]; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        sk.q.setFromAxisAngle(Y, this.yaw[i] + dy * k * 0.5);
        if (k >= 1) {
          // off down the ramp, towards the start
          sk.offLift(this.feet.x - 0.4, this.feet.z, yawOut, 4.2);
          this.ride = null; this.sit = 0; this.feetOn = false;
          this.offLifted(g);
          if (g.hud) g.hud.flash('Ride on down to the start', 1600);
          return;
        }
      }
      // the chair's speed for the camera, the wind and the readout
      _v.set(0, 0, 1).applyAxisAngle(Y, this.yaw[i]).multiplyScalar(this.v[i]); sk.v.copy(_v);
    }
    // going past a tower the chase camera swings a little way out to the park side, clear of its sheaves (camera.js
    // orbit, which comes back behind the chair after; in the mouse scheme lookMouse adds it)
    this.swing = 0;
    if (this.ride && this.ride.phase === 'ride') {
      const z = this.gz[i];
      for (const t of P.towers) { const d = z - t.z; if (d > -8 && d < 12) { this.swing = -1.15; break; } }
    }
    if (g.cams && this.swing && g.cams.mode === 'chase' && !g.mouse) g.cams.orbit = (g.cams.orbit || 0) + (this.swing - (g.cams.orbit || 0)) * Math.min(1, dt * 3);
  }
  // the drive's hum near the stations and on a chair, and the clack of a grip running over a tower's sheaves near you
  sounds(dt, g) {
    const snd = g.sound; if (!snd || !snd.liftHum) return;
    const c = g.camera ? g.camera.position : g.skier.p, P = this.plan;
    const dTop = Math.hypot(c.x - XL, c.z - P.top.z), dBot = Math.hypot(c.x - XL, c.z - P.bot.z);
    const hum = Math.max(this.ride && this.ride.phase === 'ride' ? 0.22 : 0, 1 - Math.min(dTop, dBot) / 70);
    if (Math.abs(hum - (this._hum ?? -1)) > 0.02) { snd.liftHum(hum); this._hum = hum; }
    // a chair's grip crossing a tower within 45 m of the camera (or the rider's own chair, louder)
    const mine = this.ride && this.ride.phase === 'ride' ? this.ride.chair : -1;
    for (const t of P.towers) {
      const dt2 = (t.x - c.x) ** 2 + (t.z - c.z) ** 2; if (dt2 > 45 * 45 && mine < 0) continue;
      for (let i = 0; i < P.N; i++) {
        const prev = this.pz0 ? this.pz0[i] : this.gz[i];
        if ((prev - t.z) * (this.gz[i] - t.z) < 0 && Math.abs(this.gx[i] - t.x) < 4) {
          const lv = i === mine ? 0.9 : Math.max(0, 0.55 - Math.sqrt(dt2) / 80);
          if (lv > 0.05) snd.liftClack(lv);
        }
      }
    }
    if (!this.pz0) this.pz0 = new Float32Array(P.N);
    this.pz0.set(this.gz);
  }
  // just set down at the top: the mouse scheme's pointer along the way off the ramp (main.js steers by it), and the
  // camera's tripod kept a moment as the rider skis off
  offLifted(g) {
    if (g.mouse && g.input) g.input.stick = Math.atan2(0.85, 0.53) / 1.66;
    this.after = 1.1; this.camShot = 'top';
  }
  /* The camera through loading and unloading (main.js, after camera.js has placed it): the station's housing is only
     3.1 m over the snow, so the chase camera would be under or inside it. A tripod beside the station takes over
     instead, low on the park side, out of the housing and clear of its piers: at the bottom from the moment you are
     taken to the load line until the chair is out of the station, at the top from just before the chair goes in until
     a moment after you ski off. It blends in and out of the chase camera and pans to follow the rider. */
  camera(dt, cam, cams, sk) {
    if (!this.ready) return;
    const P = this.plan, r = this.ride;
    let on = false;
    if (r && (cams.mode === 'chase' || cams.mode === 'far')) {
      const z = r.phase === 'walk' || r.phase === 'wait' ? sk.p.z : this.gz[r.chair];
      if (r.phase === 'walk' || r.phase === 'wait' || r.phase === 'sit' || (r.phase === 'ride' && z > P.bot.front - 14 && z < P.bot.z + 30)) { on = true; this.camShot = 'bot'; }
      else if (r.phase === 'stand' || (r.phase === 'ride' && z < P.top.front + 20 && z > P.top.z - 30)) { on = true; this.camShot = 'top'; }
    } else if (!r && this.after > 0 && (cams.mode === 'chase' || cams.mode === 'far')) { this.after -= dt; on = true; }
    const w = this.camW = (this.camW || 0) + ((on ? 1 : 0) - (this.camW || 0)) * Math.min(1, dt * 2.4);
    if (w < 0.003) { this.camW = 0; return; }
    // the tripod, on the park side clear of the housing and its piers, a little over head height: at the bottom behind
    // the load line (the rider, the chair coming round and the line going up the hill ahead all in view), at the top
    // up the hill from the unload line (the chair coming in, and the rider skiing off down the ramp)
    const top = this.camShot === 'top', st = top ? P.top : P.bot, spot = top ? P.unload : P.load;
    const pos = _cp.set(spot.x - (this.camDX ?? 8), st.pad.y + (this.camDY ?? 1.3), spot.z + (top ? (this.camDZt ?? -9) : (this.camDZ ?? 9)));
    const tgt = _ct.set(sk.p.x, Math.min(sk.p.y, st.pad.y + 1.2) + 0.2, sk.p.z + (top ? 0.5 : -1.5));
    if (!this.camLookOk) { this.camLook = new THREE.Vector3().copy(tgt); this.camLookOk = true; }
    if (w < 0.01) this.camLook.copy(tgt); else this.camLook.lerp(tgt, Math.min(1, dt * 5));
    const k = w * w * (3 - 2 * w);
    cam.position.lerp(pos, k);
    // (never under the snow on the way between the two: the top station's pad stands over the slope)
    const gy = height(cam.position.x, cam.position.z) + 0.8; if (cam.position.y < gy) cam.position.y = gy;
    // the eyes go to the rider quickly, while the camera itself moves over
    _cl.copy(cams.look).lerp(this.camLook, Math.min(1, k * 3));
    cam.up.set(0, 1, 0); cam.lookAt(_cl);
    cam.fov += ((this.camFov ?? 45) - cam.fov) * k; cam.updateProjectionMatrix();
  }
  // in the mouse scheme on the chair: the camera turns with the pointer (input.stick, -1 .. 1), the turn keys move the
  // pointer too, and going past a tower it swings out as with the keys while the pointer is near the middle
  lookMouse(cams, input, I, dt) {
    if (I.steer) input.stick = Math.max(-1, Math.min(1, input.stick + I.steer * dt * 0.7));
    const want = -input.stick * 2.4 + (Math.abs(input.stick) < 0.2 ? this.swing || 0 : 0);
    cams.orbit = (cams.orbit || 0) + (want - (cams.orbit || 0)) * Math.min(1, dt * 6);
  }
  // seconds until chair i reaches loop place s (it is ahead of it)
  untilAt(i, s) {
    const P = this.plan;
    let d = s - this.s[i]; if (d < -P.len / 2) d += P.len; if (d > P.len / 2) d -= P.len;
    return d / Math.max(0.3, this.v[i]);
  }

  // ---- riding with others (net.js): what goes in the state's x, and where another rider on a chair sits here ----------
  netX(x) {
    const r = this.ride; if (!r) return;
    x.lf = r.phase === 'walk' || r.phase === 'wait' ? 1 : 2; x.lc = r.chair; x.ls = r.seat; x.lt = Math.round(this.sit * 100) / 100;
  }
  remoteSeat(x, p, q, out) {
    if (!this.ready || !x || !x.lf) return null;
    out.sit = x.lf === 2 ? (typeof x.lt === 'number' ? x.lt : 1) : 0;
    if (x.lf === 2) {
      const i = x.lc | 0; if (i < 0 || i >= this.plan.N) return null;
      this.seatAt(i, (x.ls | 0) & 3, p, q);
      out.feet = null;
      // (standing up at the top: the skis on the platform under the seat)
      if (out.sit < 1) { out.feet = out.f || (out.f = new THREE.Vector3()); out.feet.set(p.x, height(p.x, p.z), p.z); }
    } else { out.feet = out.f || (out.f = new THREE.Vector3()); out.feet.set(p.x, p.y - 0.5, p.z); }
    return out;
  }

  // ---- collisions: towers and the stations' piers, as trees are (skier.trees) ------------------------------------------
  withTowers(forest) {
    const C = this.plan.colliders;
    const hit = (x, z, r) => {
      for (const c of C) {
        const d = Math.hypot(c.x - x, c.z - z), R = c.r + r;
        if (d < R) return { t: { x: c.x, y: c.y, z: c.z, s: c.s }, d, R, nx: (x - c.x) / (d || 1), nz: (z - c.z) / (d || 1) };
      }
      return null;
    };
    return { hit: (x, z, r) => forest.hit(x, z, r) || hit(x, z, r), forest };
  }
  stats() {
    return { chairs: this.plan.N, towers: this.plan.towers.length, loop: Math.round(this.plan.len), T: Math.round(this.plan.T), near: this.chNear.count, far: this.chFar.count, stillTris: this.stillTris, tubeTris: this.tubeTris };
  }
}
