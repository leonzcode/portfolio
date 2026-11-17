/* (O, round 12) Genting 2022: the slopestyle course built at Genting Snow Park for the 2022 Winter Games (designed and
   built by Schneestern), section for section and rail for rail as far as the published pictures and footage show it.
   The feature sheet with every number and where it came from: scratchpad ski12/O/FEATURES.md.

   What is known (stated by the builders, the federation's preview and the official results):
   - 600 m long, 198 m down (start 2100 m, finish 1902 m); three jib sections, then three jump sections.
   - The jib sections are built in steps: terraces whose features are highest on the rider's left and lower and lower
     towards the right; a replica of the Great Wall (snow bricks, crenellated, about 3.5 m tall) runs down the rider's
     left beside them as a shelter from the strong west wind, with a watchtower on it.
   - Section 1: rainbow to down rail ("industry"), tank, flat rail, down-flat-down rail, transfer mailbox (and the long
     down rails below it on the right).
   - Section 2: the watchtower (its roof's ridge beam is a rail), down mailbox, flat-down rail, down-flat-down mailbox.
   - Section 3: gap to flat rail, roller jump (a rail following a roller), cannon ("industry"), a butter box; a gate
     bastion with an arched door at its end.
   - Section 4: two skew kickers turned in over one table, the landing's sweet spot 19 m out.
   - Section 5: one big pile: a roller to the knuckle peaking at 9 m, transfer kickers either side (5 m), twin
     quarterpipes, one landing, its sweet spot 21 m from the kickers.
   - Section 6: one straight 5 m kicker over a 21 m table, with stepped Great Wall pieces beside it.
   Everything else (each rail's length and height, the decks' heights, where each section starts) is estimated from the
   drone footage and the satellite picture of the terraces' earthworks, and marked so in the sheet.

   The frame (m_olyland.js): x the rider's left, z down the course, the start at z 0. */
import * as THREE from 'three';
import { setRun, baseLine, pitchAt, ground } from './terrain.js?v=31';
import { Kicker, Rail, Shape, SkewKicker, Quarter, assemble } from './park.js?v=31';
import { smoothstep, clamp } from './noise.js?v=31';

const RAD = Math.PI / 180;
// ---- the course's profile (terrain.js run sections: [z where a pitch starts, degrees], 30 m smoothing) --------------
// (the jump zone's pitch is worked out so the course falls 198 m over its 600 m, the official figure)
const ZF = 600;                       // the finish line
function sections(jumpDeg) {
  return [[-900, 9], [-220, 10], [-46, 6], [-6, 6], [0, 24], [18, 19.5], [236, 15], [262, jumpDeg], [592, 9], [616, 3], [705, 2], [770, 7]];
}
const J_SOLVED = 17.83264124;          // (the last answer: checked first, so a load skips the 30 rebuilds of the run)
export function setProfile() {
  setRun(sections(J_SOLVED));
  if (Math.abs(baseLine(0) - baseLine(ZF) - 198) < 0.02) return J_SOLVED;
  let lo = 10, hi = 30;
  for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2; setRun(sections(m)); if (baseLine(0) - baseLine(ZF) < 198) lo = m; else hi = m; }
  setRun(sections((lo + hi) / 2));
  return (lo + hi) / 2;
}

// ---- small helpers ---------------------------------------------------------------------------------------------
const uniq = a => [...new Set(a.map(v => Math.round(v * 1000) / 1000))].sort((p, q) => p - q);
const span = (a, b, st) => { const o = [], n = Math.max(1, Math.ceil((b - a) / st)); for (let i = 0; i <= n; i++) o.push(a + (b - a) * i / n); return o; };
const toe = (v, t) => t < 1e-4 ? Math.max(v, 0) : v >= t ? v : v <= -t ? 0 : (v + t) * (v + t) / (4 * t);
const G = 9.81, KD = 0.5 * 1.2 * 0.55 / 78, MU = 0.036;
const accel = (th, v) => G * Math.sin(th) - MU * G * Math.cos(th) - KD * v * v;
export function rollTo(z, v, z1, vWant = Infinity) {
  for (; z < z1 && v < vWant; z += 0.25) { const th = pitchAt(z); v = Math.sqrt(Math.max(0.25, v * v + 2 * accel(th, v) * 0.25 / Math.cos(th))); }
  return { z, v };
}
function startFor(name, x, z, zTo, vTo, extra) {
  let lo = 1, hi = vTo + 3;
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (rollTo(z, m, zTo).v < vTo + 0.4) lo = m; else hi = m; }
  return Object.assign({ name, x, z, v: Math.round(hi * 10) / 10 }, extra || {});
}

/* ---- a terrace (a deck): laid at `deck` degrees from its back edge zA (level with the slope there) to its front edge
   zB, across x0..x1, then a face at `face` degrees down to the slope, the edge between them rounded (Rk); its sides fall
   at sideS (with a rounded shoulder). The jib sections are built of these: the photos' "steps". Its edges are dyed blue
   as the crews marked them. In its own frame: u = x - its middle, s = z (Shape's x, z = middle, 0). */
class Deck extends Shape {
  constructor(o) {
    super(Object.assign({ name: 'Deck', group: 'Jib', deck: 8, face: 32, sideS: 0.9, shoulder: 0.5, toeW: 0.3, Rk: 1.6, lod: false }, o));
    this.x = (this.x0 + this.x1) / 2; this.hw = (this.x1 - this.x0) / 2; this.z = 0;
    const td = Math.tan(this.deck * RAD), tf = Math.tan(this.face * RAD);
    this.yA = baseLine(this.zA); this.yB = this.yA - (this.zB - this.zA) * td;
    this.H = this.yB - baseLine(this.zB);
    // the rounded edge: a circle of radius Rk tangent to the deck and the face
    const a0 = Math.atan(td), a1 = Math.atan(tf), R = this.Rk;
    this.kc = { z: this.zB - R * Math.sin(a0), y: this.yB - R * Math.cos(a0) };
    this.k0 = this.kc.z + R * Math.sin(a0); this.k1 = this.kc.z + R * Math.sin(a1);
    this.yK1 = this.kc.y + R * Math.cos(a1); this.td = td; this.tf = tf; this.a0 = a0;
    let z = this.k1; while (z < this.k1 + 80 && this.yK1 - (z - this.k1) * tf > baseLine(z)) z += 0.1;
    this.zMeet = z;
    const reach = this.hw + this.shoulder + (this.H + 0.5) / this.sideS + this.toeW + 0.6;
    this.u0 = -reach; this.u1 = reach; this.s0 = this.zA - 0.2; this.s1 = this.zMeet + 0.6;
    this.bound();
    /* what stands on it (ramps up to the rails, the gap's kick and ledge, the roller): part of its own snow, the higher of
       the two at each place. As separate features the park rounded the one into the other (park.js assemble), and one
       rising out of the deck level with it made a step where it began: 7.5 cm at the tank's ramp, which stopped a rider
       dead. Drawn in its own mesh, its grid finer over them (rows, cols). */
    this.adds = [];
  }
  add(f) {
    this.adds.push(f);
    this.x0 = Math.min(this.x0, f.x0); this.x1 = Math.max(this.x1, f.x1); this.zs = Math.min(this.zs, f.zs); this.z1 = Math.max(this.z1, f.z1);
    this.u0 = Math.min(this.u0, f.x0 - this.x); this.u1 = Math.max(this.u1, f.x1 - this.x); this.s0 = Math.min(this.s0, f.zs); this.s1 = Math.max(this.s1, f.z1);
    return f;
  }
  height(x, z, g) {
    if (x < this.x0 || x > this.x1 || z < this.zs || z > this.z1) return -Infinity;
    const r = this.rel(x - this.x, z), d = r > 0.002 ? g + r : -Infinity;
    if (!this.adds.length) return d;
    const base = d > -Infinity ? d : g;
    let y = d;
    for (const a of this.adds) { const h = a.on(x, z, base); if (h > y) y = h; }
    return y;
  }
  surface(x, z) { if (x < this.x0 || x > this.x1 || z < this.zs || z > this.z1) return false; return this.rel(x - this.x, z) > 0.05 || this.adds.some(a => a.on(x, z, 0) > 0.05); }
  // the top's height over the run's base line along the middle (or -Infinity)
  relC(z) {
    if (z < this.zA || z > this.zMeet + 0.5) return -Infinity;
    let y;
    if (z <= this.k0 - 1e-6) y = this.yA - (z - this.zA) * this.td;
    else if (z <= this.k1) { const dz = z - this.kc.z; y = this.kc.y + Math.sqrt(Math.max(0, this.Rk * this.Rk - dz * dz)); }
    else y = this.yK1 - (z - this.k1) * this.tf;
    return y - baseLine(z);
  }
  rel(u, s) {
    const c = this.relC(s); if (!(c > 0)) return -Infinity;
    const d = Math.abs(u) - this.hw, r = this.shoulder, sd = d <= 0 ? 0 : d < r ? this.sideS * d * d / (2 * r) : this.sideS * (d - r / 2);
    return toe(c - sd, Math.min(this.toeW, c * 0.5));
  }
  rows(fine) {
    const r = span(this.s0, this.s1, fine ? 0.8 : 1.2);
    for (const b of [this.k0, this.k1, this.zB]) for (const e of [-0.5, -0.25, -0.1, 0, 0.1, 0.25, 0.5]) r.push(b + e);
    for (const e of [0, 0.4, 1, 2]) r.push(this.zMeet - e);
    for (const a of this.adds) for (const z of span(a.zs, a.z1, fine ? 0.25 : 0.4)) r.push(z);
    return uniq(r.filter(z => z >= this.s0 && z <= this.s1));
  }
  cols(fine) {
    const c = span(this.u0, this.u1, fine ? 0.8 : 1.3); for (const s of [-1, 1]) for (const e of [-0.2, -0.07, 0, 0.15, 0.3, 0.6, 1.0]) c.push(s * (this.hw + e));
    for (const a of this.adds) for (const x of span(a.x0, a.x1, fine ? 0.25 : 0.4)) c.push(x - this.x);
    return uniq(c.filter(u => u >= this.u0 && u <= this.u1));
  }
  // the blue lines: along the front edge and down the top's sides
  dye(x, z) {
    for (const a of this.adds) if (a.dye && a.dye(x, z)) return 1;
    const u = x - this.x, d = Math.abs(u) - this.hw;
    // (the front edge only: a line down each side too drew the terraces as outlined plates)
    if (Math.abs(z - this.zB + 0.25) < 0.12 && d < -0.5) return 1;
    return 0;
  }
}

/* a solid block standing out of the snow (a tower's body, the bastion, a length of the Great Wall): its top `H` over the
   snow, upright sides, its footprint a rectangle along a segment (a, b), t thick. Its look is drawn by m_olybuild.js
   (ownMesh: the terrain's patches leave it out); the physics meets its sides as a wall and can ride its top. roof: a
   hipped roof on top (its ridge along the segment), rising roofH over its eaves. */
class Block extends Shape {
  constructor(o) {
    const ax = o.a[0], az = o.a[1], bx = o.b[0], bz = o.b[1], L = Math.hypot(bx - ax, bz - az);
    super(Object.assign({ name: 'Block', group: 'Walls', t: 1.6, H: 3.5, roof: 0, eave: 0.4, trim: false, lod: false }, o, { x: ax, z: az, yaw: Math.atan2(bx - ax, bz - az) }));
    this.L = L; this.u0 = -this.t / 2 - this.eave - 0.2; this.u1 = -this.u0; this.s0 = -0.2 - (this.roof ? this.eave : 0); this.s1 = L + 0.2 + (this.roof ? this.eave : 0);
    this.bound();
    this.ownMesh = true; this.local = true;
  }
  // the snow under it is the run's own: it stands on what is there (g), so its top follows the ground under it
  rel(u, s) {
    const h = this.t / 2;
    if (this.roof) {
      // a roof whose eaves overhang the body by `eave`: from the eaves (H) up to the ridge along the middle; hipped (its
      // ends slope too), or gabled (gable: its ridge runs the whole length, so it can be ridden on from its end)
      const e = this.eave, w = h + e, du = Math.abs(u);
      if (du > w || s < -e || s > this.L + e) return -Infinity;
      return this.H + (this.roof / w) * Math.max(0, this.gable ? w - du : Math.min(w - du, s + e, this.L + e - s));
    }
    return Math.abs(u) <= h && s >= 0 && s <= this.L ? this.H : -Infinity;
  }
  height(x, z, g) {
    if (x < this.x0 || x > this.x1 || z < this.zs || z > this.z1) return -Infinity;
    const L = this.toLocal(x, z, { u: 0, s: 0 }), r = this.rel(L.u, L.s);
    return r > 0 ? (this.base ? this.base(x, z, g) : g) + r : -Infinity;
  }
  on(x, z, base) { if (x < this.x0 || x > this.x1 || z < this.zs || z > this.z1) return -Infinity; const L = this.toLocal(x, z, { u: 0, s: 0 }), r = this.rel(L.u, L.s); return r > 0 ? base + r : -Infinity; }
  surface() { return false; }
}

/* a snow bank or ramp in a frame of its own: rises over len from 0 to h (a smooth step), holds h for top metres, then
   falls back over fall metres; flanks at 0.9. Used for the bank up to the watchtower's eaves and the gap jump's ramp. */
class Bank extends Shape {
  constructor(o) {
    super(Object.assign({ name: 'Bank', group: 'Jib', len: 6, h: 2, top: 1, fall: 0, hw: 2, lip: 0, trim: true, lod: false }, o));
    this.u0 = -this.hw - this.h / 0.9 - 0.4; this.u1 = -this.u0; this.s0 = -0.1; this.s1 = this.len + this.top + this.fall + 0.1;
    this.bound();
  }
  relS(s) {
    if (s < 0 || s > this.len + this.top + this.fall) return -Infinity;
    if (s < this.len) { const t = s / this.len; return this.kick ? this.h * Math.pow(t, 1.3) : this.lip ? this.h * (1 - Math.cos(t * Math.PI / 2 * this.lip / 30 * 1.2)) / (1 - Math.cos(Math.PI / 2 * this.lip / 30 * 1.2)) : this.h * t * t * (3 - 2 * t); }
    if (this.top > 0 && s < this.len + this.top) return this.h;
    if (!this.fall) return -Infinity;
    const t = (s - this.len - this.top) / this.fall; return this.kick ? this.h * (1 - t) : this.h * (1 - t * t * (3 - 2 * t));
  }
  rel(u, s) { const c = this.relS(s); if (!(c > 0)) return -Infinity; return c - Math.max(0, Math.abs(u) - this.hw) * 0.9; }
  // (standing on a deck, part of it: the deck asks this, with its own snow there as the base: Deck.adds)
  on(x, z, base) {
    if (x < this.x0 || x > this.x1 || z < this.zs || z > this.z1) return -Infinity;
    const L = this.toLocal(x, z, { u: 0, s: 0 }), r = this.rel(L.u, L.s);
    return r > 0 ? base + r : -Infinity;
  }
  rows(fine) { return uniq([...span(0, this.len + this.top + this.fall, fine ? 0.3 : 0.45), this.len, this.len + this.top]); }
  cols(fine) { const c = span(this.u0, this.u1, fine ? 0.35 : 0.5); for (const sg of [-1, 1]) for (const e of [-0.05, 0, 0.1]) c.push(sg * (this.hw + e)); return uniq(c); }
  dye(x, z) { const L = this.toLocal(x, z, { u: 0, s: 0 }); return this.lip && Math.abs(L.s - this.len + 0.1) < 0.1 && Math.abs(L.u) < this.hw ? 1 : 0; }
}

// a kicker's R for a lip `lipH` metres over the slope (bisection: a bigger radius stands its lip higher)
function kickerFor(o, lipH) {
  let lo = 3, hi = 80;
  for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2, k = new Kicker(Object.assign({}, o, { R: m, geomOnly: true })); if (k.lipH < lipH) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
/* a skew's place (park.js skewPlace, the same sums): its lip at (x, z) turned by yaw, its own table at height yT; the
   radius of its takeoff found by bisection */
function skewPlace(o, x, z, yT) {
  const lip = o.lip * RAD, cy = Math.cos(o.yaw);
  const make = (R, zf) => new Kicker(Object.assign({}, o, { x: 0, z0: 0, R, table: 5, geomOnly: true, base: s => baseLine(zf + s * cy), pitch: s => Math.atan(Math.tan(pitchAt(zf + s * cy)) * cy) }));
  const at = R => { let D = R * (Math.sin(lip) + 0.25), k = null; for (let i = 0; i < 4; i++) { k = make(R, z - D * cy); D = k.L.z; } return [k, D]; };
  let lo = 4, hi = 60;
  for (let it = 0; it < 30; it++) { const R = (lo + hi) / 2; if (at(R)[0].yT < yT) lo = R; else hi = R; }
  const R = (lo + hi) / 2, D = at(R)[1];
  return [R, x - D * Math.sin(o.yaw), z - D * cy];
}

/* ---- the course ---------------------------------------------------------------------------------------------------- */
export function makeCourse(land) {
  const jumpDeg = setProfile();
  const kickers = [], rails = [], meshed = [], ground2 = [], pipes = [], walls = [], blocks = [], decor = { panels: [], towers: [], scaffolds: [], guns: [], gates: [] };
  const sheet = [];                         // (what each thing is and where, for the feature sheet and the tests)
  const note = (name, o) => sheet.push(Object.assign({ name }, o));
  // the snow at x, z as the features built so far make it (the rails' places are worked out on it)
  const shapes = [];
  const snow = (x, z) => { const g = land.at(x, z); let y = g; for (const f of shapes) { const h = f.height(x, z, g); if (h > y) y = h; } return y; };

  // ---- the jib sections: terraces stepping down across the course from the Great Wall (the rider's left, x 29.2) ---------
  /* (second pass, from the federation's captioned drone preview frame by frame: the features stand in a band about 22 m
     wide against the wall, the highest terrace along the wall, the rails parallel to it; the faces between the terraces
     are 1 to 4 m, soft and rounded where they face down the course, upright brick where a terrace steps down across it.
     Sizes scaled from the 1 m panels and the wall's 0.6 x 0.3 m bricks: lengths about +-3 m, heights about +-30 %) */
  const decks = [];
  const deckSet = (n, zA, zB, spec) => {
    const out = {};
    for (const [k, s] of Object.entries(spec)) {
      // the deck's own pitch from the height its front edge stands over the slope
      const deck = Math.atan(Math.tan(pitchAt((zA + zB) / 2)) - s.H / (zB - zA)) / RAD;
      const d = new Deck({ name: `Section ${n} ${k === 'L' ? 'upper' : k === 'M' ? 'middle' : 'lower'} terrace`, group: `Jib ${n}`, x0: s.x0, x1: s.x1, zA, zB, deck, face: s.face || 40, Rk: s.Rk || 4.5, toeW: 1.2, shoulder: s.shoulder, sideS: s.sideS });
      meshed.push(d); shapes.push(d); decks.push(d); out[k] = d;
      note(d.name, { kind: 'deck', x0: s.x0, x1: s.x1, zA, zB, deck: +deck.toFixed(1), frontH: +d.H.toFixed(2), face: d.face, src: 'measured roughly from the drone preview (panels and bricks for scale); heights +-30 %' });
    }
    return out;
  };
  const deckUnder = (x, z) => decks.find(d => x > d.x - d.hw - 0.5 && x < d.x + d.hw + 0.5 && z > d.zA - 6 && z < d.zMeet);
  const place = (f, x, z) => { const d = deckUnder(x, z); if (d) d.add(f); else meshed.push(f); return f; };
  const snowNow = () => { const l = shapes.slice(); return (x, z) => { const g = land.at(x, z); let y = g; for (const f of l) { const h = f.height(x, z, g); if (h > y) y = h; } return y; }; };
  /* a rail (park.js Rail: its top line is what the skis ride), drawn by m_olybuild.js (ownMesh: a black round top on a blue
     panel down to the snow, or a tube, a box). ramp: a snow ramp up to its start, standing on the deck there (park.js's
     own ramps, Wedge, stand on the ground under the decks, out of sight) */
  const R_ = (o) => {
    const ramp = o.ramp, gap = o.gap != null ? o.gap : 0.7; delete o.ramp; delete o.gap;
    const r = new Rail(Object.assign({ abs: true, ownMesh: true }, o)); rails.push(r);
    if (ramp) {
      /* as park.js's own (Wedge): a kick rising over 3.5 m to its lip `gap` short of the rail's start (0.7 m), the rail's
         top a tenth of a metre over the lip (a box's 5 cm; a butter box sits on its ramp, 2 cm over a lip 0.25 m off),
         then falling away under the rail over 1.2 m */
      const p0 = r.P[0], d = r.dirAt(0), yaw = Math.atan2(d.x, d.z), len = 3.5, back = gap + len, under = snowNow();
      const lipUnder = o.lipUnder != null ? o.lipUnder : r.kind === 'box' ? 0.05 : 0.1;
      const hr = Math.max(0.15, p0.y - under(p0.x - Math.sin(yaw) * gap, p0.z - Math.cos(yaw) * gap) - lipUnder);
      const b = new Bank({ name: o.name + ' ramp', group: o.group || 'Ramps', x: p0.x - Math.sin(yaw) * back, z: p0.z - Math.cos(yaw) * back, yaw, len, h: hr, top: 0, fall: Math.max(0.5, gap + 0.5), kick: true, hw: r.kind === 'box' ? Math.max(1.3, r.w / 2 + 0.6) : 1.2 });
      place(b, p0.x - Math.sin(yaw) * back, p0.z - Math.cos(yaw) * back); r.rampShape = b;
    }
    return r;
  };
  // a rail through points [[x, z, h]] (h over the snow there), the panel's 0.3 m added to h; or along one x, [[z, h]]
  const railXZ = (name, kind, pts, o = {}) => {
    if (o.panel !== false) pts = pts.map(([x, z, h]) => [x, z, h + 0.3]);
    if (kind === 'rail' && (o.w || 0) <= 0.14) o = Object.assign({}, o, { w: 0.17 });
    const r = R_(Object.assign({ name, kind, pts: pts.map(([x, z, h]) => [x, z, snow(x, z) + h]), panel: o.panel !== false }, o));
    note(name, { kind, x: +pts[0][0].toFixed(1), from: pts[0][1], to: pts[pts.length - 1][1], len: +r.len.toFixed(1), h0: +pts[0][2].toFixed(2), src: o.src || 'measured roughly from the drone preview (panels for scale): place and length about +-3 m' });
    return r;
  };
  const rail = (name, kind, x, pts, o = {}) => railXZ(name, kind, pts.map(([z, h]) => [x, z, h]), o);

  // ---- Section 1 (z 26 to about 60): an upper terrace along the wall (the rainbow, the tank, the flat rail and the
  // transfer box's first leg), its side an upright brick face down to the middle terrace, whose own right side is brick
  // with a parapet: the transfer box's second leg, the two down rails and the down-flat-down rail on it --------------------
  const S1 = { zA: 26, zB: 46 };
  const d1 = deckSet(1, S1.zA, S1.zB, {
    L: { x0: 17.5, x1: 27.6, H: 3.6, sideS: 3.2, shoulder: 0.25 },
    M: { x0: 2.5, x1: 17.5, H: 2.5, sideS: 3.2, shoulder: 0.25 },
  });
  {
    const L = d1.L, M = d1.M;
    // the rainbow to down rail ("industry"): an arch about 8 m across and 1 m tall a metre off the wall, its top line
    // carrying on as a down rail over the terrace's front
    const xa = 26.4, za = S1.zA + 6, zc = za + 8, P = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; P.push([za + (zc - za) * t, 0.5 + 1.0 * Math.sin(Math.PI * t)]); }
    P.push([L.zB - 0.6, 0.6], [L.zMeet - 2.0, 0.7]);
    rail('Rainbow to down rail', 'rail', xa, P, { ramp: 0.4, src: 'stated name; shape and size from the drone preview (an arch about 8 m across and 1 m tall a metre off the wall, its line going on down the front): measured roughly' });
    // the tank: a fat black tube, flat, parallel to the wall, 3.4 m out from it, hanging over the terrace's front
    { const x = 24.0, za = L.zB - 5.5, y0 = snow(x, za) + 0.5, zb = L.zB + 1.0;
      R_({ name: 'Tank', kind: 'tube', w: 0.5, ramp: 0.42, gap: 0.3, lipUnder: 0.04, panel: false, look: 'tube', pts: [[x, za, y0], [x, zb, y0 - (zb - za) * L.td]] });
      note('Tank', { kind: 'tube', x, from: za, to: zb, dia: 0.5, src: 'stated name; a fat black tube about 0.45 m across and 6 m long, flat, about 3 m off the wall in the preview: measured roughly' }); }
    rail('Flat rail', 'rail', 21.3, [[L.zA + 8, 0.7], [L.zA + 12.5, 0.7]], { ramp: 0.4 });
    // the transfer box: a leg along the upper terrace, then a leg turned 30 degrees off it down over the brick side onto
    // the middle terrace (the preview shows a sharper turn, about 70 degrees: ridden as one box it would throw riders off)
    railXZ('Transfer box', 'box', [[18.8, L.zA + 7, 0.65], [18.8, L.zA + 12, 0.65], [15.2, L.zA + 18.2, 0.6]], { w: 0.34, ramp: 0.38, look: 'mailbox', src: 'stated name (transfer mailbox); a dog-leg in plan in the preview, the first leg along the wall, the second down onto the lower terrace: measured roughly, the turn eased' });
    // (two short round rails down the middle terrace's front: seen from below, two parallel rails come down its face; from
    // above, the same two read as short black-topped boxes)
    rail('Down rail (left)', 'rail', 10.2, [[M.zB - 3, 0.7], [M.zMeet + 1, 0.65]], { ramp: 0.45, src: 'two short parallel round-top rails down the front of the lower terrace (from below and from above in the preview): length about 5 m, measured roughly' });
    rail('Down rail (right)', 'rail', 7.2, [[M.zB - 3, 0.7], [M.zMeet + 1, 0.65]], { ramp: 0.45, src: 'two short parallel round-top rails down the front of the lower terrace (from below and from above in the preview): length about 5 m, measured roughly' });
    rail('Down-flat-down rail', 'rail', 4.2, [[M.zA + 6, 0.75], [M.zA + 10, 0.7], [M.zB - 0.5, 0.7], [M.zMeet - 1.0, 0.75]], { ramp: 0.48, src: 'stated name; near the middle terrace\'s brick right edge in the preview, 12 to 14 m long: measured roughly' });
  }
  // ---- Section 2 (z about 94 to 130): the watchtower in the wall's corner at the top, three rails on soft terraces -------
  const S2 = { zA: 94, zB: 114 };
  const d2 = deckSet(2, S2.zA, S2.zB, {
    L: { x0: 17.5, x1: 27.6, H: 3.0, sideS: 1.1, shoulder: 2.2 },
    M: { x0: 6.5, x1: 17.5, H: 2.2, sideS: 1.1, shoulder: 2.2 },
    R: { x0: -6, x1: 6.5, H: 1.5, sideS: 0.8, shoulder: 2.6, Rk: 6 },
  });
  {
    const L = d2.L, M = d2.M;
    /* the watchtower, on the wall at the section's top (the preview: a white body about 5 x 6.5 m, 3.2 m to its eaves, a
       roof rising 1.8 m with dark upturned eaves). Behind it the in-run is built up level with its ridge: ride that,
       slide the ridge, drop off its front onto the terrace (the preview shows riders reaching the roof from a stepped
       bank on its right; the ridge runs along the course here so it can be slid) */
    const tx = 23.6, tz0 = S2.zA + 1.0, tz1 = S2.zA + 7.5, onL = snowNow();
    const body = new Block({ name: 'Watchtower', group: 'Jib 2', a: [tx, tz0], b: [tx, tz1], t: 5.2, H: 3.2, roof: 1.8, eave: 0.8, gable: true, base: (x, z, g) => onL(x, z) });
    ground2.push(body); blocks.push(body); shapes.push(body);
    const gr = z => onL(tx, z) + 3.2 + 1.8 + 0.06;
    { const hP = gr(tz0) - 0.3 - land.at(tx, S2.zA + 0.5), zA = S2.zA - 28, zB = S2.zA + 0.5;
      const plat = new Deck({ name: 'Section 2 tower platform', group: 'Jib 2', x0: 21.4, x1: 26.4, zA, zB, deck: Math.atan(Math.tan(pitchAt((zA + zB) / 2)) - hP / (zB - zA)) / RAD, face: 62, sideS: 4.0, shoulder: 0.3, Rk: 0.6 });
      meshed.push(plat); shapes.push(plat); decks.unshift(plat);
      { const top = snowNow(); const w = new Block({ name: 'Great Wall', group: 'Walls', a: [20.9, zA + 4], b: [20.9, zB - 0.5], t: 1.0, H: 1.1, step: true, base: (x, z) => top(21.6, z) - 0.1 }); ground2.push(w); walls.push(w); }
      note(plat.name, { kind: 'deck', x0: 21.4, x1: 26.4, zA, zB, frontH: +plat.H.toFixed(2), src: 'estimated: the snow behind the tower built up to its ridge' }); }
    const r = R_({ name: 'Watchtower ridge', kind: 'rail', w: 0.22, ramp: 0.4, pts: [[tx, tz0 - 0.5, gr(tz0 - 0.5)], [tx, tz1 + 0.5, gr(tz1 + 0.5)]], panel: false, look: 'ridge' });
    decor.towers.push({ x: tx, z0: tz0, z1: tz1, w: 5.2, H: 3.2, roof: 1.8, eave: 0.8, gable: true, y0: onL(tx, tz0), y1: onL(tx, tz1), ridge: r });
    note('Watchtower and its ridge rail', { kind: 'tower', x: tx, z0: tz0, z1: tz1, w: 5.2, eaves: 3.2, roof: 1.8, ridgeOverDeck: +(gr(tz0) - snow(tx, tz0 - 1)).toFixed(2), src: 'stated (a watchtower); size from the preview (walls about 3 m, roof 1.5 to 2 m): measured roughly; the way onto its ridge estimated' });
    rail('Down mailbox', 'box', 24.4, [[L.zB - 4.5, 0.6], [L.zMeet + 2.5, 0.6]], { w: 0.34, ramp: 0.4, look: 'mailbox', src: 'stated name; 3 to 4 m off the wall, about 8 m, down the terrace\'s front in the preview: measured roughly' });
    rail('Flat-down rail', 'rail', 18.6, [[L.zB - 6.5, 0.6], [L.zB - 0.4, 0.6], [L.zMeet + 3.5, 0.7]], { ramp: 0.4, src: 'stated name; 8 to 10 m off the wall, a 6 m flat then a long down leg over the step in the preview: measured roughly' });
    rail('Down-flat-down mailbox', 'box', 12.6, [[M.zA + 7, 0.7], [M.zA + 10, 0.6], [M.zB - 0.5, 0.6], [M.zMeet + 2, 0.65]], { w: 0.34, ramp: 0.45, look: 'mailbox', src: 'stated name; 14 to 16 m off the wall, about 10 m in three pieces in the preview: measured roughly' });
  }
  // ---- Section 3 (z about 162 to 236): three long shelves down the slope side by side, the highest by the wall, steep
  // steps between them (the preview from below: long smooth lanes with the features at their tops), the gap rail, the
  // roller and the butter box at the top, the cannon on its brick ledge at the bottom by the gate --------------------------
  const S3 = { zA: 162, zB: 230 };
  const d3 = deckSet(3, S3.zA, S3.zB, {
    L: { x0: 17.5, x1: 27.6, H: 3.6, sideS: 2.6, shoulder: 0.4 },
    M: { x0: 6.5, x1: 17.5, H: 2.4, sideS: 2.6, shoulder: 0.4 },
    R: { x0: -6, x1: 6.5, H: 1.4, sideS: 1.0, shoulder: 2.0, Rk: 6 },
  });
  {
    const L = d3.L, M = d3.M, R = d3.R;
    // gap to flat rail: a small kick on the upper shelf, a gap, then a flat rail on a raised brick ledge by the wall
    const gx = 25.0, kz = L.zA + 6;
    const kick = new Bank({ name: 'Gap kick', group: 'Jib 3', x: gx, z: kz, len: 3.4, h: 1.1, top: 0, fall: 1.0, hw: 1.3, kick: true });
    const deckAt = snowNow(), yl = deckAt(gx, kz + 5.4);
    place(kick, gx, kz);
    const ledge = new Block({ name: 'Ledge under the gap rail', group: 'Jib 3', a: [gx, kz + 5.3], b: [gx, kz + 11.8], t: 1.4, H: 0.7, base: (x, z, g) => deckAt(x, z) });
    place(ledge, gx, kz + 6); blocks.push(ledge); ledge.y0 = yl;
    R_({ name: 'Gap to flat rail', kind: 'rail', w: 0.12, pts: [[gx, kz + 5.4, yl + 0.7 + 0.28], [gx, kz + 11.7, yl + 0.7 + 0.28 - 6.3 * L.td]], panel: true });
    note('Gap to flat rail', { kind: 'rail', x: gx, kick: 1.1, gap: 2.0, from: kz + 5.4, to: kz + 11.7, h: 0.98, src: 'stated name; by the wall at the top left of the section, about 6.5 m, in the preview: measured roughly' });
    // the roller jump: a long roller on the upper shelf, a round rail following it 0.5 m over the snow from its foot
    const rx = 20.4, rz = L.zA + 3, roll = new Bank({ name: 'Roller', group: 'Jib 3', x: rx, z: rz, len: 6, h: 1.3, top: 2, fall: 6, hw: 1.8 });
    place(roll, rx, rz);
    const RP = []; for (let z = rz - 1.5; z <= rz + 14.5 + 1e-6; z += 1) RP.push([z, 0.5]);
    rail('Roller rail', 'rail', rx, RP, { ramp: 0.4, gap: 0.35, lipUnder: 0.04, src: 'stated ("roller jump: a rounded rail parallel to the snow"); a long roller on the shelf by the wall: estimated' });
    // the butter box: a long, low, wide box at the top of the lower shelf, its ramp right up to it
    rail('Butter box', 'box', 0.5, [[R.zA + 5, 0.06], [R.zA + 19, 0.06]], { w: 1.1, ramp: 0.2, gap: 0.25, lipUnder: 0.02, look: 'mailbox', src: 'stated ("butter box"); not seen in the preview: place and size estimated' });
    /* the cannon at the bottom by the gate (the preview from below: a flat-topped brick ledge about 1.2 m high and 6 m long,
       a bar rising off its end): a snow ramp up onto the ledge, the ledge, the bar rising 18 degrees (25 to 30 there) */
    const cx = 13.5, cz = M.zMeet + 2;
    const ramp = new Bank({ name: 'Cannon ramp', group: 'Jib 3', x: cx, z: cz, len: 4.5, h: 1.15, top: 0.4, fall: 0, hw: 1.0 });
    meshed.push(ramp); shapes.push(ramp);
    const onR = snowNow();
    const led = new Block({ name: 'Ledge under the cannon', group: 'Jib 3', a: [cx, cz + 4.8], b: [cx, cz + 10.8], t: 1.8, H: 1.2, base: (x, z) => land.at(x, z) });
    ground2.push(led); blocks.push(led); shapes.push(led); led.y0 = onR(cx, cz + 5);
    const y0 = land.at(cx, cz + 10.7) + 1.2 + 0.08, run = 3.4, rise = Math.tan(18 * RAD) * run;
    R_({ name: 'Cannon', kind: 'rail', w: 0.14, look: 'cannon', pts: [[cx, cz + 10.7, y0], [cx, cz + 10.7 + run, y0 + rise]], panel: false });
    note('Cannon', { kind: 'cannon', x: cx, from: cz + 10.7, to: cz + 10.7 + run, rise: 18, src: 'stated ("cannon industry: a rounded rail angled upward off the ramp"); off the end of a brick ledge about 1.2 m high and 6 m long at the bottom of the section by the gate in the preview (25 to 30 degrees there): eased to 18' });
    // the gate bastion with its arched door, where the wall ends below the section (outside the riding)
    const bz = 244, bx = 30.2;
    const bas = new Block({ name: 'Gate bastion', group: 'Jib 3', a: [bx, bz], b: [bx, bz + 8], t: 8, H: 5.0 });
    ground2.push(bas); blocks.push(bas);
    decor.gates.push({ x: bx, z0: bz, z1: bz + 8, t: 8, H: 5.0 });
    note('Gate bastion', { kind: 'block', x: bx, z0: bz, z1: bz + 8, src: 'the preview and renders (a crenellated block with an arched door where the wall ends, rider\'s left): size estimated' });
  }
  // ---- the Great Wall: down the rider's left beside the jib sections, 5 m over the terraces it shelters, 3 m thick,
  // crenellated (m_olybuild.js draws it); across the top of the course; a brick parapet on section 1's middle terrace -----
  {
    const X = 29.2, snowBy = snowNow();
    // (its foot: the highest snow within 3.5 m of it, so it stands 5 m over the terrace beside it, as in the footage)
    const foot = (x, z, g) => { let y = g; for (const [dx, dz] of [[-3.5, 0], [-2, 0], [0, 2.5], [0, -2.5], [-2.5, 2.5]]) y = Math.max(y, snowBy(x + dx, z + dz) - 0.25); return y; };
    for (const [a, b] of [[[X, -30], [X, 244]], [[X - 1.5, -30], [14, -30]]]) {
      const w = new Block({ name: 'Great Wall', group: 'Walls', a, b, t: 3.0, H: 5.0, base: foot });
      ground2.push(w); walls.push(w);
    }
    // the middle terrace's brick right edge in section 1, with merlons (the preview's)
    { const M = d1.M, x = 2.0; const w = new Block({ name: 'Great Wall', group: 'Walls', a: [x, M.zA + 4], b: [x, M.zB - 1.5], t: 1.6, H: 2.0, base: (xx, z) => snowBy(x + 1.2, z) - 0.15 }); ground2.push(w); walls.push(w); }
    note('Great Wall (left)', { kind: 'wall', x: X, z0: -30, z1: 244, H: 5.0, t: 3.0, src: 'stated (a replica on the rider\'s left through the first three sections); about 5 m over the terraces and 3 m thick from the preview (bricks 0.6 x 0.3 m, a worker for scale)' });
  }

  // ---- Section 4: the twin skews over one table ("Twisted Sisters") --------------------------------------------------
  // (one wide table under both skews; between their in-runs only a broad low mound rises to it, not a lane of its own:
  // as a 14 m wide roller it buried the skews' in-runs and riders reached their lips at 6 m/s)
  const T4 = { name: 'Section 4 table', group: 'Jump 4', x: 0, lip: 0, drop: 0, table: 11, land: 34, Rk: 7, wT: 5.5, wTab: 14, wD: 5.5, wL: 16, vLip: 12, noCheck: true, sideS: 2.4, shoulder: 0.3, landS: 0.62, tabZ: [2, 4.5] };
  T4.R = 110; T4.z0 = 286;
  const t4 = new Kicker(T4);
  kickers.push(t4); shapes.push(t4);
  const SK4 = { group: 'Jump 4', lip: 29, drop: 1.0, land: 34, wT: 3.6, wD: 3.6, wL: 7, Rk: 6, cut: true, sideS: 2.6, shoulder: 0.25 };
  const sk4 = [-1, 1].map(sd => {
    const o = Object.assign({}, SK4, { name: `Section 4 ${sd < 0 ? 'right' : 'left'} skew`, yaw: -sd * 9 * RAD });
    const lx = t4.cxT + sd * (t4.wTab - 3.6), lz = t4.L.z + 4.8;
    const [R, fx, fz] = skewPlace(o, lx, lz, t4.yT);
    const k = new SkewKicker(Object.assign(o, { R, x: fx, z: fz, table: Math.max(6, (t4.K.z - lz) / Math.cos(o.yaw)) }));
    // (the speed wanted at its foot: its takeoff climbs 8 m, and the bot rides showed the usual sums 1.5 m/s short there:
    // riders leaving its foot at the old figure came off the lip at 12.2 m/s against 13.7 and landed on the knuckle)
    k.vDesign += 1.5; k.k.vDesign = k.vDesign;
    meshed.push(k); shapes.push(k);
    note(o.name, { kind: 'skew', lipX: +k.lipX.toFixed(1), lipZ: +k.lipZ.toFixed(1), yaw: 9 * sd, lipH: +(k.L.y - k.k.bl(k.L.z)).toFixed(2), sweetSpot: +(t4.Kend.z + 0.35 * (t4.zMeet - t4.Kend.z) - k.lipZ).toFixed(1), src: 'stated: twin skews over one table, 19 m to the landing\'s sweet spot; turn and size estimated' });
    return k;
  });
  note('Section 4 table', { kind: 'table', z0: t4.z0, lipZ: +t4.L.z.toFixed(1), knuckleZ: +t4.K.z.toFixed(1), knuckleH: +t4.knuckleH.toFixed(2), land: t4.land, landEnd: +t4.zMeet.toFixed(1) });

  // ---- Section 5: the pile ("The Matrix"): a roller to the knuckle peaking at 9 m, transfer kickers either side, twin
  // quarterpipes down the landing's sides --------------------------------------------------------------------------------
  const T5 = { name: 'Section 5 roller to the knuckle', group: 'Jump 5', x: 0, lip: 0, drop: 0, table: 4.5, land: 35, Rk: 8, wT: 4.0, wTab: 0, wD: 5, wL: 17, vLip: 14, noCheck: true, sideS: 2.2, shoulder: 1.4, landS: 0.6 };
  // (the roller's radius for its top 9 m over the slope at the knuckle, the figure the builders gave)
  {
    let lo = 40, hi = 600, z0 = t4.zMeet + 38;
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2, k = new Kicker(Object.assign({}, T5, { z0, R: m, geomOnly: true })); const kh = k.yT - baseLine(k.K.z); if (kh < 9) lo = m; else hi = m; }
    T5.R = (lo + hi) / 2; T5.z0 = z0;
  }
  const t5 = new Kicker(T5);
  kickers.push(t5); shapes.push(t5);
  note('Section 5 roller to the knuckle', { kind: 'roller', z0: t5.z0, knuckleZ: +t5.K.z.toFixed(1), peak: +(t5.yT - baseLine(t5.K.z)).toFixed(2), landEnd: +t5.zMeet.toFixed(1), src: 'stated: the roller peaks at 9 m; shape from the render: estimated' });
  // the transfer kickers: 5 m lips, turned in 16 degrees, standing beside the pile, flying across its side to its landing
  const sk5 = [-1, 1].map(sd => {
    const o = { name: `Section 5 ${sd < 0 ? 'right' : 'left'} transfer kicker`, group: 'Jump 5', lip: 29, drop: 0.8, land: 34, table: 3, wT: 3.6, wD: 3.6, wL: 5, Rk: 4, cut: true, sideS: 2.6, shoulder: 0.25, yaw: -sd * 12 * RAD };
    const lipZ = t5.K.z - 13, lipX = sd * 16.5;
    // a cut skew stands on the slope: its own table height found so its lip is 5 m over the slope there
    const [R, fx, fz] = skewPlace(o, lipX, lipZ, baseLine(lipZ) + 5 - o.drop);
    const k = new SkewKicker(Object.assign(o, { R, x: fx, z: fz }));
    /* its speed off the lip: the one that comes down about 21 m out on the pile's landing (the stated sweet spot), a
       flight along its turn with the air's drag (its own cut table has no landing of its own to aim at) */
    {
      const a = o.lip * RAD, dx = Math.sin(o.yaw), dz = Math.cos(o.yaw), kd = 0.5 * 1.2 * 0.5 / 78;
      const land = (z) => t5.tableY(z) > -Infinity ? Math.max(baseLine(z), t5.tableY(z)) : baseLine(z);
      const out = v => { let h = v * Math.cos(a), vy = v * Math.sin(a), d = 0, y = k.L.y; for (let t = 0; t < 6; t += 0.01) { const sp = Math.hypot(h, vy); h -= kd * sp * h * 0.01; vy -= (9.81 + kd * sp * vy) * 0.01; d += h * 0.01; y += vy * 0.01; if (d > 1 && y <= land(k.lipZ + d * dz)) return d; } return 99; };
      let lo = 6, hi = 26; for (let i = 0; i < 26; i++) { const m = (lo + hi) / 2; if (out(m) < 21) lo = m; else hi = m; }
      const rise = k.k.L.y - k.k.bl(0); k.vLip = k.k.vLip = (lo + hi) / 2; k.vDesign = k.k.vDesign = Math.sqrt(k.vLip * k.vLip + 2 * 9.81 * rise * (1.12 + 0.02 * rise)) + 1.1;
    }
    meshed.push(k); shapes.push(k);
    note(o.name, { kind: 'transfer', lipX: +k.lipX.toFixed(1), lipZ: +k.lipZ.toFixed(1), yaw: 12 * sd, lipH: +(k.L.y - k.k.bl(k.L.z)).toFixed(2), src: 'stated: 5 m kickers hit diagonally onto the one landing; place estimated' });
    return k;
  });
  const onLanding = k => (x, z, g) => g + Math.max(0, k.tableY(z) - k.bl(z));
  const q5 = [-1, 1].map(dir => {
    const q = new Quarter({ name: `Section 5 ${dir < 0 ? 'right' : 'left'} quarterpipe`, group: 'Jump 5', dir, z0: t5.Kend.z + 3, z1: t5.zMeet + 6, R: 3.8, vert: 0.4, deck: 2.0, entry: 8, exit: 8, backS: 0.9, xAt: z => t5.cxT + dir * t5.hwAt(z), base: onLanding(t5) });
    meshed.push(q); pipes.push(q);
    note(q.name, { kind: 'quarterpipe', z0: +q.z0.toFixed(1), z1: +q.z1.toFixed(1), R: 3.8, src: 'stated: twin quarterpipes on the pile; their place on the landing\'s sides estimated' });
    return q;
  });

  // ---- Section 6: one straight kicker, 5 m tall, over a 21 m table --------------------------------------------------
  const K6 = { name: 'Section 6 kicker', group: 'Jump 6', x: 0, lip: 31, drop: 1.2, table: 21, land: 35, Rk: 8, wT: 5.5, wD: 8, wL: 14, sideS: 2.4, shoulder: 1.4, landS: 0.6, z0: t5.zMeet + 30 };
  K6.R = kickerFor(K6, 5);
  const k6 = new Kicker(K6);
  kickers.push(k6); shapes.push(k6);
  note('Section 6 kicker', { kind: 'kicker', z0: k6.z0, lipZ: +k6.L.z.toFixed(1), lipH: +k6.lipH.toFixed(2), lip: 31, table: 21, land: 35, landEnd: +k6.zMeet.toFixed(1), src: 'stated: a 5 m kicker over a 21 m table; lip angle and landing estimated' });
  // the two stepped crenellated wall pieces beside it (rider's left of the table): blocks that step down with the table
  for (const [xo, h] of [[k6.hwAt(k6.K.z) + 6.5, 3.4], [k6.hwAt(k6.K.z) + 13, 2.8]]) {
    const w = new Block({ name: 'Stepped wall', group: 'Walls', a: [xo, k6.L.z - 6], b: [xo, k6.K.z + 4], t: 2.0, H: h, step: true });
    ground2.push(w); walls.push(w);
  }

  // ---- the halfpipe beside the course on the rider's right (its line from OpenStreetMap): two walls 6.7 m tall -------
  {
    const a = [-143.5, 380], b = [-75, 655.5], mid = z => a[0] + (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]);
    for (const dir of [-1, 1]) {
      const q = new Quarter({ name: `Halfpipe ${dir < 0 ? 'right' : 'left'} wall`, group: 'Halfpipe', dir, z0: a[1] + 6, z1: b[1] - 4, R: 6.3, vert: 0.4, deck: 5, entry: 26, exit: 10, backS: 0.75, xAt: z => mid(z) + dir * 9.5 });
      // (a straight wall beside the course, seen more than ridden: rows every 3 m, 1.5 over its ends, columns 0.6 m by arc
      // length; its far copy as coarse again: it was 76k triangles near and far, now about a fifth)
      q.rows = () => [...new Set([...span(q.z0, q.z0 + q.entry, 1.5), ...span(q.z0 + q.entry, q.z1 - q.exit, 3), ...span(q.z1 - q.exit, q.z1, 1.5)].map(v => Math.round(v * 1000) / 1000))].sort((p, r) => p - r);
      q.rowsFar = () => span(q.z0, q.z1, 6);
      const cols = q.cols.bind(q); q.cols = () => cols(false, 0.6); q.colsFar = () => cols(false, 1.4);
      meshed.push(q); pipes.push(q);
    }
  }

  // ---- the starts --------------------------------------------------------------------------------------------------
  const starts = [
    { name: 'Start (the top of the course)', x: 0, z: -12, v: 2.5 },
    { name: 'Section 2 (the watchtower)', x: 14, z: S2.zA - 26, v: 7 },
    { name: 'Section 3 (gap, roller, cannon)', x: 14, z: S3.zA - 24, v: 7 },
    startFor('Section 4 (the twin skews)', -10, sk4[0].z - 50, sk4[0].z, sk4[0].vDesign, { yaw: 0 }),
    // (each from just past the landing above it, as a rider dropping in there would: a start on a landing is no start)
    startFor('Section 5 (the roller and the transfers)', 0, t4.zMeet + 3, t5.z0, 15),
    startFor('Section 6 (the last kicker)', 0, t5.zMeet + 3, k6.z0, k6.vDesign),
  ];
  // the speeds at each jump's foot from the top, straight down the middle (for the sheet)
  note('Speeds', { v4: +rollTo(-12, 2.5, sk4[0].z).v.toFixed(1), v4need: +sk4[0].vDesign.toFixed(1), v6need: +k6.vDesign.toFixed(1) });

  // ---- the course's edges: the finish corral, the boundary fences (blue boards), the windbreak --------------------------
  const finish = { z0: ZF, z1: ZF + 82, x0: -36, x1: 36 };
  const fences = [];
  const park = assemble({ kickers, rails, starts, meshed, ground2, pipes, fences, banner: null });
  park.genting = true; park.hasLift = true;
  park.course = { kickers, rails, meshed, walls, blocks, decor, sheet, t4, sk4, t5, sk5, q5, k6, d1, d2, d3, S1, S2, S3, finish, jumpDeg, ZF };
  park.plan = null;
  return park;
}
