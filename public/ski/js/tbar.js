/* The Jump Line's T-bar (2026-11-08, J, for Leon's "instead of a ski lift for the jumpline implement a tbar system and
   make sure graphics/animations all work"). A drag lift: one haul rope round two horizontal bull wheels, up the park
   side and back down the outside, on single steel columns with a crossarm and a sheave train for each line, as the
   Doppelmayr-style tube towers are built (reference photos in scratchpad ski8/J/assets/ref). Hangers are clamped to the
   rope every 13.5 m: a rod, the spring box, the cord it lets out, and the T (a stem with the crossbar). Empty, the cord
   is wound in and the T hangs just under its box; taken, the cord runs out and the bar pulls the rider up the groomed
   track on the snow. No openly licensed T-bar, hanger, spring box or surface-lift tower was found (a search of
   Sketchfab through Objaverse, Poly Pizza and the usual CC0 sites), so all of it is built here in code.

   Riding it: ski into the lift line at the bottom (or press E near it, or reach the end of the run): you shuffle to
   the loading point facing up the track, the next T comes from behind, you take it (the bar behind the legs, one hand
   on the stem), the cord runs out and you are pulled away; at the top you let go and ski off towards the start. Any key
   (but Esc and the camera key) or a tap on a touch button sends you up on your own, about 4 s from the bottom (the
   express, as on the chairlift). In a room each rider sends the hanger's number (net.js, the state's x) and the others
   put them under their own hanger of that number.

   Main.js uses it through the same interface as lift.js's chairlift: load, ready, withTowers, pastBottom, boardNow,
   update, camera, lookMouse, netX, remoteSeat, sit, feet, feetOn; and for the pose (main.js poseState): skier.liftKind
   'tbar' and this.pose { bar, axis, stem, hand, on, phase } (see scratchpad ski8/J/NOTES.md, the contract).

   Cheap to draw: six draw calls. Everything that never moves (towers, stations, the hut, the rope's tube) is one merged
   mesh; the rope far off is one line; the hangers are three instanced meshes (the rod and spring box, the cord, the T)
   whose matrices are written straight into their buffers each frame, only for hangers near the camera and in view;
   the two bull wheels one more. The stations and towers cast their shadows from copies cut in 150 m pieces drawn only
   into the sun's shadow map (layer 5), as the chairlift does. */
import * as THREE from 'three';
import { ground, height, normal } from './terrain.js?v=20';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ---- sizes (metres) ---------------------------------------------------------------------------------------------------
const G2 = 1.6;                       // half the gauge: each line to the column's middle
const ROD = 1.2, BOX = 0.5, STEM = 1.1, BAR = 1.1, CORD0 = 0.05, CORD_MAX = 3.4;   // a hanger, from the clamp down
const RETRACT = ROD + BOX + CORD0 + STEM;   // the clamp to the crossbar with the cord wound in
const H_TOWER = 6.3;                  // the rope over the snow at a tower's sheaves
const H_MIN = 4.5;                    // the least rope height over the track between towers
const H_LOAD = 5.0;                   // the rope over the snow at the loading and unloading points (the empty T at head height)
const SPAN = 72;                      // longest span between towers
const SAG = 0.00016;                  // rope sag: metres per metre squared of span
// ---- running ----------------------------------------------------------------------------------------------------------
const V = 4.5;                        // line speed (m/s; real T-bars run 2.5 to 3.5, a game wants it a little quicker)
const SP = 13.5;                      // metres between hangers along the rope (3 s)
const RAMP = 0.9;                     // seconds to get up to line speed once the cord takes the rider
const LAG = V * RAMP / 2;             // how far the clamp is ahead of the rider while towed (horizontally)
const EXPRESS = 4.0;                  // seconds from the bottom to the top on the express
/* where the bar is put for each ride (J's contract with R, B and S: change your own row if your pose wants the bar
   somewhere else): h the bar's middle over the snow, ahead along the track from skier.p (negative: behind), side the
   stem across from the rider's middle line (positive: on the rider's right, so the right hand holds it), grip how far
   up the stem the hand holds it */
export const TBAR_FIT = {
  ski: { h: 0.56, ahead: -0.21, side: 0.3, grip: 0.48 },   // (R, 2026-11-08: lower and back from 0.66 / -0.13: the cord's pull brought the bar 18 cm forward, through the thighs)
  board: { h: 0.6, ahead: -0.02, side: 0.3, grip: 0.4 },   // (B, 2026-11-08: back from 0.14: with the cord's pull the bar was 0.23 up the track, through the front thigh; now between the legs behind it)
  sled: { h: 0.45, ahead: 0.45, side: 0.25, grip: 0.35 },   // (B, 2026-11-08: nearer from 0.8: sat on the sled and leaning to it, the hand reached 0.35 m short of the stem)
  scoot: { h: 0.64, ahead: -0.33, side: 0.3, grip: 0.62 },   // (S, 2026-11-08: lower and back from 0.93 / -0.13, measured in the game: the bar was over the hips and in front of them, through the belly; now behind the upper thighs)
  bike: { h: 0.64, ahead: -0.45, side: 0.3, grip: 0.6 },    // (S: lower and back from 0.98 / -0.38: the bar was 0.44 m over the pelvis, through the back; now behind the low back just over the saddle)
};
const KINDS = ['ski', 'board', 'sled', 'scoot', 'bike'];
const HUT_TURN = Math.PI;              // (the hut model's windows face +x: turned to face the lift line, -x)
const smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const Y = new THREE.Vector3(0, 1, 0);

/* ---- the plan: where everything goes ----------------------------------------------------------------------------------
   Called with the park before the terrain is built (main.js). The line runs straight up the run's right-hand side
   (riding down), outside the park's right fence and E's floodlights 2.5 m outside it: the up line (the track) on the
   park side, the column between the two lines, the return line outside. The loading point is a little up the track
   from the bottom bull wheel, past the last landing; the unloading point a little short of the top wheel, beside the
   start. */
export function planTbar(park) {
  const fR = park.fences && park.fences.length ? Math.max(...park.fences.map(f => Math.max(f[0], f[2]))) : 22;
  const XU = fR + 6.5, XC = XU + G2, XD = XU + 2 * G2;
  const lastMeet = Math.max(...park.kickers.map(k => k.zMeet || k.z0 || 0), ...(park.rails || []).map(r => r.P[r.P.length - 1].z));
  const start = park.starts && park.starts[0] ? park.starts[0] : { x: 0, z: -30 };
  const zLoad = lastMeet + 46, zBot = zLoad + 8;          // the bottom wheel's middle 8 m down from the loading point
  const zUnload = start.z - 22, zTop = zUnload - 9;       // the top wheel's middle 9 m up from the unloading point
  const gLoad = ground(XU, zLoad), gUnload = ground(XU, zUnload);
  const bot = { z: zBot, y: gLoad + H_LOAD, g: ground(XC, zBot) };
  const top = { z: zTop, y: gUnload + H_LOAD, g: ground(XC, zTop) };
  // the rope's height over the snow under either line (the higher of the two) at z
  const gAt = z => Math.max(height(XU, z), height(XD, z));
  // the towers, from the bottom up: as long a span as keeps the rope at least H_MIN over the snow
  const sup = [{ z: bot.z, y: bot.y }], towers = [];
  const clear = (a, b) => {
    const L = a.z - b.z;
    for (let t = 0.04; t < 0.97; t += 0.04) {
      const z = a.z - L * t, y = a.y + (b.y - a.y) * t - 4 * SAG * L * L * t * (1 - t);
      if (y - gAt(z) < H_MIN) return false;
    }
    return true;
  };
  let a = sup[0];
  for (let guard = 0; guard < 60; guard++) {
    const endS = { z: top.z, y: top.y };
    if (a.z - endS.z <= SPAN + 10 && clear(a, endS)) { sup.push(endS); break; }
    let placed = null;
    for (let span = a === sup[0] ? 28 : SPAN; span >= 18; span -= 3) {
      const z = a.z - span; if (z < top.z + 18) continue;
      const c = { z, y: gAt(z) + H_TOWER };
      if (clear(a, c) || span <= 18) { placed = c; break; }
    }
    if (!placed) { sup.push(endS); break; }
    towers.push({ x: XC, z: placed.z, g: Math.min(ground(XC, placed.z), height(XC, placed.z)), y: placed.y });
    sup.push(placed); a = placed;
  }
  const ropeY = z => {
    for (let i = 0; i < sup.length - 1; i++) {
      const s0 = sup[i], s1 = sup[i + 1];
      if (z <= s0.z && z >= s1.z) { const L = s0.z - s1.z, t = (s0.z - z) / L; return s0.y + (s1.y - s0.y) * t - 4 * SAG * L * L * t * (1 - t); }
    }
    return z > sup[0].z ? sup[0].y : sup[sup.length - 1].y;
  };
  /* the loop: samples in the order the rope goes (round the bottom wheel by its back, up the park side, round the top
     wheel by its back, down the outside), each with its place and the way along (s) */
  const px = [], py = [], pz = [];
  const add = (x, y, z) => { px.push(x); py.push(y); pz.push(z); };
  const arc = (cz, cy, a0, a1, n) => { for (let i = 0; i <= n; i++) { const t = a0 + (a1 - a0) * i / n; add(XC + G2 * Math.cos(t), cy, cz + G2 * Math.sin(t)); } };
  arc(bot.z, bot.y, 0, Math.PI, 16);                                   // east to west round the bottom wheel (+z side)
  for (let z = bot.z - 1; z > top.z + 0.5; z -= 1) add(XU, ropeY(z), z);  // up the park side
  arc(top.z, top.y, Math.PI, 2 * Math.PI, 16);                         // west to east round the top wheel (-z side)
  for (let z = top.z + 1; z < bot.z - 0.5; z += 1) add(XD, ropeY(z), z);  // down the outside
  const n = px.length, S = new Float32Array(n + 1);
  for (let i = 1; i <= n; i++) { const j = i % n; S[i] = S[i - 1] + Math.hypot(px[j] - px[i - 1], py[j] - py[i - 1], pz[j] - pz[i - 1]); }
  const len = S[n], N = Math.max(8, Math.round(len / SP));
  px.push(px[0]); py.push(py[0]); pz.push(pz[0]);
  // loop places of the loading and unloading points (on the up line, which runs from s = 16 samples' arc on)
  const nUp = Math.floor(bot.z - 1 - (top.z + 0.5)) + 1;               // (the up line's samples: 17 .. 17 + nUp - 1)
  const sAtZ = z => { const f = Math.max(0, Math.min(nUp - 1.001, bot.z - 1 - z)), i = Math.floor(f); return S[17 + i] + (S[18 + i] - S[17 + i]) * (f - i); };
  const sOn = sAtZ(zLoad), sOff = sAtZ(zUnload);
  const colliders = towers.map(t => ({ x: t.x, z: t.z, r: 0.42, y: t.g, s: 7 }));
  // the bottom and top masts (under the wheels' middles) and the hut beside the lift line
  colliders.push({ x: XC, z: bot.z, r: 0.5, y: bot.g, s: 6 }, { x: XC, z: top.z, r: 0.5, y: top.g, s: 6 });
  const hut = { x: XD + 4.2, z: zLoad + 2, g: ground(XD + 4.2, zLoad + 2) };
  colliders.push({ x: hut.x, z: hut.z, r: 1.8, y: hut.g, s: 3.5 });
  const motor = { x: XD + 3.2, z: top.z - 1, g: ground(XD + 3.2, top.z - 1) };
  colliders.push({ x: motor.x, z: motor.z, r: 1.8, y: motor.g, s: 3.5 });
  park.hasLift = true;                 // (world.js makeProps leaves its old placeholder lift out)
  // a lamp over the loading and unloading points (env.js makeLightTowers reads park.stationLamps: rows of one)
  park.stationLamps = [{ x0: XU - 1.5, z0: zLoad, dx: 0, dz: 0, n: 1, ax: 1, az: 0, h: 4.5, power: 30 }, { x0: XU - 1.5, z0: zUnload, dx: 0, dz: 0, n: 1, ax: 1, az: 0, h: 4.5, power: 30 }];
  return { tbar: true, XU, XC, XD, bot, top, zLoad, zUnload, towers, sup, ropeY, px, py, pz, S, n, len, N, sOn, sOff, sAtZ, colliders, hut, motor,
    load: { x: XU - TBAR_FIT.ski.side, z: zLoad }, unload: { x: XU - TBAR_FIT.ski.side, z: zUnload } };
}

// ---- building in code: vertex-coloured boxes and tubes ------------------------------------------------------------------
class Geo {
  constructor() { this.p = []; this.n = []; this.c = []; this.i = []; }
  v(x, y, z, nx, ny, nz, c) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.c.push(c.r, c.g, c.b); return this.p.length / 3 - 1; }
  // a box of half sizes hx, hy, hz about centre (cx, cy, cz), turned by m (a Matrix3 or null)
  box(cx, cy, cz, hx, hy, hz, c, m = null) {
    const F = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], v = new THREE.Vector3(), nn = new THREE.Vector3();
    for (const [ax, ay, az] of F) {
      const u = ay ? [1, 0, 0] : [0, 1, 0], w = [ay * u[2] - az * u[1], az * u[0] - ax * u[2], ax * u[1] - ay * u[0]], base = this.p.length / 3;
      nn.set(ax, ay, az); if (m) nn.applyMatrix3(m).normalize();
      for (const [s, t] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        v.set((ax + u[0] * s + w[0] * t) * hx, (ay + u[1] * s + w[1] * t) * hy, (az + u[2] * s + w[2] * t) * hz);
        if (m) v.applyMatrix3(m);
        this.v(cx + v.x, cy + v.y, cz + v.z, nn.x, nn.y, nn.z, c);
      }
      this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  // a tube from a to b, radius r, k sides (capped when cap)
  tube(a, b, r, k, c, cap = true, r2 = r) {
    const d = new THREE.Vector3().subVectors(b, a), L = d.length(); d.divideScalar(L);
    const e1 = new THREE.Vector3().crossVectors(d, Math.abs(d.y) < 0.9 ? Y : new THREE.Vector3(1, 0, 0)).normalize(), e2 = new THREE.Vector3().crossVectors(d, e1);
    const base = this.p.length / 3;
    for (let i = 0; i <= k; i++) {
      const t = i / k * Math.PI * 2, cx = Math.cos(t), sx = Math.sin(t);
      const nx = e1.x * cx + e2.x * sx, ny = e1.y * cx + e2.y * sx, nz = e1.z * cx + e2.z * sx;
      this.v(a.x + nx * r, a.y + ny * r, a.z + nz * r, nx, ny, nz, c);
      this.v(b.x + nx * r2, b.y + ny * r2, b.z + nz * r2, nx, ny, nz, c);
    }
    for (let i = 0; i < k; i++) { const q = base + i * 2; this.i.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
    if (cap) for (const [p, s, rr] of [[a, -1, r], [b, 1, r2]]) {
      const m0 = this.v(p.x, p.y, p.z, d.x * s, d.y * s, d.z * s, c), b0 = this.p.length / 3;
      for (let i = 0; i <= k; i++) { const t = i / k * Math.PI * 2, nx = e1.x * Math.cos(t) + e2.x * Math.sin(t), ny = e1.y * Math.cos(t) + e2.y * Math.sin(t), nz = e1.z * Math.cos(t) + e2.z * Math.sin(t); this.v(p.x + nx * rr, p.y + ny * rr, p.z + nz * rr, d.x * s, d.y * s, d.z * s, c); }
      for (let i = 0; i < k; i++) if (s > 0) this.i.push(m0, b0 + i, b0 + i + 1); else this.i.push(m0, b0 + i + 1, b0 + i);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere();
    return g;
  }
}
const col = h => new THREE.Color(h).convertSRGBToLinear();
const C = { steel: col(0x7f8a86), dark: col(0x2c3034), rope: col(0x1d1f22), pad: col(0xe8641c), box: col(0xf0b51e), wood: col(0x8a5a36), roof: col(0x3d4247),
  stem: col(0xb9bec2), bar: col(0x2a2d31), concrete: col(0x9a9a94), wheel: col(0x5a6066), glass: col(0x283340), white: col(0xe9ece9) };

// one hanger's three parts, each in its own frame (see placeHanger)
function hangerParts(low) {
  // the clamp on the rope, the rod down from it and the spring box (its local -y down the hanger, +z the way it goes)
  const rb = new Geo();
  rb.box(0, -0.06, 0, 0.05, 0.08, 0.13, C.dark);                      // the clamp's jaws round the rope
  rb.tube(new THREE.Vector3(0, -0.1, 0), new THREE.Vector3(0, -ROD, 0), 0.02, low ? 4 : 6, C.steel, false);
  rb.box(0, -ROD - BOX / 2, 0, 0.11, BOX / 2, 0.15, C.box);           // the spring box (yellow, as most are painted)
  rb.box(0, -ROD - BOX + 0.03, 0, 0.05, 0.03, 0.05, C.dark);          // the cord's outlet under it
  // the cord: a unit length down local -y, scaled to how far it is run out
  const cd = new Geo();
  cd.tube(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -1, 0), 0.009, 3, C.rope, false);
  // the T: its local origin the crossbar's middle, the stem up local +y, the crossbar along local x
  const t = new Geo();
  t.tube(new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(0, STEM, 0), 0.022, low ? 5 : 7, C.stem, true);
  t.box(0, STEM - 0.02, 0, 0.03, 0.04, 0.03, C.dark);                 // the eye the cord is tied to
  // the crossbar: a slightly bent tube with rubber grips at its ends, bent forward at its middle (towards the pull)
  for (const s of [-1, 1]) {
    t.tube(new THREE.Vector3(0, 0, 0), new THREE.Vector3(s * BAR / 2, 0.03, -0.015), 0.024, low ? 5 : 7, C.bar, true);
  }
  t.box(0, 0.03, 0, 0.045, 0.05, 0.035, C.dark);                       // where the stem meets the bar
  return { rb: rb.geometry(), cd: cd.geometry(), t: t.geometry() };
}

// a bull wheel: a flat ring with spokes, lying flat, its middle at the origin
function wheelGeo(low) {
  const g = new Geo(), k = low ? 14 : 22, R = G2;
  for (let i = 0; i < k; i++) {
    const a0 = i / k * Math.PI * 2, a1 = (i + 1) / k * Math.PI * 2;
    const p0 = new THREE.Vector3(Math.cos(a0) * R, 0, Math.sin(a0) * R), p1 = new THREE.Vector3(Math.cos(a1) * R, 0, Math.sin(a1) * R);
    g.tube(p0, p1, 0.09, 4, C.wheel, false);
  }
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; g.tube(new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R), 0.035, 4, C.wheel, false); }
  g.tube(new THREE.Vector3(0, -0.12, 0), new THREE.Vector3(0, 0.12, 0), 0.22, 8, C.dark, true);
  return g.geometry();
}

// ---- the lift --------------------------------------------------------------------------------------------------------
const _m = new THREE.Matrix4(), _m3 = new THREE.Matrix3(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _f = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sph = new THREE.Sphere(), _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3();
const _hc = new THREE.Vector3(), _hd = new THREE.Vector3(), _hb = new THREE.Vector3(), _hx = new THREE.Vector3(), _hu = new THREE.Vector3();

export class Tbar {
  constructor(scene, plan, q) {
    this.scene = scene; this.plan = plan; this.q = q; this.kind = 'tbar';
    const low = q.tier === 'low';
    this.hangR = low ? 240 : 420;      // hangers drawn this near the camera
    this.offset = 0;                   // seconds added to the wall clock (the express, or held while paused alone)
    this.ride = null;
    this.sit = 0; this.feet = new THREE.Vector3(); this.feetOn = false;
    // the pose (main.js poseState: tbar); its vectors are this lift's own, changed every frame
    this.pose = { bar: new THREE.Vector3(), axis: new THREE.Vector3(1, 0, 0), stem: new THREE.Vector3(), hand: 'R', on: 0, phase: 'wait' };
    this.hint = 0; this.ready = false;
    // (as the chairlift: any key but Esc and the camera key, or a tap on a touch button but the camera's, while on it: the express)
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
  clock() { return Date.now() / 1000 + this.offset; }

  async load() {
    const P = this.plan, low = this.q.tier === 'low';
    const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
    const mat = this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2 });
    const hmat = this.hmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.25 });
    /* (the hangers fade out from about 0.95 m to 0.5 m from the camera, on a fine dither: in first person the rider's own T's
       stem and cord pass 0.3 m from the eyes and would fill a quarter of the view) */
    hmat.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
varying vec3 vTbW;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  vTbW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
  vTbW = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vTbW;
float tbDither() { vec2 p = mod(floor(gl_FragCoord.xy), 4.0); float a = 2.0 * abs(mod(p.x, 2.0) - mod(p.y, 2.0)) + mod(p.y, 2.0); vec2 q = floor(p * 0.5); float b = 2.0 * abs(q.x - q.y) + q.y; return (4.0 * a + b + 0.5) / 16.0; }`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  if (tbDither() > smoothstep(0.5, 0.95, distance(vTbW, cameraPosition))) discard;`);
    };
    hmat.customProgramCacheKey = () => 'tbarnear';
    // ---- everything that never moves
    const still = new Geo(), sh = [];
    const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
    // the towers: a steel column leaning a little up the hill (as the rope pulls), an orange pad round its foot, a
    // crossarm over both lines and under each end a sheave train (a beam with four small wheels the rope runs on)
    for (const t of P.towers) {
      const g = new Geo(), ry = P.ropeY(t.z), top = ry + 0.34, foot = v3(t.x, t.g - 0.4, t.z + 0.25), head = v3(t.x, top, t.z - 0.12);
      g.tube(foot, head, 0.17, low ? 6 : 9, C.steel, true);
      g.tube(v3(t.x, t.g - 0.3, t.z + 0.25), v3(t.x, t.g + 1.7, t.z + 0.2), 0.36, low ? 7 : 10, C.pad, true);
      g.box(t.x, t.g - 0.15, t.z + 0.25, 0.55, 0.25, 0.55, C.concrete);
      g.box(t.x, top + 0.06, t.z - 0.12, G2 + 0.35, 0.09, 0.1, C.steel);   // the crossarm
      for (const x of [P.XU, P.XD]) {
        g.box(x, top - 0.12, t.z - 0.12, 0.05, 0.12, 0.08, C.dark);         // the hanger from the arm
        g.box(x + 0.09, ry + 0.07, t.z, 0.035, 0.07, 0.85, C.dark);         // the train's beam beside the rope
        if (!low) for (let k = -1.5; k <= 1.5; k++) g.tube(v3(x + 0.03, ry - 0.04, t.z + k * 0.42), v3(x - 0.03, ry - 0.04, t.z + k * 0.42), 0.06, 8, C.wheel, true);
      }
      still.p.push(...g.p); still.n.push(...g.n); still.c.push(...g.c);
      const b0 = still.p.length / 3 - g.p.length / 3; for (const i of g.i) still.i.push(b0 + i);
      sh.push({ z: t.z, g });
    }
    // the lift line at the bottom: short posts with an orange band, a lane on the park side of the track funnelling into
    // the loading point (and a second rail between the track and the station's mast)
    {
      const g = new Geo();
      for (const [x, z0, z1] of [[P.XU - 2.6, P.zLoad - 1, P.zLoad + 15], [P.XU + 1.0, P.zLoad + 1, P.zLoad + 7]]) {
        let last = null;
        for (let z = z0; z <= z1 + 0.01; z += 2) {
          const y = height(x, z);
          g.tube(v3(x, y - 0.2, z), v3(x, y + 1.0, z), 0.035, low ? 4 : 6, C.dark, true);
          if (last) {
            const ym = (y + last.y) / 2;
            g.box(x, ym + 0.82, (z + last.z) / 2, 0.015, 0.13, 1.0, C.pad);
          }
          last = { y, z };
        }
      }
      still.p.push(...g.p); still.n.push(...g.n); still.c.push(...g.c);
      const b0 = still.p.length / 3 - g.p.length / 3; for (const i of g.i) still.i.push(b0 + i);
    }
    // the stations: a steel mast under each bull wheel's middle with a frame over the wheel, the top one with its drive
    // house beside it (the motor and the wheel's gearbox), the bottom one with the tension weight's box
    for (const [st, isTop] of [[P.bot, false], [P.top, true]]) {
      const g = new Geo(), x = P.XC, wy = st.y;
      g.box(x, st.g - 0.2, st.z, 0.8, 0.35, 0.8, C.concrete);
      g.box(x, (st.g + wy + 0.6) / 2, st.z, 0.32, (wy + 0.6 - st.g) / 2, 0.32, C.steel);       // the mast
      g.box(x, wy + 0.42, st.z, 0.6, 0.22, 0.6, C.dark);                                         // the wheel's bearing and gearbox
      g.box(x, wy + 0.7, st.z, G2 + 0.5, 0.07, 0.18, C.steel);                                   // a frame over the wheel
      g.box(x, wy + 0.7, st.z, 0.18, 0.07, G2 + 0.5, C.steel);
      if (!isTop) g.box(x, wy - 1.2, st.z + 1.0, 0.45, 0.6, 0.35, C.dark);                       // the tension weight
      still.p.push(...g.p); still.n.push(...g.n); still.c.push(...g.c);
      const b0 = still.p.length / 3 - g.p.length / 3; for (const i of g.i) still.i.push(b0 + i);
      sh.push({ z: st.z, g });
    }
    /* the operators' huts at the bottom and the top, beside the lift line: "Ticket Booth" by daedaljs (Sketchfab, CC BY
       4.0; models/tbar/hut.glb, its parts merged into one mesh of vertex colours, its normal map left out: CREDITS.md),
       its windows to the line; merged into this mesh, so no draw call of its own. Should it not load, a plain hut built
       here stands in. */
    let hutG = null;
    try { const gl = await new GLTFLoader().loadAsync('./models/tbar/hut.glb?v=20'); gl.scene.traverse(o => { if (o.isMesh && !hutG) hutG = o.geometry; }); }
    catch (e) { console.warn('tbar hut', e); }
    const extra = [];
    for (const [h, w, d, wall] of [[P.hut, 1.3, 1.6, C.wood], [P.motor, 1.5, 2.0, C.white]]) {
      if (hutG) {
        const g2 = hutG.clone();
        g2.applyMatrix4(new THREE.Matrix4().compose(_p.set(h.x, h.g - 0.08, h.z), _q.setFromAxisAngle(Y, HUT_TURN), _s.set(0.85, 0.85, 0.85)));
        extra.push(g2);
        const sg = new Geo(); sg.box(h.x, h.g + 1.4, h.z, 1.6, 1.4, 1.4, C.white); sh.push({ z: h.z, g: sg });
        continue;
      }
      const g = new Geo(), hgt = 2.3;
      g.box(h.x, h.g + hgt / 2 - 0.3, h.z, w, hgt / 2 + 0.3, d, wall);
      g.box(h.x - w - 0.01, h.g + 1.3, h.z, 0.02, 0.4, d * 0.5, C.glass);                     // the window to the line
      // the roof: two boards falling from the ridge (along z) to the eaves
      for (const s2 of [-1, 1]) {
        const a = 0.5, half = w * 0.62;
        _m3.set(Math.cos(a), s2 * Math.sin(a), 0, -s2 * Math.sin(a), Math.cos(a), 0, 0, 0, 1);
        g.box(h.x + s2 * half * Math.cos(a), h.g + hgt + 0.4 - half * Math.sin(a), h.z, half, 0.06, d + 0.3, C.roof, _m3);
      }
      still.p.push(...g.p); still.n.push(...g.n); still.c.push(...g.c);
      const b0 = still.p.length / 3 - g.p.length / 3; for (const i of g.i) still.i.push(b0 + i);
      sh.push({ z: h.z, g });
    }
    // the rope: a thin tube along the loop (and a line for far off)
    const rope = new Geo(), pts = [];
    for (let i = 0; i <= P.n; i += 1) {
      const last = pts[pts.length - 1];
      if (!last || i === P.n || Math.hypot(P.px[i] - last.x, P.pz[i] - last.z) > 2.9 || Math.abs(P.px[i] - last.x) > 0.01) pts.push(v3(P.px[i], P.py[i] + 0.02, P.pz[i]));
    }
    for (let i = 0; i < pts.length - 1; i++) rope.tube(pts[i], pts[i + 1], 0.016, 3, C.rope, false);
    const merged = mergeGeometries([still.geometry(), rope.geometry(), ...extra], false);
    const stillM = this.still = new THREE.Mesh(merged, mat);
    stillM.castShadow = false; stillM.receiveShadow = true; stillM.matrixAutoUpdate = false; stillM.name = 'tbar';
    this.stillTris = merged.index.count / 3;
    const line = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts.flatMap((p, i) => i ? [pts[i - 1], p] : [])), new THREE.LineBasicMaterial({ color: 0x23262b }));
    line.matrixAutoUpdate = false;
    const group = this.group = new THREE.Group(); group.name = 'tbar';
    // (the shadow copies: 150 m pieces, layer 5)
    const pieces = new Map(), shadowMat = new THREE.MeshBasicMaterial({ colorWrite: false });
    for (const { z, g } of sh) { const k = Math.floor(z / 150); if (!pieces.has(k)) pieces.set(k, []); pieces.get(k).push(g.geometry()); }
    for (const list of pieces.values()) {
      const g = mergeGeometries(list.map(x => { const h = new THREE.BufferGeometry(); h.setAttribute('position', x.attributes.position); h.setIndex(x.index); return h; }), false);
      const sm = new THREE.Mesh(g, shadowMat); sm.layers.set(5); sm.castShadow = true; sm.matrixAutoUpdate = false; sm.name = 'tbar shadow';
      g.computeBoundingSphere(); group.add(sm);
    }
    // ---- the hangers: three instanced meshes, the bull wheels one more
    const H = hangerParts(low), M = P.N + 1 + 16;
    this.rb = new THREE.InstancedMesh(H.rb, hmat, M); this.cd = new THREE.InstancedMesh(H.cd, hmat, M); this.tt = new THREE.InstancedMesh(H.t, hmat, M);
    this.wh = new THREE.InstancedMesh(wheelGeo(low), hmat, 2);
    for (const m of [this.rb, this.cd, this.tt, this.wh]) { m.frustumCulled = false; m.count = 0; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.matrixAutoUpdate = false; m.receiveShadow = !low; }
    // (the T and its box cast a shadow on the snow round the rider; not on the low tier)
    this.rb.castShadow = this.tt.castShadow = !low;
    group.add(stillM, line, this.rb, this.cd, this.tt, this.wh);
    for (const o of group.children) o.updateMatrixWorld(true);
    this.scene.add(group);
    this.place(0, null);
    this.ready = true;
    return this;
  }

  // the rope at loop place s: its point (out) and the way it goes (dir, horizontal, unit)
  ropeAt(s, out, dir) {
    const P = this.plan;
    s = ((s % P.len) + P.len) % P.len;
    let lo = 0, hi = P.n;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (P.S[mid] <= s) lo = mid; else hi = mid; }
    const k = lo, k1 = k + 1, f = (s - P.S[k]) / Math.max(1e-6, P.S[k1] - P.S[k]);
    out.set(P.px[k] + (P.px[k1] - P.px[k]) * f, P.py[k] + (P.py[k1] - P.py[k]) * f, P.pz[k] + (P.pz[k1] - P.pz[k]) * f);
    if (dir) { dir.set(P.px[k1] - P.px[k], 0, P.pz[k1] - P.pz[k]); if (dir.lengthSq() < 1e-10) dir.set(0, 0, -1); dir.normalize(); }
    return out;
  }
  // hanger i's loop place now
  sOf(i, c = this.clock()) { const P = this.plan; return ((c * V + i * (P.len / P.N)) % P.len + P.len) % P.len; }
  // the hanger whose clamp next reaches loop place s at least `lead` seconds from now: { i, wait }
  nextTo(s, lead) {
    const P = this.plan, c = this.clock(), gap = P.len / P.N;
    let best = -1, bw = Infinity;
    for (let i = 0; i < P.N; i++) { let w = ((s - this.sOf(i, c)) % P.len + P.len) % P.len / V; if (w >= lead && w < bw) { bw = w; best = i; } }
    return { i: best, wait: bw, gap };
  }

  /* one hanger's three parts into the instance buffers at slot k: the clamp C (on the rope), the T's crossbar middle B, the
     way the bar lies (ax, horizontal unit) and the stem's direction u (unit, from B up) */
  putHanger(k, Cl, B, ax, u) {
    // the T: local y along u, x along the bar
    _by.copy(u); _bx.copy(ax).addScaledVector(u, -ax.dot(u)).normalize(); _bz.crossVectors(_bx, _by);
    _m.makeBasis(_bx, _by, _bz).setPosition(B); _m.toArray(this.tt.instanceMatrix.array, k * 16);
    // the stem's top, then the rod and box hanging from the clamp towards it, then the cord between them
    _a.copy(B).addScaledVector(u, STEM);
    _d.subVectors(Cl, _a); const L = _d.length(); _d.divideScalar(Math.max(1e-4, L));   // (unit, from the stem's top up to the clamp)
    _by.copy(_d); _bz.copy(ax).cross(_by).normalize(); if (_bz.lengthSq() < 0.5) _bz.set(0, 0, 1); _bx.crossVectors(_by, _bz);
    _m.makeBasis(_bx, _by, _bz).setPosition(Cl); _m.toArray(this.rb.instanceMatrix.array, k * 16);
    const cl = Math.max(0.02, L - ROD - BOX);
    _e.copy(Cl).addScaledVector(_d, -(ROD + BOX));
    _m.makeBasis(_bx, _by, _bz); _m.scale(_s.set(1, cl, 1)); _m.setPosition(_e); _m.toArray(this.cd.instanceMatrix.array, k * 16);
  }
  // an empty hanger at rope point Cl going the way dir: hanging straight down, swaying a little, the bar across the line
  putEmpty(k, Cl, dir, sway) {
    _hd.set(Math.sin(sway) * dir.x * 0.6, -1, Math.sin(sway) * dir.z * 0.6).normalize();  // down the hanger, swung along the line
    _hb.copy(Cl).addScaledVector(_hd, RETRACT);
    _hx.set(-dir.z, 0, dir.x);                                                          // across the line
    this.putHanger(k, Cl, _hb, _hx, _hu.copy(_hd).negate());
  }

  // every hanger in view, the wheels, and the rider's own (and others', remoteSeat, after) loaded ones
  place(dt, camera) {
    const P = this.plan, N = P.N, c = this.clock();
    if (!camera) { this.rb.count = this.cd.count = this.tt.count = 0; return; }
    _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _f.setFromProjectionMatrix(_pm);
    const cp = camera.position, r2 = this.hangR * this.hangR, R = this.ride;
    const mine = R && !R.x && R.phase !== 'walk' && R.phase !== 'wait' ? R.hanger : -1;
    let k = 0;
    for (let i = 0; i < N; i++) {
      if (i === mine) continue;
      const s = this.sOf(i, c);
      this.ropeAt(s, _hc, _c);
      if (_hc.distanceToSquared(cp) > r2) continue;
      _sph.center.set(_hc.x, _hc.y - 1.5, _hc.z); _sph.radius = 1.9;
      if (!_f.intersectsSphere(_sph)) continue;
      this.putEmpty(k++, _hc, _c, 0.06 * Math.sin(c * 1.7 + i * 2.3));
    }
    // the rider's own hanger, as the ride put it (update)
    if (mine >= 0 || (R && R.x)) { const H = this.pose; this.putHanger(k++, this.rideClamp, H.bar, H.axisBar, this.rideU); }
    this.rb.count = this.cd.count = this.tt.count = k;
    if (k) for (const m of [this.rb, this.cd, this.tt]) m.instanceMatrix.needsUpdate = true;
    // the bull wheels, turning with the rope (V / G2 radians a second), near the camera and in view
    let nw = 0;
    const a = -((c * V / G2) % (Math.PI * 2));
    for (const st of [P.top, P.bot]) {
      if ((P.XC - cp.x) ** 2 + (st.y - cp.y) ** 2 + (st.z - cp.z) ** 2 > 200 * 200) continue;
      _q.setFromAxisAngle(Y, a); _p.set(P.XC, st.y, st.z); _m.compose(_p, _q, _s.set(1, 1, 1));
      _m.toArray(this.wh.instanceMatrix.array, nw * 16); nw++;
    }
    this.wh.count = nw; this.wh.visible = nw > 0; if (nw) this.wh.instanceMatrix.needsUpdate = true;
    this.camAt = cp;
  }

  // ---- the rider -----------------------------------------------------------------------------------------------------
  // where the rider stands on the track at loop place s (up line), for ride kind `kind`: the snow between the feet (out)
  trackPoint(s, kind, out) {
    const P = this.plan, F = TBAR_FIT[kind] || TBAR_FIT.ski;
    const z = this.ropeAt(Math.max(P.S[17], Math.min(P.sOff + 1, s)), out, null).z;
    out.set(P.XU - F.side, 0, Math.max(P.top.z + 2, Math.min(P.bot.z, z)));
    out.y = height(out.x, out.z);
    return out;
  }
  /* the pose's bar, stem and axis, and the skier's p, q, for a rider at track point p (riding up the track), towed by the
     clamp Cl with the bar `on` (0..1) in place, the empty T's place for on = 0 (Te, its crossbar middle) */
  fit(sk, kind, p, Cl, on, Te, out = this.pose) {
    const F = TBAR_FIT[kind] || TBAR_FIT.ski;
    // the bar's middle: under the rope (the stem's line), h over the snow, ahead along the track
    _c.set(p.x + F.side, p.y + F.h, p.z - F.ahead);
    _c.y = Math.max(_c.y, height(_c.x, _c.z) + F.h * 0.8);
    if (Te && on < 1) _c.lerpVectors(Te, _c, smooth(on));
    out.bar.copy(_c);
    // the stem: from the bar towards the clamp, held a little nearer upright than the cord pulls
    if (!this.rideU) this.rideU = new THREE.Vector3();
    const u = this.rideU.subVectors(Cl, _c).normalize(); u.y += 0.8; u.normalize();
    out.stem.copy(_c).addScaledVector(u, F.grip);
    out.axis.set(-1, 0, 0);                        // (from the stem out to the rider: the rider is on the park side)
    if (!out.axisBar) out.axisBar = new THREE.Vector3();
    out.axisBar.set(1, 0, 0);
    out.hand = F.side >= 0 ? 'R' : 'L';
    out.on = on;
    return out;
  }
  // the skier on the track at p facing up it (the snow's normal up)
  placeSkier(sk, p, speed) {
    sk.p.copy(p);
    normal(p.x, p.z, sk.n);
    _b.set(0, 0, -1); _b.addScaledVector(sk.n, -_b.dot(sk.n)).normalize();      // up the track, along the snow
    _a.crossVectors(sk.n, _b).normalize();                                           // the rider's left
    _m.makeBasis(_a, sk.n, _b); sk.q.setFromRotationMatrix(_m);
    sk.v.copy(_b).multiplyScalar(speed);
    this.feet.copy(p); this.feetOn = true; this.sit = 0;
  }
  nearLoad(sk, r) { const L = this.plan.load; return Math.hypot(sk.p.x - L.x, sk.p.z - L.z) < r; }
  inLoadArea(sk) { const P = this.plan; return sk.p.x > P.XU - 7 && sk.p.x < P.XU + 1.2 && sk.p.z > P.zLoad - 14 && sk.p.z < P.zLoad + 6; }
  pastBottom(p) { return p.z > this.plan.bot.z + 22; }
  board(sk, here) {
    const P = this.plan, L = P.load, kind = sk.kind || 'ski';
    const from = sk.p.clone(), fd = Math.hypot(from.x - L.x, from.z - L.z);
    sk.toLift(); sk.liftKind = 'tbar';
    const walk = here ? 0 : Math.min(2.2, Math.max(0.5, fd / 4));
    // the hanger that comes past next, at least the walk and a moment after it
    const pick = this.nextTo(P.sOn - 2, walk + 0.8);
    const fw = _a.set(0, 0, 1).applyQuaternion(sk.q); const yaw0 = Math.atan2(fw.x, fw.z);
    this.ride = { phase: 'walk', t: 0, walk, from, yaw0, hanger: pick.i, kind, s: P.sOn, v: 0 };
    if (here) { from.set(L.x, 0, L.z); this.ride.yaw0 = Math.PI; }
    if (this.input) this.input.stick = 0;
    this.pose.phase = 'wait'; this.pose.on = 0;
    return true;
  }
  boardNow(sk) { sk.spawn(this.plan.load.x, this.plan.load.z, 0, Math.PI); return this.board(sk, true); }
  get riding() { return !!this.ride; }

  /* once a frame (main.js, after the physics and before the pose): the hangers, and the rider on one.
     g: { skier, input, I, live, paused, solo, camera, hud, sound, mouse, camKey } */
  update(dt, g) {
    if (!this.ready) return;
    this.input = g.mouse ? g.input : null;
    const P = this.plan, sk = g.skier, R = this.ride;
    if (g.camKey) this.camKey = g.camKey;
    if (R && this.pressed && g.live) R.rush = true;
    this.pressed = false;
    // the clock: alone, a pause holds the lift and a T waited for comes quickly; in a room it is everyone's
    if (g.solo && R) {
      if (g.paused) this.offset -= dt;
      else if (R.rush && (R.phase === 'wait' || R.phase === 'walk') && g.live) this.offset += dt * 5;
    }
    if (!g.solo && !R && this.offset) this.offset = 0;
    // a ride ended elsewhere (Backspace, a reset, a new start): let go
    if (R && sk.state !== 'lift') { this.ride = null; this.sit = 0; this.feetOn = false; }
    if (!this.ride) {
      this.sit = 0; this.feetOn = false;
      if (g.live && sk.state === 'ground') {
        const near = this.nearLoad(sk, 34);
        if (near && this.hint <= 0) { g.hud && g.hud.flash('The T-bar: ski into the lift line (or press E)', 2600); this.hint = 30; }
        this.hint -= dt;
        if (this.inLoadArea(sk) && sk.v.length() < 12) this.board(sk);
        else if (near && g.input && g.input.took && g.input.took('KeyE')) this.board(sk);
        if (this.ride && g.hud) g.hud.flash('T-bar: press any key to go straight up', 2800);
      }
    }
    // (paused, the rider's own part stands still too: alone the whole lift is held; in a room the bar keeps pulling them)
    if (this.ride) this.ridePlace(g.paused ? 0 : dt, g);
    this.place(dt, g.camera);
    this.sounds(dt, g);
  }
  // the rider: walking to the loading point, waiting for the T, taking it, towed up, letting go at the top
  ridePlace(dt, g) {
    const P = this.plan, sk = g.skier, r = this.ride, L = P.load, kind = r.kind;
    r.t += dt;
    const c = this.clock();
    if (!this.rideClamp) this.rideClamp = new THREE.Vector3();
    const Cl = this.rideClamp;
    const sH = this.sOf(r.hanger, c);                         // the rider's hanger's clamp, round the loop
    // (on the up line its place counts up from the loading point: behind it is negative)
    let ahead = sH - P.sOn; if (ahead > P.len / 2) ahead -= P.len; if (ahead < -P.len / 2) ahead += P.len;
    if (r.phase === 'walk' || r.phase === 'wait') {
      // shuffle to the loading point facing up the track, and wait there for the T (one gone past already: the next)
      const k = r.walk > 0 ? smooth(r.t / r.walk) : 1;
      _p.set(r.from.x + (L.x - r.from.x) * k, 0, r.from.z + (L.z - r.from.z) * k); _p.y = height(_p.x, _p.z);
      let dy = Math.PI - r.yaw0; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const yaw = r.yaw0 + dy * k;
      sk.p.copy(_p); normal(_p.x, _p.z, sk.n); sk.q.setFromAxisAngle(Y, yaw); sk.v.set(0, 0, 0);
      this.feet.copy(_p); this.feetOn = true; this.sit = 0;
      if (k >= 1) r.phase = 'wait';
      if (r.phase === 'wait' && ahead > -0.3) r.hanger = this.nextTo(P.sOn - 2, 0.5).i;
      else if (r.phase === 'wait' && ahead > -2.2) { r.phase = 'grab'; r.t = 0; }
      this.ropeAt(sH, Cl, null);
      this.pose.phase = 'wait'; this.pose.on = 0;
      this.fit(sk, kind, sk.p, Cl, 0, _e.copy(Cl).addScaledVector(Y, -RETRACT));
      if (r.phase === 'wait') this.placeSkier(sk, _p.set(L.x, height(L.x, L.z), L.z), 0);
      if (r.phase !== 'grab') return;
    }
    if (r.phase === 'grab') {
      // the T comes from behind: the hand takes the stem and puts the bar behind the legs while the clamp goes over
      this.ropeAt(sH, Cl, _a);
      const on = smooth(r.t / 0.45);
      _e.copy(Cl).addScaledVector(Y, -RETRACT);              // where the empty T hangs
      this.trackPoint(P.sOn, kind, _p);
      this.placeSkier(sk, _p, 0);
      this.pose.phase = 'grab'; this.fit(sk, kind, _p, Cl, on, _e);
      if (ahead >= 0 && on >= 1) { r.phase = 'tow'; r.t = 0; r.s = P.sOn; r.v = 0; }
      return;
    }
    // ---- towed: speeding up over RAMP s, then at line speed LAG behind the clamp (on the express, faster)
    if (r.phase === 'tow') {
      if (r.rush && !r.x && r.s < P.sOff - 25) {
        // (it ends LAG behind the shared hanger that will then be nearest the unloading point, and the ride carries on with
        // that one, so its clamp is where the express's was)
        const dur = Math.max(1, EXPRESS * (P.sOff - r.s) / (P.sOff - P.sOn)), c1 = c + dur;
        let to = r.hanger, best = Infinity;
        for (let j = 0; j < P.N; j++) { const d = Math.abs(this.sOf(j, c1) - LAG - (P.sOff - 2)); if (d < best) { best = d; to = j; } }
        r.x = { c0: c, s0: r.s, dur, to, s1: this.sOf(to, c1) - LAG };
      }
      let sv;
      if (r.x) {
        // (at line speed in and out, as fast as it takes between: s(k) a Hermite curve with slope V x dur at both ends)
        const k = Math.min(1, (c - r.x.c0) / r.x.dur), D = r.x.s1 - r.x.s0, m = V * r.x.dur;
        const s1 = r.x.s0 + D * (3 * k * k - 2 * k * k * k) + m * (k * k * k - 2 * k * k + k) + m * (k * k * k - k * k);
        sv = dt > 0 ? (s1 - r.s) / dt : V; r.s = s1;
        this.ropeAt(r.s + LAG, Cl, null);
        this.camSnap = true;
        if (k >= 1) { r.hanger = r.x.to; r.x = null; r.v = V; }
      } else {
        r.v = Math.min(V, r.v + V / RAMP * dt);
        // (never more than LAG behind the clamp, so a slow frame cannot leave the rider behind it)
        r.s = Math.max(r.s + r.v * dt, sH - LAG); r.s = Math.min(r.s, sH);
        sv = r.v;
        this.ropeAt(sH, Cl, null);
      }
      this.trackPoint(r.s, kind, _p);
      this.placeSkier(sk, _p, Math.min(30, sv));
      this.pose.phase = 'tow'; this.fit(sk, kind, _p, Cl, 1, null);
      if (r.s >= P.sOff - 0.2 && !r.x) { r.phase = 'off'; r.t = 0; r.offV = V; }
      return;
    }
    // ---- letting go at the top: the bar out from behind the legs, the T flying up on its cord, the rider gliding off
    // to the left towards the start
    if (r.phase === 'off') {
      const k = smooth(r.t / 0.5);
      this.ropeAt(sH, Cl, null);
      _e.copy(Cl).addScaledVector(Y, -RETRACT);
      this.trackPoint(P.sOff, kind, _p);
      const yawOut = Math.atan2(-0.95, 0.3);                  // off the track to the left, a little down the hill
      _p.x -= 0.8 * k; _p.z -= 0.6 * k; _p.y = height(_p.x, _p.z);
      this.placeSkier(sk, _p, r.offV * (1 - 0.4 * k));
      // (turned from facing up the track towards the way off)
      let dy = yawOut - Math.PI; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      _q.setFromAxisAngle(Y, dy * k * 0.6); sk.q.premultiply(_q);
      this.pose.phase = 'off'; this.fit(sk, kind, _p, Cl, 1 - k, _e);
      if (k >= 1) {
        sk.offLift(_p.x, _p.z, yawOut, 3.5);
        this.ride = null; this.sit = 0; this.feetOn = false; this.pose.on = 0;
        if (g.mouse && g.input) g.input.stick = Math.atan2(0.95, 0.3) / 1.66;
        if (g.hud) g.hud.flash('Ride on down to the start', 1600);
      }
    }
  }
  // the drive's hum near the stations and on the lift
  sounds(dt, g) {
    const snd = g.sound; if (!snd || !snd.liftHum) return;
    const cp = g.camera ? g.camera.position : g.skier.p, P = this.plan;
    const d = Math.min(Math.hypot(cp.x - P.XC, cp.z - P.top.z), Math.hypot(cp.x - P.XC, cp.z - P.bot.z));
    const hum = Math.max(this.ride ? 0.16 : 0, 0.8 * (1 - Math.min(1, d / 60)));
    if (Math.abs(hum - (this._hum ?? -1)) > 0.02) { snd.liftHum(hum); this._hum = hum; }
    // the rattle of the rider's own hanger's clamp over a tower's sheaves
    if (this.ride && this.ride.phase === 'tow' && snd.liftClack) {
      const z = this.rideClamp.z;
      for (const t of P.towers) if ((this._cz ?? z) > t.z && z <= t.z) snd.liftClack(0.6);
      this._cz = z;
    } else this._cz = undefined;
  }

  /* The camera on the T-bar (main.js, after camera.js placed it): the chase camera behind the rider up the track (or
     where the look keys or the mouse turned it, cams.orbit), steady over the snow's bumps; first person and the filmer
     are camera.js's own. */
  camera(dt, cam, cams, sk) {
    if (!this.ready) return;
    const mode = cams.mode, third = mode === 'chase' || mode === 'far';
    if (!third || sk.state !== 'lift' || !this.ride) { this.camOk = false; return; }
    const far = mode === 'far', back = far ? 8.5 : 4.4, up = far ? 3.2 : 1.9;
    const a = Math.PI + (cams.orbit || 0);                     // (behind: the rider faces -z)
    const dx = Math.sin(a), dz = Math.cos(a);
    if (!this.camPos) { this.camPos = new THREE.Vector3(); this.camLook = new THREE.Vector3(); }
    _a.set(sk.p.x - dx * back, sk.p.y + up, sk.p.z - dz * back);
    const gy = height(_a.x, _a.z) + 0.9; if (_a.y < gy) _a.y = gy;
    _b.set(sk.p.x + dx * 3, sk.p.y + 1.1, sk.p.z + dz * 3);
    const k = !this.camOk || cams.first || this.camSnap ? 1 : 1 - Math.exp(-dt * 7);
    this.camSnap = false;
    this.camPos.lerp(_a, k); this.camLook.lerp(_b, k); this.camOk = true;
    cam.position.copy(this.camPos); cam.up.set(0, 1, 0); cam.lookAt(this.camLook);
    cam.near = 0.15; cam.updateProjectionMatrix();
    // (camera.js's own chase starts from here when the ride ends, so nothing jumps)
    if (cams.pos) cams.pos.copy(this.camPos);
    if (cams.look && cams.look.copy) cams.look.copy(this.camLook);
    if (cams.dir) cams.dir.set(dx, 0, dz);
  }
  // in the mouse scheme on the T-bar: the camera turns as the pointer moves, as on the chairlift
  lookMouse(cams, input, I, dt) {
    const d = input.stick + (I.steer ? I.steer * dt * 0.7 : 0);
    input.stick = 0;
    const o = cams.orbit || 0;
    if (this.lookT === undefined || Math.abs(Math.atan2(Math.sin(this.lookT - o), Math.cos(this.lookT - o))) > 1.5) this.lookT = o;
    this.lookT -= d * 2.4;
    const step = Math.atan2(Math.sin(this.lookT - o), Math.cos(this.lookT - o)) * Math.min(1, dt * 18);
    cams.orbit = Math.atan2(Math.sin(o + step), Math.cos(o + step));
    this.lookT = cams.orbit + Math.atan2(Math.sin(this.lookT - cams.orbit), Math.cos(this.lookT - cams.orbit));
  }

  // ---- riding with others (net.js): the state's x, and another rider on their hanger here --------------------------
  // lf: 1 walking to the loading point, waiting or taking the T, 2 towed, 3 letting go; lc the hanger; ls the ride kind
  // (as KINDS); lt how far the bar is in place; le 1 on the express (then p and q are theirs as sent)
  netX(x) {
    const r = this.ride; if (!r) return;
    x.lf = r.phase === 'tow' ? 2 : r.phase === 'off' ? 3 : 1; x.lc = r.hanger; x.ls = Math.max(0, KINDS.indexOf(r.kind)); x.lt = Math.round(this.pose.on * 100) / 100;
    if (r.x) x.le = 1;
  }
  remoteSeat(x, p, q, out) {
    if (!this.ready || !x || !x.lf) return null;
    const P = this.plan, kind = KINDS[x.ls | 0] || 'ski', on = typeof x.lt === 'number' ? x.lt : 1;
    if (!out.tbar) out.tbar = { bar: new THREE.Vector3(), axis: new THREE.Vector3(), stem: new THREE.Vector3(), hand: 'R', on: 0, phase: 'wait', axisBar: new THREE.Vector3() };
    if (!out.f) out.f = new THREE.Vector3();
    if (!out.cl) out.cl = new THREE.Vector3();
    const i = x.lc | 0;
    if (i < 0 || i >= P.N) return null;
    const sH = this.sOf(i);
    this.ropeAt(sH, out.cl, null);
    if (x.lf === 2 && !x.le) {
      // towed: under this page's own hanger of that number, LAG behind its clamp (so they ride it exactly)
      this.trackPoint(Math.max(P.sOn, Math.min(P.sOff, sH - LAG)), kind, p);
      normal(p.x, p.z, _a); _b.set(0, 0, -1); _b.addScaledVector(_a, -_b.dot(_a)).normalize(); _c.crossVectors(_a, _b).normalize();
      _m.makeBasis(_c, _a, _b); q.setFromRotationMatrix(_m);
    } else if (x.le) this.ropeAt(P.sAtZ(p.z) + LAG, out.cl, null);   // (on the express: from where they are)
    _e.copy(out.cl).addScaledVector(Y, -RETRACT);
    const save = this.rideU; this.rideU = out.u || (out.u = new THREE.Vector3());
    this.fit(null, kind, p, out.cl, x.lf === 1 && on < 1 ? on : x.lf === 3 ? on : 1, _e, out.tbar);
    out.u.copy(this.rideU); this.rideU = save;
    out.tbar.phase = x.lf === 2 ? 'tow' : x.lf === 3 ? 'off' : on > 0 ? 'grab' : 'wait';
    out.kind = 'tbar'; out.sit = 0; out.feet = out.f.copy(p);
    // their hanger drawn loaded (this frame, after place(): its empty copy is moved to them)
    if (on > 0.01 || x.lf >= 2) this.extraHanger(i, out.cl, out.tbar.bar, out.tbar.axisBar, out.u);
    return out;
  }
  // one more loaded hanger this frame (another rider's), in place of its empty copy if that was drawn
  extraHanger(i, Cl, B, ax, u) {
    const c = this.camAt; if (!c || !this.rb) return;
    if (Cl.distanceToSquared(c) > this.hangR * this.hangR) return;
    const k = this.rb.count; if (k >= this.rb.instanceMatrix.count) return;
    this.putHanger(k, Cl, B, ax, u);
    this.rb.count = this.cd.count = this.tt.count = k + 1;
    for (const m of [this.rb, this.cd, this.tt]) m.instanceMatrix.needsUpdate = true;
    // (its empty copy, if drawn where the clamp is, is pushed up out of sight: found by its clamp's place)
    const A = this.rb.instanceMatrix.array;
    for (let j = 0; j < k; j++) if (Math.abs(A[j * 16 + 12] - Cl.x) < 0.05 && Math.abs(A[j * 16 + 14] - Cl.z) < 0.05 && Math.abs(A[j * 16 + 13] - Cl.y) < 0.05) {
      for (const m of [this.rb, this.cd, this.tt]) m.instanceMatrix.array[j * 16 + 13] -= 1000;
      break;
    }
  }

  // ---- collisions: the columns, the masts and the huts, as trees are (skier.trees) --------------------------------------
  withTowers(forest) {
    const C2 = this.plan.colliders;
    const hit = (x, z, r) => {
      for (const c of C2) {
        const d = Math.hypot(c.x - x, c.z - z), R = c.r + r;
        if (d < R) return { t: { x: c.x, y: c.y, z: c.z, s: c.s }, d, R, nx: (x - c.x) / (d || 1), nz: (z - c.z) / (d || 1) };
      }
      return null;
    };
    return { hit: (x, z, r) => forest.hit(x, z, r) || hit(x, z, r), forest };
  }
  stats() {
    const P = this.plan;
    return { hangers: P.N, towers: P.towers.length, loop: Math.round(P.len), up: Math.round(P.bot.z - P.top.z), drawn: this.rb ? this.rb.count : 0, stillTris: this.stillTris, x: P.XU, load: P.zLoad, unload: P.zUnload };
  }
}
