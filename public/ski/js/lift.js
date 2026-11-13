/* The chairlifts: a detachable quad chair from the bottom of a run up to its top (2026-11-08: Freeride's three, the Face
   Chair and one up each side bowl, all behind the one interface main.js uses, Lifts at the end; the Jump Line has a
   T-bar now, tbar.js). It began as the chairlift beside the Jump Line.
   The chair, the towers and the stations are Kagelok's "Chair Lift" (Sketchfab, CC BY 4.0): cut into its parts, made
   lighter and baked into one small texture (models/lift/lift.glb, see CREDITS.md). The cable is drawn here along the
   loop the chairs run round: up the park side, round the top bull wheel, down the other side and round the bottom one.
   As on a real detachable lift the chairs slow to a walk in the stations and run at line speed between them; every
   chair's place is worked out from one clock (the wall clock), so chairs never bunch up and every page in a room sees
   them in the same places.

   Riding it: ski into the lift line at the bottom (or press E near it, or reach the end of the run); you are taken to
   the load line facing up the hill, a chair comes round behind you and you sit down. Up the hill the turn keys look
   round (camera.js), any key (but Esc and the camera key) or a tap on a touch button sends the chair up on its own, the
   express, about 3.3 s from the bottom (a pause holds the lift when you ride alone), Backspace goes straight to the
   start as always. At the top you stand up and ski off the unloading ramp towards the start.
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
import { ground, height } from './terrain.js?v=24';

// ---- the model's numbers (metres, from models/lift/lift.glb) --------------------------------------------------------
const HALF = 2.388;                  // half the gauge: each cable's distance from the line's middle (the chairs' grips)
const SEAT_Y = -2.757;               // the top of the seat cushion under the grip
const SEAT_Z = 0.04;                 // where the hips sit on it, along the chair (+z is the way it faces)
const SEATS = [-0.78, -0.26, 0.26, 0.78];   // the four seats across the chair
const CHAIR_BOTTOM = -3.05;          // the lowest point of a chair under its grip
const HC = 9.2;                      // the cable over a tower's foot (on its sheaves)
const ST = { back: 4.09, front: 13.29, base: -4.42, half: 3.79, roof: 4.79 };   // a station round its bull wheel (+z towards the line)
const LOAD = 3.26;                   // the cable over the snow at the load and unload lines (the seat half a metre up)
// ---- the lift's running -----------------------------------------------------------------------------------------------
const V = 9;                         // line speed (m/s; a real detachable runs at 5, a game wants it quicker)
const V0 = 1.3;                      // through the stations
const RAMP = 26;                     // metres to slow down or speed up between the two
const GAP = 5;                       // seconds between chairs (about) at any point of the loop
const SPAN = 78;                     // longest span between towers
const SAG = 0.00022;                 // cable sag: metres per metre squared of span (a 70 m span sags about a metre)
const TALL = 24;                     // the tallest tower (the cable over its foot), its column stretched (tallTower)
const PAD_SLOPE = 0.36, PAD_ROUND = 3;   // the station pads' sides
// (each lift's line middle XL, its up line xU on the park side and its down line xD are its plan's own: a map may have
// several lifts, 2026-11-08)

/* ---- the plan: where everything goes, and the station pads ------------------------------------------------------
   Called with the park before the terrain is built (main.js). The pads are flat snow under the stations: the top one at
   the height of its uphill end (so the chairs clear the snow going round the bull wheel), which leaves a raised
   unloading platform at its downhill end with a ramp off it; the bottom one at its uphill end's height. */
export function planLift(park) {
  /* (2026-11-08, for Leon's "add more ski lifts": a map with park.liftLines, an array of { x, top, bot, name }, gets
     every one of them; the plan is then { multi: true, plans }, and new Lift() with it gives a Lifts, which holds them all
     behind the one lift interface main.js uses) */
  if (park.liftLines && park.liftLines.length) {
    const plans = park.liftLines.map((LL, i) => Object.assign(planOne(park, LL), { index: i, name: LL.name || 'Chairlift', ends: LL.ends !== false }));
    return plans.length === 1 ? plans[0] : { multi: true, plans };
  }
  return planOne(park, park.liftLine || null);
}
function planOne(park, LL) {
  // the line's place: clear of the park's right-hand fence and the floodlight towers 2.5 m outside it (env.js), the up
  // line's chairs at least 2.6 m from them, and the stations inside the groomed run
  const fR = park.fences && park.fences.length ? Math.max(...park.fences.map(f => Math.max(f[0], f[2]))) : 16.5;
  // (a map can give its own line: park.liftLine { x, top, bot }, the line's x and its two stations' line ends; Freeride's)
  const XL = LL ? LL.x : Math.max(36, Math.min(41, fR + 7.5)), xU = XL - HALF, xD = XL + HALF;
  // the floodlight poles on the lift's side of the park, where env.js makeLightTowers puts them (2.5 m outside the
  // right-hand fence, every 45 m from 10 m below the fences' top end): the chase camera keeps off them riding up
  const fz = park.fences && park.fences.length >= 2 ? park.fences : null;
  const lights = fz ? { x: Math.max(fz[0][0], fz[1][0]) + 2.5, z0: Math.min(fz[0][1], fz[1][1]) + 10, z1: Math.max(fz[0][3], fz[1][3]), S: 45 } : null;
  const lastMeet = Math.max(...park.kickers.map(k => k.zMeet || k.z0 || 0));
  const top = { front: LL ? LL.top : -45 }; top.z = top.front - ST.front;              // bull wheel z (the station runs from z - back to z + front)
  const bot = { front: LL ? LL.bot : lastMeet + 42 }; bot.z = bot.front + ST.front;
  // pads: x from the park side of the load line to past the down line; z over the station and a few metres round it
  const padOf = (z0, z1, uphillZ) => {
    const x0 = XL - 12, x1 = XL + 8;
    let lvl = -Infinity;
    for (let x = x0; x <= x1; x += 1) for (let z = z0; z <= z1; z += 1) lvl = Math.max(lvl, ground(x, z));
    return { x0, x1, z0, z1, y: lvl + 0.05 };
  };
  /* (a map's own line, Freeride's, 2026-11-08 second pass: the top pad ends a metre inside the station's front, so the
     snow falls away as the cable does leaving it; held level 3 m past it, the chairs went 0.2 to 0.4 m into the snow
     4 m out) */
  top.pad = padOf(top.z - ST.back - 3, top.front + (LL ? -1 : 3));
  bot.pad = padOf(bot.front - 2, bot.z + ST.back + 3);
  const pads = [top.pad, bot.pad];
  const padY = (x, z) => {
    let best = -Infinity;
    for (const p of pads) {
      const dx = x < p.x0 ? p.x0 - x : x > p.x1 ? x - p.x1 : 0, dz = z < p.z0 ? p.z0 - z : z > p.z1 ? z - p.z1 : 0;
      if (dx > 40 || dz > 40) continue;
      const d = Math.hypot(dx, dz);
      /* (past 10 m from the pad its side steepens smoothly, 45 degrees by 20 m out, 2026-11-08: at 20 degrees all the
         way, below a pad on a shoulder above a steep face, Freeride's, it stood over the face's top 40 m on and ended
         there in a 3 m step) */
      const y = d < PAD_ROUND ? p.y - PAD_SLOPE * d * d / (2 * PAD_ROUND) : p.y - PAD_SLOPE * (d - PAD_ROUND / 2) - (d > 10 ? 0.032 * (d - 10) * (d - 10) : 0);
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
  // (a map may say where a tower may stand, park.towerOk: Freeride's are kept off rock, chutes, features and their
  // aprons; then the spans are tried every 2 m)
  const ok = park.towerOk, dSpan = ok ? 2 : 4;
  for (let guard = 0; guard < 60; guard++) {
    const endS = { z: top.front, y: top.y };
    if (a.z - endS.z <= SPAN && clear(a, endS) && a !== sup[0]) { sup.push(endS); break; }
    /* the next tower: the longest span whose chairs clear the snow with a tower of the usual height; where the hill is
       convex under the line (a cliff band's lip, a roll: 2026-11-08, Freeride's lift goes up over its face) none may,
       and then the span that needs the shortest tall tower (its column stretched, up to TALL over its foot). Before,
       a line that found no clear span ran straight on to the top station, through the mountain. */
    let placed = null;
    const spans = [];
    for (let span = a === sup[0] ? 22 : SPAN; span >= 20; span -= dSpan) {
      const z = a.z - span; if (z < top.front + 18) continue;
      if (ok && !ok(XL, z)) continue;
      const g = height(XL, z); spans.push([z, g]);
      if (clear(a, { z, y: g + HC })) { placed = { z, y: g + HC, h: HC }; break; }
    }
    if (!placed) for (const [z, g] of spans) {
      let h = HC + 2; while (h <= TALL && !clear(a, { z, y: g + h })) h += 2;
      if (h <= TALL && (!placed || h < placed.h)) placed = { z, y: g + h, h };
    }
    // (nowhere a tower may stand within a span: a longer one, up to 120 m, to the next place one may)
    if (!placed && ok) for (let span = SPAN + 2; span <= 120; span += 2) {
      const z = a.z - span; if (z < top.front + 18) break;
      if (!ok(XL, z)) continue;
      const g = height(XL, z); let h = HC; while (h <= TALL && !clear(a, { z, y: g + h })) h += 2;
      if (h <= TALL) { placed = { z, y: g + h, h }; break; }
    }
    // (still nowhere: the map's looser rule, ok(x, z, false), within a span, the shortest tower that clears)
    if (!placed && ok) for (let span = SPAN; span >= 20; span -= 2) {
      const z = a.z - span; if (z < top.front + 18 || !ok(XL, z, false)) continue;
      const g = height(XL, z); let h = HC; while (h <= TALL && !clear(a, { z, y: g + h })) h += 2;
      if (h <= TALL && (!placed || h < placed.h)) placed = { z, y: g + h, h };
    }
    if (!placed) {            // (nothing clears: a short span with the tallest tower)
      const z = a.z - 20; if (z < top.front + 18) { sup.push(endS); break; }
      placed = { z, y: height(XL, z) + TALL, h: TALL };
    }
    towers.push({ x: XL, z: placed.z, y: height(XL, placed.z), h: placed.h });
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
  const colliders = towers.map(t => ({ x: t.x, z: t.z, r: t.h > HC ? 0.7 : 0.55, y: t.y, s: t.h + 2 }));
  // the stations' piers: the big one under the middle, the thin one at the line end
  for (const st of [top, bot]) {
    const dir = st === top ? 1 : -1;            // +1: the station's line end is down the hill (+z)
    colliders.push({ x: XL, z: st.z + dir * 2.0, r: 1.3, y: st.pad.y, s: 6 }, { x: XL, z: st.z + dir * 11.5, r: 0.4, y: st.pad.y, s: 6 });
  }
  // (2026-11-06) a lamp under each station's eave on the park side, over the load and unload lines, lit with the park's
  // lamps (env.js makeLightTowers reads park.stationLamps: rows of one)
  park.stationLamps = (park.stationLamps || []).concat([top, bot].map(st => ({ x0: XL - ST.half - 0.3, z0: st.front + (st === top ? -2 : 2), dx: 0, dz: 0, n: 1, ax: -1, az: 0, h: 4.2, power: 35 })));
  return { XL, xU, xD, top, bot, pads, towers, sup, cableY, px, py, pz, S, vel, tau, n, len, T, N, sLoad, sUnload, load, unload, seat, colliders, lights };
}

// a tower whose cable runs h m over its foot: the model's own (HC) with its column stretched, the head kept as it is
function tallTower(g0, h) {
  const g = g0.clone(); if (h <= HC + 0.01) return g;
  const e = h - HC, cut = 6.5, k = (cut + e) / cut, a = g.attributes.position.array;
  for (let i = 1; i < a.length; i += 3) a[i] = a[i] < cut ? a[i] * k : a[i] + e;
  return g;
}

// ---- the lift: meshes, the chairs' motion, and riding ---------------------------------------------------------------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _f = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sph = new THREE.Sphere();
const _cp = new THREE.Vector3(), _ct = new THREE.Vector3(), _cl = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);
const smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const _xg = new THREE.Vector3();      // (the express: another rider's chair's grip)

export class Lift {
  constructor(scene, plan, q) {
    // (a plan of several lifts: all of them, behind this same interface)
    if (plan && plan.multi) return new Lifts(scene, plan, q);
    this.scene = scene; this.plan = plan; this.q = q;
    const low = q.tier === 'low';
    this.nearR = low ? 75 : 170; this.farR = low ? 520 : 900;
    this.offset = 0;                   // seconds added to the wall clock (the ride made quicker, or held while paused alone)
    this.ride = null;                  // the rider's own ride: { phase, chair, t, ... }
    this.sit = 0; this.feet = new THREE.Vector3(); this.feetOn = false;   // for the pose (poseState: liftSit, liftFeet)
    // (one slot more than the chairs: N is the rider's own chair on an express ride)
    const N = plan.N, N1 = N + 1;
    this.s = new Float32Array(N1); this.v = new Float32Array(N1); this.cur = new Int32Array(N1);
    this.sw = new Float32Array(N1); this.swV = new Float32Array(N1); this.yaw = new Float32Array(N1);
    this.gx = new Float32Array(N1); this.gy = new Float32Array(N1); this.gz = new Float32Array(N1);
    this.hint = 0; this.ready = false;
    /* (2026-11-06, Leon: "make it so that pressing any button on the ski lift makes it go way faster so getting to the
       top takes like 4s".) Any key (but Esc, which opens the menu, and the camera key) or a tap on a touch button
       while on the lift: the rider's chair lets go of the cable and runs up the line on its own, overtaking the
       others, about 3.3 s from the bottom to the top station, where it slows in behind the chair just past the
       unload line and hands the rider to it (the express, update and place). The chairs everyone shares keep to the
       shared clock; the others see the rider's own chair under them (remoteSeat). Mouse moves and clicks never count:
       the mouse looks round on the chair. */
    this.pressed = false; this.camKey = 'KeyC';
    if (typeof addEventListener === 'function') {
      addEventListener('keydown', e => {
        if (e.repeat || e.code === 'Escape' || e.code === this.camKey || !this.ride) return;
        const t = e.target; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '')) return;
        this.pressed = true;
      });
      addEventListener('touchstart', e => {
        const b = this.ride && e.target && e.target.closest ? e.target.closest('#touch button') : null;
        if (b && !b.classList.contains('cam')) this.pressed = true;
      }, { passive: true, capture: true });
    }
  }
  // the clock every page shares
  clock() { return Date.now() / 1000 + this.offset; }

  /* (2026-11-08) the meshes: built into a kit (liftKit) that may be shared by several lifts (Lifts), so all the lifts on
     a map are still four draw calls: the chairs' two instanced meshes, the bull wheels, everything that never moves
     merged into one mesh, and the cables one line. A lift on its own makes its own kit. */
  async load(kit) {
    const own = !kit;
    if (own) { kit = await liftKit(this.q); kit.make(this.plan.N + 8, 2); kit.owner = this; }
    this.kit = kit; this.mat = kit.mat; this.band = kit.band;
    this.chNear = kit.chNear; this.chFar = kit.chFar; this.wheels = kit.wheels; this.wheelR = kit.wheelR;
    const P = this.plan, XL = P.XL;
    for (const st of [P.top, P.bot]) {
      // the station on its pad, the base under the snow, the up line on the park side (the model mirrored across);
      // the model's line end is +z: the top station faces down the hill as it is, the bottom one is turned round
      const m4 = new THREE.Matrix4().compose(_p.set(XL, st.y, st.z), _q.setFromAxisAngle(Y, st === P.top ? 0 : Math.PI), _v.set(-1, 1, 1));
      const g1 = kit.stG.clone().applyMatrix4(m4);
      // (mirrored, so each triangle's corners go the other way round to keep its front face outward)
      const ix = g1.index.array; for (let k = 0; k < ix.length; k += 3) { const t = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = t; }
      kit.parts.push(g1);
    }
    for (const t of P.towers) kit.parts.push(tallTower(kit.twG, t.h || HC).translate(t.x, t.y, t.z));
    const cable = this.cableMeshes();
    kit.tubes.push(cable.tube); kit.lines.push(cable.pts);
    if (own) kit.finish(this.scene);
    this.stillTris = kit.stillTris;
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
    this.tubeTris = idx.length / 3;
    return { tube: tg, pts };
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
  // the same by loop place s (metres round the loop) instead of loop time: the express chair (slot N)
  locateS(i, s) {
    const P = this.plan, S = P.S;
    s = ((s % P.len) + P.len) % P.len;
    let lo = 0, hi = P.n;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (S[mid] <= s) lo = mid; else hi = mid; }
    const k = lo, k1 = k + 1, f = (s - S[k]) / Math.max(1e-6, S[k1] - S[k]);
    this.gx[i] = P.px[k] + (P.px[k1] - P.px[k]) * f; this.gy[i] = P.py[k] + (P.py[k1] - P.py[k]) * f; this.gz[i] = P.pz[k] + (P.pz[k1] - P.pz[k]) * f;
    this.s[i] = s;
    const dx = P.px[k1] - P.px[k], dz = P.pz[k1] - P.pz[k];
    if (dx * dx + dz * dz > 1e-8) this.yaw[i] = Math.atan2(dx, dz);
  }
  // where on the loop (metres) a chair at loop time tau is
  sAtTau(tau) {
    const P = this.plan, T = P.tau;
    let lo = 0, hi = P.n;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T[mid] <= tau) lo = mid; else hi = mid; }
    return P.S[lo] + (P.S[lo + 1] - P.S[lo]) * (tau - T[lo]) / Math.max(1e-6, T[lo + 1] - T[lo]);
  }
  /* the express (see the constructor): the rider's chair lets go of the cable here and runs up to the top station, about
     3.3 s from the load line and less from further up; it is handed to the chair that will just have passed the unload
     line when it gets there (chairs are about 6.5 m apart in the station, so there is always one within a few metres) */
  startExpress(r) {
    const P = this.plan, N = P.N, gap = P.T / N, s0 = this.s[r.chair], left = P.sUnload - s0;
    if (left < 30 || r.chair >= N) return false;           // (nearly there anyway)
    const dur = Math.max(0.8, 3.3 * left / (P.sUnload - P.sLoad)), c0 = this.clock(), c1 = c0 + dur;
    let to = -1, best = Infinity;
    for (let k = 0; k < N; k++) {
      let tau = (c1 + k * gap) % P.T; if (tau < 0) tau += P.T;
      const d = this.sAtTau(tau) - (P.sUnload - 0.2);
      if (d >= 0 && d < best) { best = d; to = k; }
    }
    if (to < 0 || best > 15) return false;
    r.x = { c0, dur, s0, to, last: s0, k: 0, sw0: this.sw[r.chair] };
    // (slot N starts where the rider's chair is, so nothing jumps)
    this.gx[N] = this.gx[r.chair]; this.gy[N] = this.gy[r.chair]; this.gz[N] = this.gz[r.chair]; this.yaw[N] = this.yaw[r.chair];
    this.s[N] = s0; this.sw[N] = this.sw[r.chair]; this.v[N] = this.v[r.chair];
    r.chair = N;
    return true;
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
    // the rider's own chair on an express ride (slot N): from where it let go of the cable to the chair it hands the
    // rider to, eased in and out, on the lift's clock (so a slow frame or a pause never leaves it behind that chair)
    const X = this.ride && this.ride.x;
    if (X) {
      const k = Math.min(1, Math.max(0, (c - X.c0) / X.dur)), e = k * k * (3 - 2 * k);
      const s = X.s0 + (this.s[X.to] - X.s0) * e;
      this.locateS(N, s);
      this.v[N] = dt > 0 ? (s - X.last) / dt : 0; X.last = s;
      this.sw[N] = X.sw0 + (this.sw[X.to] - X.sw0) * e; X.k = k;
    }
    if (!camera) return;
    _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _f.setFromProjectionMatrix(_pm);
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const nr2 = this.nearR * this.nearR, fr2 = this.farR * this.farR, bn2 = (this.nearR - this.band) ** 2;
    const an = this.chNear.instanceMatrix.array, af = this.chFar.instanceMatrix.array;
    // (the kit's counts: several lifts write their chairs into the same two instanced meshes, one after another; the
    // kit's owner starts and ends the frame, kit.begin and kit.end)
    const K = this.kit, own = K.owner === this;
    if (own) K.begin();
    let nn = K.nn, nf = K.nf;
    for (let i = 0, n = X ? N + 1 : N; i < n; i++) {
      const x = this.gx[i], y = this.gy[i], z = this.gz[i];
      const d2 = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2;
      if (d2 > fr2) continue;
      _sph.center.set(x, y - 1.6, z); _sph.radius = 2.2;
      if (!_f.intersectsSphere(_sph)) continue;
      this.chairQ(i, _q); _p.set(x, y, z); _m.compose(_p, _q, _s);
      // (in the fade band both: the shader fades one into the other)
      if (d2 < nr2) { _m.toArray(an, nn * 16); nn++; }
      if (d2 > bn2) { _m.toArray(af, nf * 16); nf++; }
    }
    // other riders' chairs are their own chairs here too, so nothing more to draw for them (but for one on an express
    // ride: remoteSeat adds theirs after this)
    K.nn = nn; K.nf = nf; this.camAt = camera.position;
    // the bull wheels: the haul rope runs round them at line speed all the time (only the chairs let go of it and slow
    // down in the stations), so a wheel turns at V / HALF, about 36 turns a minute, on the lift's own clock (quicker
    // with Space held, stopped by a pause); the cable goes round both the same way seen from above
    const W = this.wheels, XL = P.XL;
    if (W) {
      let nw = K.nw;
      const a = -((c * V / HALF) % (Math.PI * 2)), wr2 = this.wheelR * this.wheelR, aw = W.instanceMatrix.array;
      for (const st of [P.top, P.bot]) {
        if ((XL - cx) ** 2 + (st.y - cy) ** 2 + (st.z - cz) ** 2 > wr2) continue;
        _sph.center.set(XL, st.y, st.z); _sph.radius = 3;
        if (!_f.intersectsSphere(_sph)) continue;
        _q.setFromAxisAngle(Y, a + (st === P.top ? 0 : Math.PI)); _p.set(XL, st.y, st.z); _m.compose(_p, _q, _s);
        _m.toArray(aw, nw * 16); nw++;
      }
      K.nw = nw;
    }
    if (own) K.end();
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
    return sk.p.x > pad.x0 && sk.p.x < this.plan.XL - 0.6 && sk.p.z > this.plan.bot.front - 16 && sk.p.z < L.z + 7 && sk.p.y < pad.y + 6;
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
    // put straight on the load line (the end of the run): the tripod at once, not a glide from the old place through
    // the station's housing
    this.cutIn = walk === 0;
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
    // a key or a tap on the lift (the constructor's listeners): the express up (startExpress), once the rider is on a
    // chair; riding alone, the next chair comes round quickly meanwhile
    if (g.camKey) this.camKey = g.camKey;
    if (R && this.pressed && g.live) R.rush = true;
    this.pressed = false;
    // the clock: riding alone, a pause holds the lift (and the express with it), and a chair waited for comes quickly;
    // in a room it is everyone's, so it is left alone (and put back if it was moved riding alone before)
    if (g.solo && R) {
      if (g.paused) this.offset -= dt;
      else if (R.rush && R.phase === 'wait' && g.live) this.offset += dt * 6;
    }
    if (!g.solo && !R && this.offset) this.offset = 0;
    if (R && R.rush && !R.x && R.phase === 'ride' && !this.startExpress(R)) R.rush = false;
    this.place(dt, g.camera);
    // (the express handed the rider to the shared chair: on with that one. Meanwhile the chase camera is put straight
    // behind the chair each frame: eased, it fell far behind a chair going a few hundred metres a second)
    if (R && R.x && R.x.k >= 1) { R.chair = R.x.to; R.x = null; }
    if (R && R.x && g.cams) g.cams.first = true;
    this.sounds(dt, g);
    // a ride ended elsewhere (Backspace, a reset, a new start): let go
    if (R && sk.state !== 'lift') { this.ride = null; this.sit = 0; this.feetOn = false; }
    if (!this.ride) {
      this.sit = 0; this.feetOn = false;
      if (g.live && sk.state === 'ground') {
        const near = this.nearLoad(sk, 34);
        if (near && this.hint <= 0) { g.hud && g.hud.flash((this.plan.name ? 'The ' + this.plan.name : 'The chairlift') + (this.plan.ends === false ? ': press E to ride it' : ': ski into the lift line (or press E)'), 2600); this.hint = 30; }
        this.hint -= dt;
        // (a lift whose bottom is half way down a run, ends false: only E takes it, so riders going past are not caught)
        if (this.plan.ends !== false && this.inLoadArea(sk) && sk.v.length() < 16) this.board(sk);
        else if (near && g.input && g.input.took && g.input.took('KeyE')) this.board(sk);
        if (this.ride && g.hud) g.hud.flash('Chairlift: press any key to go straight up', 2800);
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
      // (on the express no more than 30 m/s: it goes at hundreds, which would be a gale in the wind's sound and a silly readout)
      _v.set(0, 0, 1).applyAxisAngle(Y, this.yaw[i]).multiplyScalar(Math.min(30, this.v[i])); sk.v.copy(_v);
    }
    // going past a tower the chase camera swings out to the park side, clear of its head (camera(), as cams.orbitAuto
    // on top of the rider's own look, only while they are not looking round; camera.js adds the two). How far is the
    // tower's own (towerSwing): wide, for a clean view of the chair passing the tower from the side, unless a floodlight
    // pole stands where the swung camera would pass it; then just far enough to clear the head, on the lift's side of
    // the poles
    this.swing = 0;
    if (this.ride && this.ride.phase === 'ride') {
      const z = this.gz[i], sw = this.towerSwing || this.swings();
      for (let k = 0; k < P.towers.length; k++) { const d = z - P.towers[k].z; if (d > -8 && d < 12) { this.swing = sw[k]; break; } }
    }
    // looking round now: a turn key held, or the mouse moved in the last half second (lookMouse)
    this.looking = !!(g.live && g.I && g.I.steer) || (!!g.mouse && (this.lookIdle ?? 9) < 0.5);
    // the chair moved on a long way at once (the lift runs on the wall clock, so after the page was in the background):
    // the camera is put straight behind it rather than flying across the hill to catch up
    if (this.ride && this.ride.phase === 'ride') {
      const gz = this.gz[this.ride.chair];
      if (g.cams && this.lastGz !== undefined && Math.abs(gz - this.lastGz) > 30) g.cams.first = true;
      this.lastGz = gz;
    } else this.lastGz = undefined;
  }
  /* each tower's swing (radians, negative: the view turns right, the camera goes to the park side), worked out once.
     The chase camera rides 4.2 m behind the rider; swung 1.15 rad it passes 3.8 m out on the park side, which is where
     the floodlight poles stand (2.5 m outside the fence); swung just enough to pass 0.9 m clear of the head's end (3 m
     from the line's middle) it stays 1 m on the lift's side of them. The camera is swung from about 16 m before the
     tower to 13 m after it (the chair 12 m before to 8 m after, and the ease back). */
  swings() {
    const P = this.plan, XL = P.XL, Lt = P.lights, wide = -1.15, near = -Math.asin(Math.min(0.95, Math.max(0, P.load.x - (XL - 3.9)) / 4.2));
    this.towerSwing = P.towers.map(t => {
      if (!Lt || Math.abs(XL - 2.4 - Lt.x) > 6) return wide;
      for (let z = Lt.z0; z <= Lt.z1 + 1; z += Lt.S) if (z > t.z - 15 && z < t.z + 18) return near;
      return wide;
    });
    return this.towerSwing;
  }
  // the drive's hum near the stations and on a chair, and the clack of a grip running over a tower's sheaves near you
  sounds(dt, g) {
    const snd = g.sound; if (!snd || !snd.liftHum) return;
    const c = g.camera ? g.camera.position : g.skier.p, P = this.plan, XL = P.XL;
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
    if (!this.pz0) this.pz0 = new Float32Array(this.gz.length);
    this.pz0.set(this.gz);
  }
  // just set down at the top: the mouse scheme's pointer along the way off the ramp (main.js steers by it), and the
  // camera's tripod kept a moment as the rider skis off
  offLifted(g) {
    if (g.mouse && g.input) g.input.stick = Math.atan2(0.85, 0.53) / 1.66;
    this.after = 1.1; this.camShot = 'top';
  }
  // a point in or within m of a station's housing, anywhere from the snow up to its roof (the piers, the chairs going
  // round under it and the housing itself): 'top', 'bot' or ''
  inStation(p, m) {
    const XL = this.plan.XL;
    if (p.x < XL - ST.half - m || p.x > XL + ST.half + m) return '';
    const P = this.plan;
    if (p.z > P.top.z - ST.back - m && p.z < P.top.z + ST.front + m && p.y < P.top.y + ST.roof + m) return 'top';
    if (p.z > P.bot.z - ST.front - m && p.z < P.bot.z + ST.back + m && p.y < P.bot.y + ST.roof + m) return 'bot';
    return '';
  }
  /* The camera by the stations (main.js, after camera.js has placed it). A tripod beside a station, low on the park
     side, out of the housing and clear of its piers, takes over from the chase camera whenever that would be in a
     housing (skiing round a station, or skiing off at the top). It blends in and out of the chase camera, but never
     through a housing: a blend that would go in cuts instead, and so does a change of camera. Nothing here allocates.
     (2026-11-06, for "make it so that on the chairlift your camera does not change after each pole and stays the same
     throughout unless you rotate it using your cursor": on the chair, from the load line to the unload line, the chase
     camera is held in one place against the chair by camera.js (chair), inside the space the chair sweeps, so it no
     longer swings out past the towers and is not pushed about; the tripod takes over only while that camera would be
     in a housing (at the load line until the chair is out of the bottom station, and from the moment it reaches the top
     one, the express too); anything thin it passes close to when the rider has turned it round is left out by the near
     plane (clipNear), not by moving it.) */
  camera(dt, cam, cams, sk) {
    if (!this.ready) return;
    const P = this.plan, r = this.ride, mode = cams.mode, third = mode === 'chase' || mode === 'far';
    if (!r && this.after > 0) this.after -= dt;
    let on = false;
    // the chase camera in (or at) a housing: the tripod stays, or comes in (on the chair too: its own camera rides in
    // the space the chair sweeps, which takes it under the housings' roofs at the load and unload lines, and the camera
    // is never to be inside a housing; a cut, since a blend would go through it)
    if (third) {
      const inside = this.inStation(cams.pos, 0.6);
      if (inside) { this.camShot = inside; on = true; }
    }
    // a change of camera, or put straight on the load line: a cut
    if (mode !== this.camMode || this.cutIn) { this.camMode = mode; this.cutIn = false; this.camW = on ? 1 : 0; this.camLookOk = false; }
    // (no swing past the towers any more: camera.js reads no orbitAuto)
    cams.orbitAuto = 0;
    const clear = third && r && r.phase === 'ride';
    let w = this.camW = (this.camW || 0) + ((on ? 1 : 0) - (this.camW || 0)) * Math.min(1, dt * 2.4);
    // (on the chair, in and out of the tripod are cuts: blended, the view flew between the station and a chair already
    // far up the line on the express)
    if (r && third) w = this.camW = on ? 1 : 0;
    if (w < 0.003) { this.camW = 0; this.camLookOk = false; if (clear) this.clipNear(cam, sk); return; }
    // the tripod: at the bottom behind the load line (the rider, the chair coming round and the line going up the hill
    // ahead all in view), at the top up the hill from the unload line (the chair coming in, the rider skiing off)
    const top = this.camShot === 'top', st = top ? P.top : P.bot, spot = top ? P.unload : P.load;
    const pos = _cp.set(spot.x - (this.camDX ?? 8), st.pad.y + (this.camDY ?? 1.3), spot.z + (top ? (this.camDZt ?? -9) : (this.camDZ ?? 9)));
    // it looks at the rider: the hips on the chair, the middle of the body standing (it looked at the snow under a
    // chair still high over it coming in at the top)
    const tgt = _ct.set(sk.p.x, sk.p.y + (sk.state === 'lift' ? 0.45 : 1.0), sk.p.z + (top ? 0.5 : -1.5));
    if (!this.camLook) this.camLook = new THREE.Vector3();
    if (!this.camLookOk) { this.camLook.copy(tgt); this.camLookOk = true; } else this.camLook.lerp(tgt, Math.min(1, dt * 5));
    let k = w * w * (3 - 2 * w);
    _v.copy(cam.position).lerp(pos, k);
    // a blend that would pass through a housing: straight to whichever end it was going to
    if (k < 1 && this.inStation(_v, 0.6)) { w = this.camW = on ? 1 : 0; k = w; _v.copy(cam.position).lerp(pos, k); }
    if (k <= 0) { this.camLookOk = false; if (clear) this.clipNear(cam, sk); return; }
    cam.position.copy(_v);
    // (never under the snow on the way between the two: the top station's pad stands over the slope)
    const gy = height(cam.position.x, cam.position.z) + 0.8; if (cam.position.y < gy) cam.position.y = gy;
    // the eyes go to the rider quickly, while the camera itself moves over
    _cl.copy(cams.look).lerp(this.camLook, Math.min(1, k * 3));
    cam.up.set(0, 1, 0); cam.lookAt(_cl);
    cam.fov += ((this.camFov ?? 45) - cam.fov) * k; cam.updateProjectionMatrix();
  }
  /* What the chase camera riding the chair can come close to, once the rider has turned it round (camera.js chair: held
     behind the chair it rides inside the space the chair sweeps and meets nothing): a tower's column between the two
     lines, a tower's head, a floodlight pole on the park side, a chair coming down the other line. The camera is not
     moved for them (2026-11-06, Leon: the view "stays the same throughout"); the near plane is put just past the thing,
     so it is left out of the picture while it goes by, and never past the rider. Nothing allocated. */
  clipNear(cam, sk) {
    const P = this.plan, p = cam.position, r = this.ride;
    let need = 0;
    const post = (x, z, y0, y1, rad) => {
      if (p.y < y0 - 0.5 || p.y > y1 + 0.5) return;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < rad + 0.7) need = Math.max(need, d + rad + 0.3);
    };
    // (from each tower's own place, whichever way its line runs: a new map's lift lays them out its own way)
    for (const t of P.towers) {
      const tx = t.x ?? P.XL, h = Math.hypot(p.x - tx, p.z - t.z);
      if (h > 6) continue;
      const up = (t.h || HC) - HC;      // (a tall tower: its head that much higher)
      post(tx, t.z, t.y, t.y + 10.7 + up, 0.5);
      // (the head: the crossarm, the sheave trains and the gantry, within about 3.5 m of the tower, round the cable)
      const eh = Math.max(0, h - 3.5), ey = Math.max(0, t.y + up + HC - 0.5 - p.y, p.y - t.y - up - 10.9);
      // (the camera rides under it, a metre or so below the sheaves, as the chair's hanger does: it is left out within
      // 2.4 m while it goes over)
      const e = Math.hypot(eh, ey); if (e < 1.4) need = Math.max(need, 2.4);
    }
    const Lt = P.lights;
    if (Lt && Math.abs(p.x - Lt.x) < 2) {
      const nL = Math.floor((Lt.z1 - Lt.z0) / Lt.S), i = Math.max(0, Math.min(nL, Math.round((p.z - Lt.z0) / Lt.S))), pz = Lt.z0 + i * Lt.S;
      post(Lt.x, pz, height(Lt.x, pz), height(Lt.x, pz) + 14, 0.25);
    }
    // the chairs (any but the rider's own): from the grip down to the footrest, about 1.2 m either side of the hanger
    const mine = r ? r.chair : -1;
    for (let i = 0; i < P.N; i++) {
      if (i === mine || Math.abs(this.gz[i] - p.z) > 4 || Math.abs(this.gx[i] - p.x) > 4) continue;
      const ey = Math.max(0, this.gy[i] + CHAIR_BOTTOM - p.y, p.y - this.gy[i] - 0.3), ex = Math.max(0, Math.abs(this.gx[i] - p.x) - 1.25), ez = Math.max(0, Math.abs(this.gz[i] - p.z) - 0.5);
      const e = Math.hypot(ex, ey, ez); if (e < 0.7) need = Math.max(need, e + 1.6);
    }
    if (need <= cam.near) return;
    // never past the rider (their hips on the seat, less a metre)
    const lim = Math.hypot(p.x - sk.p.x, p.y - sk.p.y - 0.6, p.z - sk.p.z) - 1;
    const n = Math.min(need, lim);
    if (n > cam.near) { cam.near = n; cam.updateProjectionMatrix(); }
  }
  /* In the mouse scheme on the chair: the camera turns as the pointer moves (right looks right), the turn keys turn it
     too, all the way round, and it stays where it was turned (2026-11-06, Leon: the camera "stays the same throughout
     unless you rotate it using your cursor"; it used to drift back behind the chair 0.8 s after the mouse stopped).
     Only the pointer's movement since the last frame counts (input.stick is put back in the middle each frame, so it
     never runs out at an end, and the skis point straight ahead when you get off). The turn eases after the pointer
     over a few hundredths of a second, so a fast flick of the mouse still turns it smoothly. */
  lookMouse(cams, input, I, dt) {
    const d = input.stick + (I.steer ? I.steer * dt * 0.7 : 0);
    input.stick = 0;
    if (d) this.lookIdle = 0; else this.lookIdle = (this.lookIdle || 0) + dt;
    const o = cams.orbit || 0;
    if (this.lookT === undefined || Math.abs(Math.atan2(Math.sin(this.lookT - o), Math.cos(this.lookT - o))) > 1.5) this.lookT = o;
    this.lookT -= d * 2.4;
    const step = Math.atan2(Math.sin(this.lookT - o), Math.cos(this.lookT - o)) * Math.min(1, dt * 18);
    cams.orbit = Math.atan2(Math.sin(o + step), Math.cos(o + step));
    this.lookT = cams.orbit + Math.atan2(Math.sin(this.lookT - cams.orbit), Math.cos(this.lookT - cams.orbit));
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
    // (on the express the rider's own chair is no shared chair: the others draw it under them where they are)
    if (r.x) { x.le = 1; x.lc = r.x.to; }
  }
  remoteSeat(x, p, q, out) {
    if (!this.ready || !x || !x.lf) return null;
    out.sit = x.lf === 2 ? (typeof x.lt === 'number' ? x.lt : 1) : 0;
    if (x.lf === 2 && x.le) {
      // on the express: where they are (p and q, from their own page) on a chair of their own, its grip worked back from
      // the seat, drawn with this page's chairs
      out.feet = null;
      _v.set(SEATS[(x.ls | 0) & 3] ?? 0, SEAT_Y, SEAT_Z).applyQuaternion(q);
      this.extraChair(_xg.copy(p).sub(_v), q);
    } else if (x.lf === 2) {
      const i = x.lc | 0; if (i < 0 || i >= this.plan.N) return null;
      this.seatAt(i, (x.ls | 0) & 3, p, q);
      out.feet = null;
      // (standing up at the top: the skis on the platform under the seat)
      if (out.sit < 1) { out.feet = out.f || (out.f = new THREE.Vector3()); out.feet.set(p.x, height(p.x, p.z), p.z); }
    } else { out.feet = out.f || (out.f = new THREE.Vector3()); out.feet.set(p.x, p.y - 0.5, p.z); }
    return out;
  }
  // one more chair this frame, after place() (another rider's own chair on an express ride), if in view and room is left
  extraChair(grip, q) {
    const c = this.camAt; if (!c || !this.chNear) return;
    const d2 = grip.distanceToSquared(c); if (d2 > this.farR * this.farR) return;
    _sph.center.set(grip.x, grip.y - 1.6, grip.z); _sph.radius = 2.2;
    if (!_f.intersectsSphere(_sph)) return;
    _m.compose(grip, q, _s);
    for (const M of [d2 < this.nearR * this.nearR ? this.chNear : null, d2 > (this.nearR - this.band) ** 2 ? this.chFar : null]) {
      if (!M || M.count >= M.instanceMatrix.count) continue;
      _m.toArray(M.instanceMatrix.array, M.count * 16); M.count++;
      M.instanceMatrix.needsUpdate = true;
    }
  }

  // ---- collisions: towers and the stations' piers, as trees are (skier.trees) ------------------------------------------
  withTowers(forest, C = this.plan.colliders) {
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

/* ---- the kit: the model and the meshes every lift on a map shares (2026-11-08) ----------------------------------------
   The model loaded once; the chairs of every lift in the same two instanced meshes (detailed and coarse), the bull wheels
   in one more, everything that never moves (stations, towers, the cables' tubes) merged into one mesh, the cables far
   off one set of line segments, the shadow copies cut in 150 m squares. Each frame the owner (a Lift on its own, or
   Lifts) starts the counts (begin), every lift writes its chairs and wheels in view after the last (Lift.place), and the
   owner hands the counts to the meshes (end). */
async function liftKit(q) {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader(); draco.setDecoderPath('/car/vendor/three/addons/libs/draco/'); loader.setDRACOLoader(draco);
  const gltf = await loader.loadAsync('./models/lift/lift.glb?v=24');
  draco.dispose();
  const part = name => { let m = null; gltf.scene.traverse(o => { if (o.isMesh && o.name === name) m = o; }); if (!m) throw new Error('lift: no ' + name); return m; };
  const chair = part('chair'), chairLo = part('chair_lo'), tower = part('tower'), towerLo = part('tower_lo'), station = part('station'), bull = part('bull');
  const map = chair.material.map, low = q.tier === 'low';
  if (map) { map.anisotropy = low ? 1 : 4; map.colorSpace = THREE.SRGBColorSpace; }
  // one material for every part (the cable too: its uvs sit on a dark grey spot of the texture)
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.62, metalness: 0.25 });
  const geo = m => { const g = m.geometry; g.applyMatrix4(m.matrixWorld); return g; };
  gltf.scene.updateMatrixWorld(true);
  const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
  const nearR = low ? 75 : 170, band = low ? 12 : 20;
  /* (2026-11-06, for smoother distance changes: a chair swapped from the detailed model to the coarse one in one frame
     as it passed the near radius. Each now fades from one to the other over the last few metres, worked out from the
     camera on the graphics card: a fine dither, the two models taking turns at the pixels, so together they are
     always one whole chair. Each has its own copy of the material (the same program), which also stopped three.js
     looking the program up again on every draw where the two differed in taking shadows.) */
  const uChairFade = { value: new THREE.Vector2(nearR - band, nearR) };
  const fadeMat = far => {
    const m2 = mat.clone();
    m2.onBeforeCompile = s => {
      s.uniforms.uChairFade = uChairFade; s.uniforms.uChairFar = { value: far ? 1 : 0 };
      s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>
uniform vec2 uChairFade; uniform float uChairFar; varying float vChairK;`)
        .replace('#include <project_vertex>', `#include <project_vertex>
{
  float f = smoothstep(uChairFade.x, uChairFade.y, length(instanceMatrix[3].xyz - cameraPosition));
  vChairK = uChairFar > 0.5 ? f : 1.0 - f;
  if (vChairK < 0.002) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
}`);
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
uniform float uChairFar; varying float vChairK;
float cb2(vec2 p) { return 2.0 * abs(p.x - p.y) + p.y; }
float chairDither() { vec2 p = mod(floor(gl_FragCoord.xy), 4.0); return (4.0 * cb2(mod(p, 2.0)) + cb2(floor(p * 0.5)) + 0.5) / 16.0; }`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  if (vChairK < 0.999 && (uChairFar > 0.5 ? chairDither() >= vChairK : chairDither() < 1.0 - vChairK)) discard;`);
    };
    m2.customProgramCacheKey = () => 'chairfade';
    return m2;
  };
  const kit = {
    mat, band, nearR, owner: null, parts: [], tubes: [], lines: [], nn: 0, nf: 0, nw: 0, stillTris: 0,
    // (the towers: on the low tier a lighter copy, the same but for the ladder's rungs)
    stG: geo(station), twG: geo(low ? towerLo : tower), wheelR: low ? 110 : 190,
    // the instanced meshes, for n chairs and w bull wheels in all
    make(n, w) {
      this.chNear = new THREE.InstancedMesh(geo(chair), fadeMat(false), n);
      this.chFar = new THREE.InstancedMesh(geo(chairLo), fadeMat(true), n);
      for (const m of [this.chNear, this.chFar]) { m.frustumCulled = false; m.count = 0; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.matrixAutoUpdate = false; }
      this.chNear.castShadow = true; this.chNear.receiveShadow = !low;
      /* the bull wheels turn with the cable, so they are not in the merged mesh: one instanced mesh (one draw call, the
         chairs' own program, so no shader of its own), drawn only near the camera and in view. No shadow of their own:
         they turn under the housings' roofs, which shade them. (Not mirrored as the stations are: the wheel is round,
         and an instance turned inside out would show its back faces.) */
      this.wheels = new THREE.InstancedMesh(geo(bull), mat, w);
      this.wheels.frustumCulled = false; this.wheels.count = 0; this.wheels.visible = false; this.wheels.matrixAutoUpdate = false;
      this.wheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.wheels.castShadow = false; this.wheels.receiveShadow = !low;
    },
    begin() { this.nn = this.nf = this.nw = 0; },
    end() {
      this.chNear.count = this.nn; this.chFar.count = this.nf;
      if (this.nn) this.chNear.instanceMatrix.needsUpdate = true;
      if (this.nf) this.chFar.instanceMatrix.needsUpdate = true;
      this.wheels.count = this.nw; this.wheels.visible = this.nw > 0;
      if (this.nw) this.wheels.instanceMatrix.needsUpdate = true;
    },
    // everything that never moves into one mesh, its shadow copies, the cables' lines; into the scene
    finish(scene) {
      const group = this.group = new THREE.Group(); group.name = 'lift';
      /* (2026-11-06, the lag pass: the stations and towers cast their shadows from copies cut in 150 m pieces, drawn
         only into the sun's shadow map (layer 5, which only its camera sees; env.js): the merged mesh's bounds took in
         the whole line, so every frame all of it, 12 000 to 19 000 triangles, went into a shadow map that only covers
         the snow round the rider. Now only the piece or two near the rider does. The thin cable casts none: its shadow
         was narrower than the shadow map's texels.) */
      const pieces = new Map();
      for (const g0 of this.parts) {
        g0.computeBoundingBox(); const c = g0.boundingBox.getCenter(_v), key = Math.floor(c.x / 150) * 4096 + Math.floor(c.z / 150);
        const h = new THREE.BufferGeometry(); h.setAttribute('position', g0.attributes.position); if (g0.index) h.setIndex(g0.index);
        if (!pieces.has(key)) pieces.set(key, []); pieces.get(key).push(h);
      }
      // (E, 2026-11-09: drawn from both sides into the shadow map: the stations have open one-sided panels, which from
      // their backs alone left bright stripes through the shadow on the pad. Their sunny walls do not shade themselves
      // this way; the T-bar's huts did, so tbar.js keeps the backs)
      const shadowMat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
      for (const list of pieces.values()) {
        const g = mergeGeometries(list, false) || mergeGeometries(list.map(h => h.index ? h.toNonIndexed() : h), false); if (!g) continue;
        const sm = new THREE.Mesh(g, shadowMat); sm.layers.set(5); sm.castShadow = true; sm.matrixAutoUpdate = false; sm.name = 'lift shadow';
        g.computeBoundingSphere(); group.add(sm);
      }
      // (its own copy of the material: a plain mesh sharing the instanced chairs' material made three.js look its
      // program up again on every draw, twice a frame)
      const still = this.still = new THREE.Mesh(mergeGeometries([...this.parts, ...this.tubes], false), mat.clone());
      still.castShadow = false; still.receiveShadow = true; still.matrixAutoUpdate = false;
      this.stillTris = still.geometry.index.count / 3;
      // the cables far off: one set of segments for all of them (one draw call)
      const seg = [];
      for (const pts of this.lines) for (let i = 0; i < pts.length - 1; i++) seg.push(pts[i], pts[i + 1]);
      const line = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seg), new THREE.LineBasicMaterial({ color: 0x23262b }));
      line.matrixAutoUpdate = false;
      group.add(still, line, this.chNear, this.chFar, this.wheels);
      for (const m of [still, line, this.chNear, this.chFar, this.wheels]) m.updateMatrixWorld(true);
      scene.add(group);
      this.parts.length = 0; this.tubes.length = 0;
    },
  };
  return kit;
}

/* ---- several chairlifts behind the one lift interface (2026-11-08, for Leon's "add more ski lifts") ---------------------
   main.js calls load, ready, withTowers, pastBottom, boardNow, update, camera, lookMouse, netX, remoteSeat, sit, feet,
   feetOn on whatever its lift is; here each goes to the lift that has the rider (or to every lift, for the chairs going
   round and the cameras by the stations). The lifts share one kit, so three lifts are still four draw calls. In a room
   the state's x carries which lift (li) when it is not the first. */
export class Lifts {
  constructor(scene, plan, q) {
    this.scene = scene; this.q = q; this.plan = plan;
    this.lifts = plan.plans.map(p => new Lift(scene, p, q));
    this.ready = false;
  }
  async load() {
    const kit = await liftKit(this.q);
    kit.make(this.lifts.reduce((s, l) => s + l.plan.N + 8, 0), 2 * this.lifts.length);
    kit.owner = this;
    for (const l of this.lifts) await l.load(kit);
    kit.finish(this.scene);
    for (const l of this.lifts) l.stillTris = kit.stillTris;
    this.kit = kit; this.ready = true;
    return this;
  }
  // the lift with the rider on it (or walking to its load line), if any
  get active() { for (const l of this.lifts) if (l.ride) return l; return null; }
  get riding() { return !!this.active; }
  get sit() { const a = this.active; return a ? a.sit : 0; }
  get feet() { const a = this.active; return a ? a.feet : this.lifts[0].feet; }
  get feetOn() { const a = this.active; return a ? a.feetOn : false; }
  // the lift whose line is nearest a point (across the hill; below a lift's bottom, less so), and the one whose load
  // line is nearest
  // (only lifts whose bottom is where a run ends: the Peak Chair's is half way down a run, on the shoulder, ends false)
  nearestLine(p) { let b = this.lifts[0], d = Infinity; for (const l of this.lifts) { if (!l.plan.ends) continue; const e = Math.abs(p.x - l.plan.XL) + Math.max(0, p.z - l.plan.bot.z - 60) * 0.2; if (e < d) { d = e; b = l; } } return b; }
  nearestLoad(p) { let b = this.lifts[0], d = Infinity; for (const l of this.lifts) { if (!l.plan.ends) continue; const L = l.plan.load, e = Math.hypot(p.x - L.x, p.z - L.z); if (e < d) { d = e; b = l; } } return b; }
  pastBottom(p) { return this.nearestLine(p).pastBottom(p); }
  boardNow(sk) { return this.nearestLoad(sk.p).boardNow(sk); }
  update(dt, g) {
    if (!this.ready) return;
    this.kit.begin();
    for (const l of this.lifts) l.update(dt, g);
    this.kit.end();
  }
  camera(dt, cam, cams, sk) { for (const l of this.lifts) l.camera(dt, cam, cams, sk); }
  lookMouse(cams, input, I, dt) { (this.active || this.lifts[0]).lookMouse(cams, input, I, dt); }
  netX(x) { const a = this.active; if (!a) return; a.netX(x); const i = this.lifts.indexOf(a); if (i > 0) x.li = i; }
  remoteSeat(x, p, q, out) { const l = this.lifts[x ? x.li | 0 : 0]; return l ? l.remoteSeat(x, p, q, out) : null; }
  withTowers(forest) { return this.lifts[0].withTowers(forest, this.lifts.flatMap(l => l.plan.colliders)); }
  stats() { return this.lifts.map(l => Object.assign(l.stats(), { name: l.plan.name, x: l.plan.XL, top: l.plan.top.front, bot: l.plan.bot.front })); }
}
