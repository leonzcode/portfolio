// The park: kickers, a superpipe, rollers, butter pads, rails and boxes, laid out as real parks are (a jump line
// from small to large, a rail garden, the pipe, one big air, a jib line at the bottom). Every shape is a height
// function the physics reads directly; kickers and the pipe also get meshes of their own, much finer at the lips,
// knuckles and coping than the terrain's patches.
import * as THREE from 'three';
import { baseLine, pitchAt, ground, setRun, height, getPark } from './terrain.js?v=26';
import { smoothstep, clamp, smax } from './noise.js?v=26';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const RAD = Math.PI / 180;
const TAN65 = Math.tan(65 * RAD), TAN30 = Math.tan(30 * RAD);   // (2026-11-12, loading: worked out once; the same numbers)

// ---- kickers --------------------------------------------------------------------------------------------------------
// The centre line in (z, y): a takeoff arc of radius R from the slope's pitch up to the lip angle, a steep back face
// down to a level table, a rounded knuckle, a straight landing, and a blend back into the slope.
/* Across it (2026-11-05, for riding over a kicker's sides and knuckle and landing on its sides): a flat core as wide as
   the takeoff (the jump plus, on the Jump Line, the strip beside it that carries a rail or box), a rounded shoulder,
   then sides of about 32 degrees (sideS) and a soft toe into the snow. The landing's sides are gentler (landS), so
   with the landing's own 34 degrees no side is steeper than about 42; the old sides were 49 to 58 degrees with sharp
   edges. The lip's back face is steep only across the core and eases to 30 degrees within 1.6 m past its edges. */
// (a soft max(v, 0) over +-t; t shrinks with the centre line's own height, so where that is 0, at the takeoff's foot and
// the landing's run-out, nothing is added and the kicker ends flush with the snow)
const toe = (v, t) => t < 1e-4 ? Math.max(v, 0) : v >= t ? v : v <= -t ? 0 : (v + t) * (v + t) / (4 * t);
export class Kicker {
  // (the slope it stands on: the run's own, or a map's: o.base(z) -> y and o.pitch(z) -> radians, Freeride's rock kickers)
  bl(z) { return this.base ? this.base(z) : baseLine(z); }
  pa(z) { return this.pitch ? this.pitch(z) : pitchAt(z); }
  constructor(o) {
    Object.assign(this, { lip: 27, R: 10, drop: 0.5, table: 10, Rk: 3.5, land: 31, wT: 2.6, wD: 4.5, wL: 7.5, name: 'kicker',
      side: 1, wF: 0, sideS: 0.62, landS: 0.5, shoulder: 0.8, toe: 0.35, wTab: 0 }, o);
    this.ownMesh = true;
    // the takeoff's core: the jump (x +- wT) and the feature strip of width wF on one side of it
    this.cxT = this.x + this.side * this.wF / 2; this.hwT = this.wT + this.wF / 2;
    this.splay = Math.max(0, (this.wD - this.wT) * 0.5);          // the table widens a little towards the knuckle
    // (J, round 10: wTab, a table wider than the takeoff, reached 4 m past the lip: jump 1's, under its two skews)
    this.tab = this.wTab > this.hwT ? this.wTab - this.hwT : 0;
    this.hwLand = Math.max(this.wL + this.wF / 2, this.hwT + this.tab + this.splay + 0.5);
    this.ents = [];                                               // snow ramps up to the features' starts (Jump Line)
    const p = this.pa(this.z0), A = { z: this.z0, y: this.bl(this.z0) };
    const C = { z: A.z + this.R * Math.sin(p), y: A.y + this.R * Math.cos(p) };
    const lip = this.lip * RAD, land = this.land * RAD;
    this.L = { z: C.z + this.R * Math.sin(lip), y: C.y - this.R * Math.cos(lip) };
    this.arc = { C, R: this.R, a0: -p, a1: lip };
    this.zBack = this.L.z + this.drop / TAN65;
    this.yT = this.L.y - this.drop;
    this.K = { z: this.L.z + this.table, y: this.yT };
    this.Kend = { z: this.K.z + this.Rk * Math.sin(land), y: this.yT - this.Rk * (1 - Math.cos(land)) };
    this.tl = Math.tan(land);
    // where the landing meets the slope
    let z = this.Kend.z;
    while (z < this.Kend.z + 200 && this.Kend.y - (z - this.Kend.z) * this.tl > this.bl(z)) z += 0.25;
    this.zMeet = z; this.z1 = z + 14;
    this.lipH = this.L.y - this.bl(this.L.z);
    if (o.geomOnly) return;   // (C, 2026-11-11, loading: laneOn's search reads only the shape (yT, L.z); the flights below were most of the Jump Line's start-up, about 2 s on a slow processor)
    /* the speed off the lip that lands about 45% of the way down the landing, with the air's drag the skier feels in flight
       (left out, the big jumps' riders landed on the knuckle: 2026-11-03) */
    // (aimed deeper for a higher lip: the riders' flights come out a little shorter than this one, more so on the big
    // jumps, measured: a 1.6 m lip landed where it was aimed, a 4.3 m one 23% of the landing short)
    const frac = clamp(0.45 + 0.08 * (this.lipH - 1.6), 0.4, 0.75);
    // (2026-11-12: a kicker made from the Jump Line's plan is given it, as the same search found it before: makeJumpLine)
    if (!(o.vLip > 0)) this.vLip = this.lipFor(this.Kend.z + frac * (this.zMeet - this.Kend.z));
    // the speed at the foot of the takeoff that leaves the lip at vLip (climbing the ramp costs g x its rise, and the
    // snow and the air take more on a long ramp)
    const rise = this.L.y - this.bl(this.z0);
    this.vDesign = Math.sqrt(this.vLip * this.vLip + 2 * 9.81 * rise * (1.12 + 0.02 * rise)) + 0.5;
    // (J, 2026-11-08) and the least speed at the foot that still clears the knuckle well: the flight aimed at 30% of the
    // landing (riders' flights come out somewhat shorter, more so off a big lip): what the Jump Line spaces its jumps by
    // (2026-11-12, loading: worked out the first time it is asked for, vClear below; the game itself never reads it, and
    // the Jump Line's layout makes about 140 kickers it only wants vDesign from)
    this._vcT = this.Kend.z + 0.3 * (this.zMeet - this.Kend.z); this._rise = rise;
    this.knuckleH = this.yT - this.bl(this.K.z);
    // how far out the sides reach: the highest point over the slope down the gentler side slope, the shoulder and the toe
    const hMax = Math.max(this.lipH, this.knuckleH) + 0.3;
    const reach = Math.max(this.hwT + this.splay, this.hwLand) + hMax / Math.min(this.sideS, this.landS) + this.shoulder + this.toe + 0.5;
    this.x0 = this.cxT - reach; this.x1 = this.cxT + reach;
  }
  // the speed off the lip whose flight (with the air's drag) comes down at z = target, by bisection
  lipFor(target) {
    const lip = this.lip * RAD, kd = 0.5 * 1.2 * 0.5 / 78, dt = 0.01;
    let lo = 4, hi = 34;
    for (let it = 0; it < 30; it++) {
      const v = (lo + hi) / 2;
      let vz = v * Math.cos(lip), vy = v * Math.sin(lip), z = this.L.z, y = this.L.y, zl = Infinity;
      for (let t = 0; t < 8; t += dt) {
        const sp = Math.hypot(vz, vy); vz -= kd * sp * vz * dt; vy -= (9.81 + kd * sp * vy) * dt; z += vz * dt; y += vy * dt;
        const d = this.deckY(z), gy = d > -Infinity ? d : this.bl(z);
        if (z > this.L.z + 0.5 && y <= gy) { zl = z; break; }
      }
      if (zl < target) lo = v; else hi = v;
    }
    return (lo + hi) / 2;
  }
  get vClear() {
    if (this._vClear === undefined && this._vcT !== undefined) { const v = this.lipFor(this._vcT), r = this._rise; this._vClear = Math.sqrt(v * v + 2 * 9.81 * r * (1.12 + 0.02 * r)) + 0.5; }
    return this._vClear;
  }
  set vClear(v) { this._vClear = v; }
  // centre-line height of the takeoff (or -Inf) and of the deck (or -Inf)
  takeY(z) {
    if (z < this.z0 || z > this.L.z) return -Infinity;
    const { C, R } = this.arc, s = clamp((z - C.z) / R, -1, 1);
    return C.y - R * Math.cos(Math.asin(s));
  }
  deckY(z) {
    if (z < this.L.z || z > this.z1) return -Infinity;
    if (z < this.zBack) return this.L.y - (z - this.L.z) * TAN65;
    return this.tableY(z);
  }
  // the table, the knuckle and the landing (no back face)
  tableY(z) {
    if (z < this.K.z) return this.yT;
    if (z < this.Kend.z) { const s = (z - this.K.z) / this.Rk; return this.yT - this.Rk * (1 - Math.sqrt(Math.max(0, 1 - s * s))); }
    const lineY = this.Kend.y - (z - this.Kend.z) * this.tl;
    return smax(lineY, this.bl(z), this.blend());
  }
  /* how gently the landing rounds into the slope: 2.2 m, less on a landing so short that the rounding would have reached
     back up to the knuckle's end and left a step there (the small lanes of jumps 5 to 7 threw riders off it at walking
     pace, 2026-11-05) */
  blend() { return this._bl ?? (this._bl = clamp((this.Kend.y - this.bl(this.Kend.z)) * 0.9, 0.3, 2.2)); }
  // the core's half width along the kicker: the takeoff's, splaying a little along the table, then out to the landing's
  hwAt(z) {
    if (z <= this.L.z) return this.hwT;
    const t = this.tab ? this.tab * smoothstep(this.L.z - 0.5, this.L.z + 4, z) : 0;
    if (z <= this.K.z) return this.hwT + t + this.splay * (z - this.L.z) / (this.K.z - this.L.z);
    return this.hwT + t + this.splay + (this.hwLand - this.hwT - t - this.splay) * smoothstep(this.K.z, this.zMeet, z);
  }
  deckHalf(z) { return this.hwAt(z); }
  // the side slope: sideS, easing to landS down the knuckle (the landing's own pitch adds to its sides')
  sideAt(z) { return this.sideS + (this.landS - this.sideS) * smoothstep(this.K.z, this.Kend.z + 3, z); }
  // the centre line's height over the run's base line, d metres outside the core (the lip's back face eases off there)
  rel(z, d) {
    if (z < this.z0 || z > this.z1) return -Infinity;
    if (z <= this.L.z) return this.takeY(z) - this.bl(z);
    const t = clamp(d / 1.6, 0, 1), k = t * t * (3 - 2 * t);
    const back = this.drop / (TAN65 + (TAN30 - TAN65) * k);
    if (z < this.L.z + back) return this.L.y - (z - this.L.z) * (this.drop / back) - this.bl(z);
    return this.tableY(z) - this.bl(z);
  }
  sideDrop(d, s) { const r = this.shoulder; return d <= 0 ? 0 : d < r ? s * d * d / (2 * r) : s * (d - r / 2); }
  // height over the ground of the kicker's own snow (no entry ramps), or <= 0
  bareRel(x, z) {
    const d = Math.abs(x - this.cxT) - this.hwAt(z), c = this.rel(z, d);
    if (c === -Infinity) return -Infinity;
    this._c = c;
    return c - this.sideDrop(d, this.sideAt(z));
  }
  toeOf() { return Math.min(this.toe, Math.max(0, this._c) * 0.5); }
  /* the snow ramps up to features' starts: rising along z to h at z1, level with the ramp at both ends (so it lifts the
     skis onto the feature's top instead of throwing them over it), a little under the start, then easing away */
  entryRel(x, z) {
    let best = 0;
    for (const e of this.ents) {
      if (z < e.z0 || z > e.z1 + 1.8) continue;
      const ax = Math.abs(x - e.x), dx = ax - e.hw; if (dx > 1.6) continue;
      // (behind the start it goes within 0.6 m under the feature, but its sides ease away over 1.6 m: steeper, they stood out
      // past the feature as a steep face)
      const back = 0.6 + smoothstep(e.hw - 0.35, e.hw + 0.25, ax);
      let r = z <= e.z1 ? e.h * smoothstep(e.z0, e.z1, z) : z < e.z1 + 0.2 ? e.h : e.h * (1 - smoothstep(e.z1 + 0.2, e.z1 + 0.2 + back, z));
      // (its flanks: a rounded edge, then 27 degrees, so a rider passing just beside it rolls over them; they were 44)
      if (dx > 0) r -= dx < 0.5 ? 0.5 * dx * dx : 0.5 * (dx - 0.25);
      if (r > best) best = r;
    }
    return best;
  }
  height(x, z, g) {
    if (z < this.z0 - 0.5 || z > this.z1 || x < this.x0 || x > this.x1) return -Infinity;
    let rel = this.bareRel(x, z);
    if (rel === -Infinity) return -Infinity;
    const tt = this.toeOf();
    if (this.ents.length && rel > 0) rel += this.entryRel(x, z);
    rel = toe(rel, tt);
    return rel > 0 ? g + rel : -Infinity;
  }
  // the snow under a point of a feature on this kicker (no entry ramps)
  snowY(x, z) { const g = ground(x, z), r = this.bareRel(x, z); return g + (r > -Infinity ? toe(r, this.toeOf()) : 0); }
  surface(x, z) { return z > this.z0 && z < this.zMeet && Math.abs(x - this.cxT) < this.hwAt(z) + 1.5; }
  // the dye lines park crews spray: along the jump's lip, down the jump's edges just below it, and across the knuckle
  dye(x, z) {
    const dx = Math.abs(x - this.x);
    if (Math.abs(z - this.L.z + 0.08) < 0.1 && dx < this.wT) return 1;
    if (this.wF > 0 && z > this.L.z - 1.4 && z < this.L.z && Math.abs(dx - this.wT) < 0.07) return 1;
    if (Math.abs(z - this.K.z - 0.4) < 0.12 && Math.abs(x - this.cxT) < this.hwAt(this.K.z)) return 1;
    return 0;
  }
  // rows in z: fine at the lip, its back face and the knuckle (the entry ramps have grids of their own: entryGrid)
  rows(fine) {
    const r = [], st = fine ? 0.6 : 1.0;
    for (let z = this.z0 - 0.5; z < this.L.z; z += st) r.push(z);
    for (let z = this.L.z; z < this.K.z - 0.5; z += fine ? 1.2 : 2.0) r.push(z);
    for (let z = this.Kend.z + 0.5; z < this.z1; z += fine ? 1.2 : 2.0) r.push(z);
    for (let z = this.L.z - 0.5; z < this.L.z + this.drop * 1.75 + 0.3; z += fine ? 0.06 : 0.1) r.push(z);
    for (let z = this.K.z - 0.5; z < this.Kend.z + 0.5; z += fine ? 0.2 : 0.35) r.push(z);
    for (const z of [this.L.z - 0.2, this.L.z - 0.17, this.L.z + 0.03, this.K.z + 0.26, this.K.z + 0.29, this.K.z + 0.51, this.K.z + 0.54, this.L.z - 1.4]) r.push(z);
    r.push(this.L.z, this.L.z - 0.005, this.zBack);
    return [...new Set(r.map(v => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
  }
  // columns in x: fine over the shoulders and the dye lines, coarse over the flat core and the plain side slopes
  cols(fine) {
    const c = [], st = fine ? 0.9 : 1.4;
    for (let x = this.x0; x <= this.x1; x += st) c.push(x);
    for (const hw of [this.hwT, this.hwT + this.tab + this.splay, (this.hwT + this.hwLand) / 2, this.hwLand]) for (const s of [-1, 1])
      for (const e of fine ? [-0.25, 0, 0.2, 0.4, 0.6, 0.8, 1.1] : [-0.2, 0, 0.4, 0.8]) c.push(this.cxT + s * (hw + e));
    for (const s of [-1, 1]) for (const e of [-0.12, -0.07, 0, 0.07, 0.12]) c.push(this.x + s * (this.wT + e));
    return [...new Set(c.map(v => Math.round(v * 1000) / 1000))].filter(v => v >= this.x0 && v <= this.x1).sort((a, b) => a - b);
  }
  /* (J, 2026-11-11) a snow ramp up to a feature's start, drawn as a small grid of its own over just its footprint: as rows
     and columns of the kicker's own grid they ran its whole length and width, 38k of the Jump Line's 173k snow triangles
     on the low tier (96k of 429k on medium) */
  entryGrid(e, step) {
    const xs = [], zs = [], x0 = e.x - e.hw - 1.6, x1 = e.x + e.hw + 1.6, z0 = e.z0 - 0.1, z1 = e.z1 + 2.0;
    for (let x = x0; x <= x1 + 1e-6; x += step) xs.push(x);
    for (const d of [-0.25, 0, 0.25, 0.5]) for (const sg of [-1, 1]) xs.push(e.x + sg * (e.hw + d));
    for (let z = z0; z <= z1 + 1e-6; z += step) zs.push(z);
    zs.push(e.z1, e.z1 + 0.2);
    const u = a => [...new Set(a.map(v => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
    return { xs: u(xs).filter(x => x >= x0 - 1e-6 && x <= x1 + 1e-6), zs: u(zs).filter(z => z >= z0 - 1e-6 && z <= z1 + 1e-6) };
  }
}

// ---- the superpipe ---------------------------------------------------------------------------------------------------
// Cross-section: a flat bottom, quarter-circle transitions of radius R, a short near-vertical lip up to the coping, a
// flat deck, then the outside slope. Walls grow over the drop-in and shrink at the end.
class Pipe {
  constructor(o) {
    Object.assign(this, { F: 7.0, R: 6.0, vert: 0.6, deck: 4.0, entry: 30, exit: 14, name: 'superpipe' }, o);
    this.ownMesh = true;
    this.H = this.R + this.vert;
    this.x0 = this.x - (this.F + this.R + this.deck + this.H / 0.7 + 2);
    this.x1 = this.x + (this.F + this.R + this.deck + this.H / 0.7 + 2);
  }
  wall(a) {        // height of the cross-section at a metres out from the bottom's edge
    const { R, vert, deck, H } = this;
    if (a <= 0) return 0;
    if (a < R * 0.995) return R - Math.sqrt(R * R - a * a);
    if (a < R + 0.15) { const t = (a - R * 0.995) / (R + 0.15 - R * 0.995); return (R - Math.sqrt(R * R - (R * 0.995) ** 2)) + t * (H - (R - Math.sqrt(R * R - (R * 0.995) ** 2))); }
    if (a < R + 0.15 + deck) return H;
    return Math.max(0, H - (a - R - 0.15 - deck) * 0.7);
  }
  scale(z) { return smoothstep(this.z0, this.z0 + this.entry, z) * (1 - smoothstep(this.z1 - this.exit, this.z1, z)); }
  height(x, z, g) {
    if (z < this.z0 || z > this.z1 || x < this.x0 || x > this.x1) return -Infinity;
    const s = this.scale(z); if (s <= 0) return -Infinity;
    const bz = baseLine(z), lift = g - bz;
    const a = Math.abs(x - this.x) - this.F;
    return bz + lift * (a > 0 ? 1 : 1) + this.wall(a) * s;
  }
  surface(x, z) { return z > this.z0 && z < this.z1 && Math.abs(x - this.x) < this.F + this.R + this.deck; }
  rows(fine) { const r = []; for (let z = this.z0 - 0.5; z <= this.z1 + 0.5; z += fine ? 1.2 : 2.0) r.push(z); return r; }
  cols(fine) {
    // spaced by arc length along the cross-section, so the steep coping gets as many points as the flat
    // (J, round 10: the flat bottom, the deck and the outside slope, which are planes, at 1 to 1.6 m: the superpipe's
    // 8 m decks had 16 to 27 columns each, about a third of its 31 000 triangles on the low tier)
    const half = [], st0 = fine ? 0.3 : 0.5, flat = fine ? 1.0 : 1.6, aW = this.R + 0.3;
    let a = -this.F, prevY = this.wall(a);
    half.push(a);
    const end = this.R + 0.15 + this.deck + this.H / 0.7 + 2;
    while (a < end) {
      const st = a < -0.5 ? Math.min(flat, -a) : a < aW ? st0 : flat;
      let da = st;
      for (let k = 0; k < 6; k++) { const y = this.wall(a + da); const l = Math.hypot(da, y - prevY); if (l > st * 1.05) da *= st / l; else break; }
      da = Math.max(da, 0.008);
      a += da; prevY = this.wall(a); half.push(a);
    }
    half.push(this.R + 0.15 + this.deck);           // (the deck's outer edge, where the outside slope starts)
    const c = [];
    for (const v of half) c.push(this.x + this.F + v, this.x - this.F - v);
    return [...new Set(c.map(v => Math.round(v * 1000) / 1000))].filter(v => v >= this.x0 && v <= this.x1).sort((a, b) => a - b);
  }
}

// a quarterpipe: one pipe wall standing across the slope, ridden into from the side (dir +1 rises towards +x)
class QuarterPipe extends Pipe {
  constructor(o) {
    super(Object.assign({ F: 0, R: 4.2, vert: 0.4, deck: 3.0, entry: 6, exit: 6, name: 'quarterpipe', dir: 1 }, o));
    const reach = this.R + 0.15 + this.deck + this.H / 0.7 + 1;
    this.x0 = this.dir > 0 ? this.x - 1 : this.x - reach; this.x1 = this.dir > 0 ? this.x + reach : this.x + 1;
  }
  height(x, z, g) {
    if (z < this.z0 || z > this.z1 || x < this.x0 || x > this.x1) return -Infinity;
    const s = this.scale(z); if (s <= 0) return -Infinity;
    const a = (x - this.x) * this.dir;
    return g + this.wall(a) * s;
  }
  surface(x, z) { const a = (x - this.x) * this.dir; return z > this.z0 && z < this.z1 && a > -0.5 && a < this.R + this.deck; }
  cols(fine) { return super.cols(fine).filter(v => (v - this.x) * this.dir >= -0.6); }
}

// ---- ground shapes that the terrain patches draw (no meshes of their own) ------------------------------------------
class Rollers {
  constructor(o) { Object.assign(this, { amp: 1.2, len: 14, n: 3, x: 0, w: 30 }, o); this.z1 = this.z0 + this.len * this.n; this.x0 = this.x - this.w - 4; this.x1 = this.x + this.w + 4; }
  height(x, z, g) {
    if (z < this.z0 || z > this.z1 || x < this.x0 || x > this.x1) return -Infinity;
    const s = Math.sin(Math.PI * (z - this.z0) / this.len);
    const edge = 1 - smoothstep(this.w - 4, this.w + 4, Math.abs(x - this.x));
    return g + this.amp * s * s * edge;
  }
  surface() { return false; }
}
class Mound {            // butter pads and small hips
  constructor(o) { Object.assign(this, { r: 6, h: 0.7 }, o); this.x0 = this.x - this.r; this.x1 = this.x + this.r; this.z1 = this.z + this.r; this.zs = this.z - this.r; }
  height(x, z, g) {
    const d = Math.hypot(x - this.x, z - this.z) / this.r; if (d >= 1) return -Infinity;
    const c = Math.cos(d * Math.PI) * 0.5 + 0.5; return g + this.h * c;
  }
  surface(x, z) { return Math.hypot(x - this.x, z - this.z) < this.r * 0.8; }
}
class Wedge {            // a short ramp up to a rail or box
  constructor(o) { Object.assign(this, { len: 3.5, hw: 1.3 }, o); this.x0 = this.x - this.hw - 2; this.x1 = this.x + this.hw + 2; this.zs = this.zEnd - this.len; }
  height(x, z, g) {
    if (z < this.zs || z > this.zEnd + 1.2) return -Infinity;
    const dx = Math.abs(x - this.x);
    let rel = z <= this.zEnd ? this.h * ((z - this.zs) / this.len) ** 1.3 : this.h - (z - this.zEnd) * (this.h / 1.2);
    rel -= Math.max(0, dx - this.hw) * 0.9;
    return rel > 0 ? g + rel : -Infinity;
  }
  surface(x, z) { return z > this.zs && z < this.zEnd && Math.abs(x - this.x) < this.hw; }
}

// ---- rails and boxes ---------------------------------------------------------------------------------------------------
/* pts: [x, z, height of the top over the snow], or with abs: true [x, z, y of the top]. The top line is what the skis
   ride. kind: 'rail' (round steel), 'tube' (a fat round plastic tube), 'box' (a flat top on coloured sides), 'bench' (a
   wooden seat), 'rainbow' (an arc), 'dd' (a donkey dick: a short tube sticking out of a lip), 'kink' (up, level, then
   down), 'down'. top: 'round' or 'flat'. w: the top's width (m), wider than before everywhere (2026-11-05, for "make all
   rails wider in size"): steel rails 0.12 or more, tubes 0.34 to 0.5, boxes 0.6 to 0.8, benches 0.5 to 0.6. h: the top's
   height over the snow under its start (hAt(s) anywhere along it); under(x, z): that snow. */
const FLAT_KINDS = new Set(['box', 'bench', 'ledge', 'picnic']);
const WIDTH = { rail: 0.16, tube: 0.55, box: 0.9, bench: 0.6, rainbow: 0.16, dd: 0.45, kink: 0.16, down: 0.16 };   // (J, 2026-11-08: fatter, "rails fatter")
const _hv = new THREE.Vector3();
export class Rail {
  constructor(o) {
    Object.assign(this, { kind: 'rail', name: 'rail' }, o);
    if (!this.top) this.top = FLAT_KINDS.has(this.kind) ? 'flat' : 'round';
    if (!this.w) this.w = WIDTH[this.kind] || 0.12;
    if (!this.under) this.under = ground;
    this.P = this.pts.map(([x, z, h]) => new THREE.Vector3(x, this.abs ? h : ground(x, z) + h, z));
    this.seg = []; let s = 0;
    for (let i = 0; i < this.P.length - 1; i++) {
      const a = this.P[i], b = this.P[i + 1], d = b.clone().sub(a), len = d.length();
      this.seg.push({ a, b, d: d.clone().divideScalar(len), len, s0: s }); s += len;
    }
    this.len = s;
    this.box = new THREE.Box3().setFromPoints(this.P).expandByScalar(1.5);
    this.h = this.P[0].y - this.under(this.P[0].x, this.P[0].z);
  }
  hAt(s) { const p = this.at(s, _hv); return p.y - this.under(p.x, p.z); }
  // the closest point on the top line to p: { s, point, dir, seg, dh (horizontal distance), dy (p above it) }
  closest(p, out = {}) {
    let best = Infinity;
    for (const g of this.seg) {
      const t = clamp(((p.x - g.a.x) * g.d.x + (p.y - g.a.y) * g.d.y + (p.z - g.a.z) * g.d.z) / g.len, 0, 1);
      const x = g.a.x + (g.b.x - g.a.x) * t, y = g.a.y + (g.b.y - g.a.y) * t, z = g.a.z + (g.b.z - g.a.z) * t;
      const dh = Math.hypot(p.x - x, p.z - z), dy = p.y - y, d = dh + Math.abs(dy) * 0.5;
      if (d < best) { best = d; out.s = g.s0 + t * g.len; out.x = x; out.y = y; out.z = z; out.dir = g.d; out.seg = g; out.dh = dh; out.dy = dy; out.t = t; }
    }
    return out;
  }
  at(s, out = new THREE.Vector3()) {
    for (const g of this.seg) if (s <= g.s0 + g.len || g === this.seg[this.seg.length - 1]) { const t = clamp((s - g.s0) / g.len, 0, 1); out.copy(g.a).lerp(g.b, t); out.dirOut = g.d; return out; }
    return out;
  }
  dirAt(s) { for (const g of this.seg) if (s <= g.s0 + g.len) return g.d; return this.seg[this.seg.length - 1].d; }
}

// ---- shapes in a frame of their own (J, round 10) -----------------------------------------------------------------
/* For "introduce different kinds of jumps that allow you to have transitions and different features" (Leon, round 10):
   hips, a spine, a shark fin, a volcano, banked turns, a step-up, a roll-in to a big air's knuckle, quarterpipes (on
   the run's edges, beside a jump's landing, a wallride) and takeoffs turned off the fall line. Each is a height over the
   snow worked out in a frame of its own: u across, s along, turned by yaw about (x, z) (0: s down the fall line, +z),
   or round a centre (PolarShape: u the radius, s the arc at radius RR). Its mesh is a grid in that frame
   (featureMeshSteps reads toWorld), kept only where it is the snow on top. None is steeper than about 45 degrees
   anywhere (skier.js takes a park feature's face over about 49 as a wall), but the quarterpipes, which are ridden as
   the superpipe is (park.pipes). */
const _sl = { u: 0, s: 0 };
const uniq = a => [...new Set(a.map(v => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
function span(a, b, st) { const o = [], n = Math.max(1, Math.ceil((b - a) / st)); for (let i = 0; i <= n; i++) o.push(a + (b - a) * i / n); return o; }
// a concave rise: 0 at its foot, H at its top, where it stands at angle A (radians); y(t), t from the foot (0 .. ext)
function rise(H, A) {
  const R = H / (1 - Math.cos(A)), ext = R * Math.sin(A);
  return { H, ext, y: t => t <= 0 ? 0 : t >= ext ? H : R - Math.sqrt(R * R - t * t) };
}
// a landing side: H at its top edge (t = 0), a knuckle of radius Rk, a straight face at angle A, a run-out of radius
// Rr down to 0 (both radii made smaller if the face is too low for them)
function fall(H, A, Rk, Rr) {
  const c = 1 - Math.cos(A), sA = Math.sin(A), tA = Math.tan(A);
  let k = Rk, r = Rr; if ((k + r) * c > H) { const f = H / ((k + r) * c); k *= f; r *= f; }
  const hK = k * c, hR = r * c, straight = Math.max(0, H - hK - hR), t1 = k * sA, t2 = t1 + straight / tA, t3 = t2 + r * sA;
  return { H, ext: t3, y: t => t <= 0 ? H : t < t1 ? H - (k - Math.sqrt(k * k - t * t)) : t < t2 ? H - hK - (t - t1) * tA : t < t3 ? r - Math.sqrt(Math.max(0, r * r - (t3 - t) * (t3 - t))) : 0 };
}
export class Shape {
  constructor(o) {
    Object.assign(this, { x: 0, z: 0, yaw: 0, ownMesh: true, local: true, trim: true, lod: true, name: 'feature', group: 'Features' }, o);
    this.sy = Math.sin(this.yaw); this.cy = Math.cos(this.yaw);
  }
  toWorld(u, s, out) { out.x = this.x + u * this.cy + s * this.sy; out.z = this.z - u * this.sy + s * this.cy; return out; }
  toLocal(x, z, out) { const dx = x - this.x, dz = z - this.z; out.u = dx * this.cy - dz * this.sy; out.s = dx * this.sy + dz * this.cy; return out; }
  // the world box round the local extents u0..u1, s0..s1 (sampled along the edges: a polar frame's box is not its corners')
  bound() {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; const p = {};
    for (let i = 0; i <= 24; i++) {
      const u = this.u0 + (this.u1 - this.u0) * i / 24, s = this.s0 + (this.s1 - this.s0) * i / 24;
      for (const [a, b] of [[u, this.s0], [u, this.s1], [this.u0, s], [this.u1, s]]) { this.toWorld(a, b, p); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    }
    this.x0 = x0 - 0.5; this.x1 = x1 + 0.5; this.zs = z0 - 0.5; this.z1 = z1 + 0.5;
    return this;
  }
  height(x, z, g) {
    if (x < this.x0 || x > this.x1 || z < this.zs || z > this.z1) return -Infinity;
    const L = this.toLocal(x, z, _sl), r = this.rel(L.u, L.s, x, z);
    return r > 0.002 ? g + r : -Infinity;
  }
  surface(x, z) { if (x < this.x0 || x > this.x1 || z < this.zs || z > this.z1) return false; const L = this.toLocal(x, z, _sl); return this.rel(L.u, L.s, x, z) > 0.05; }
}
class PolarShape extends Shape {
  toWorld(u, s, out) { const a = this.a + s / this.RR; out.x = this.x + u * Math.cos(a); out.z = this.z + u * Math.sin(a); return out; }
  toLocal(x, z, out) { const dx = x - this.x, dz = z - this.z; out.u = Math.hypot(dx, dz); let a = Math.atan2(dz, dx) - this.a; a -= 2 * Math.PI * Math.round(a / (2 * Math.PI)); out.s = a * this.RR; return out; }
}
/* a ridge along s: a hip (a takeoff face on one side, a deck, a landing face on the other), a spine (two takeoff faces
   meeting at a narrow top) or a shark fin (a spine growing taller along its length: grow, the share of its length it
   grows over). left / right: { take: A } (a concave face up to the top at angle A) or { land: A, Rk, Rr } (a knuckle, a
   face at A, a run-out). Tapered at the ends over te metres. */
export class Ridge extends Shape {
  constructor(o) {
    super(Object.assign({ H: 2.5, len: 20, deck: 0.4, te: 4, grow: 0, left: { take: 35 * RAD }, right: { land: 34 * RAD, Rk: 2.5, Rr: 5 } }, o));
    const side = d => d.take ? rise(this.H, d.take) : fall(this.H, d.land, d.Rk ?? 2.5, d.Rr ?? 5);
    this.pl = side(this.left); this.pr = side(this.right);
    this.u0 = -this.deck / 2 - this.pl.ext - 0.2; this.u1 = this.deck / 2 + this.pr.ext + 0.2; this.s0 = -0.2; this.s1 = this.len + 0.2;
    this.bound();
  }
  hs(s) {
    if (s <= 0 || s >= this.len) return 0;
    return smoothstep(0, this.grow > 0 ? this.len * this.grow : this.te, s) * smoothstep(this.len, this.len - this.te, s);
  }
  // t: metres out from the top's edge
  side(p, d, t) { return d.take ? p.y(p.ext - t) : p.y(t); }
  rel(u, s) {
    const k = this.hs(s); if (k <= 0) return -Infinity;
    const h = this.deck / 2;
    return k * (u < -h ? this.side(this.pl, this.left, -h - u) : u > h ? this.side(this.pr, this.right, u - h) : this.H);
  }
  rows(fine) { const te = Math.min(this.te, this.len / 2), tg = this.grow > 0 ? this.len * this.grow : te; return uniq([...span(0, this.len, fine ? 0.7 : 1.2), ...span(0, tg, fine ? 0.35 : 0.7), ...span(this.len - te, this.len, fine ? 0.35 : 0.7)]); }
  cols(fine) {
    const h = this.deck / 2, c = [...span(this.u0, -h, fine ? 0.45 : 0.8), ...span(h, this.u1, fine ? 0.45 : 0.8), 0];
    for (const e of [0, 0.06, 0.15, 0.3, 0.5, 0.8]) c.push(-h - e, h + e);
    return uniq(c);
  }
  // dye lines along the top's edges
  dye(x, z) { const L = this.toLocal(x, z, _sl), h = this.deck / 2; return this.hs(L.s) > 0.6 && Math.abs(Math.abs(L.u) - h - 0.05) < 0.07 ? 1 : 0; }
}
/* a volcano: a cone ridden over from any side: a concave face up to a rim at angle A, a shallow crater inside it. Off
   the rim you fly over the crater onto the far face, which is a landing that curves into the run-out. */
export class Volcano extends PolarShape {
  constructor(o) {
    super(Object.assign({ H: 2.8, Rc: 3.4, A: 30 * RAD, dip: 0.55, a: 0, RR: 1 }, o));
    this.face = rise(this.H, this.A);
    this.u0 = 0; this.u1 = this.Rc + this.face.ext + 0.2; this.s0 = -Math.PI; this.s1 = Math.PI;
    this.bound();
  }
  rel(r) { if (r < this.Rc) { const t = r / this.Rc; return this.H - this.dip * (1 - t * t); } return this.face.y(this.face.ext - (r - this.Rc)); }
  rows(fine) { return span(this.s0, this.s1, (fine ? 4 : 7) * RAD); }
  cols(fine) { return uniq([...span(0, this.Rc, fine ? 0.6 : 0.9), ...span(this.Rc, this.u1, fine ? 0.4 : 0.7), ...[0.05, 0.12, 0.25, 0.45].map(e => this.Rc + e), this.Rc - 0.1]); }
  dye(x, z) { return Math.abs(Math.hypot(x - this.x, z - this.z) - this.Rc - 0.06) < 0.07 ? 1 : 0; }
}
/* a banked turn: the snow rising outward from radius Rc round the centre (x, z), over the arc a +- half (radians, a from
   +x towards +z): a concave face H high standing at A at its top, a 0.8 m deck, a back at `back`; its ends fade out */
export class Berm extends PolarShape {
  constructor(o) {
    super(Object.assign({ H: 1.8, Rc: 6, A: 38 * RAD, half: 62 * RAD, back: 0.6, a: 0 }, o));
    this.RR = this.Rc + 2;
    this.face = rise(this.H, this.A); this.top = this.face.ext + 0.8;
    this.u0 = this.Rc - 0.2; this.u1 = this.Rc + this.top + this.H / this.back + 0.2; this.s0 = -this.half * this.RR; this.s1 = this.half * this.RR;
    this.bound();
  }
  rel(r, s) {
    const th = Math.abs(s / this.RR), t = r - this.Rc; if (th >= this.half || t <= 0) return -Infinity;
    const y = t < this.face.ext ? this.face.y(t) : t < this.top ? this.H : this.H - (t - this.top) * this.back;
    return y * smoothstep(this.half, this.half - 0.5, th);
  }
  rows(fine) { return span(this.s0, this.s1, fine ? 0.6 : 1.2); }
  cols(fine) { return uniq([...span(this.u0, this.Rc + this.top, fine ? 0.35 : 0.7), ...span(this.Rc + this.top, this.u1, fine ? 0.8 : 1.2)]); }
}
/* a feature laid along the fall line with a centre line of its own (relC(z): its height over the run's base line, or
   -Infinity where there is none) and a kicker's cross-section: a flat core hw either side, a rounded shoulder, sides of
   sideS, a soft toe into the snow. The step-up and the big air's roll-in. (s is the world's z here: z = 0.) */
class Line extends Shape {
  constructor(o) { super(Object.assign({ z: 0, hw: 3, sideS: 0.62, shoulder: 0.8, toeW: 0.35, breaks: [] }, o)); }
  setup(za, zb) {
    let hMax = 0; for (let z = za; z <= zb; z += 0.5) { const c = this.relC(z); if (c > hMax) hMax = c; }
    const reach = this.hw + this.shoulder + hMax / this.sideS + this.toeW + 0.5;
    this.za = za; this.zb = zb; this.u0 = -reach; this.u1 = reach; this.s0 = za; this.s1 = zb;
    return this.bound();
  }
  rel(u, s) {
    const c = this.relC(s); if (!(c > 0)) return -Infinity;
    const d = Math.abs(u) - this.hw, r = this.shoulder, sd = d <= 0 ? 0 : d < r ? this.sideS * d * d / (2 * r) : this.sideS * (d - r / 2);
    return toe(c - sd, Math.min(this.toeW, c * 0.5));
  }
  rows(fine) {
    const r = span(this.za, this.zb, fine ? 0.8 : 1.3);
    for (const b of this.breaks) for (const e of [-0.6, -0.3, -0.12, -0.04, 0, 0.04, 0.12, 0.3, 0.6]) if (b + e > this.za && b + e < this.zb) r.push(b + e);
    return uniq(r);
  }
  cols(fine) { const c = span(this.u0, this.u1, fine ? 0.8 : 1.3); for (const s of [-1, 1]) for (const e of [-0.2, 0, 0.3, 0.6, 1.0]) c.push(s * (this.hw + e)); return uniq(c); }
}
/* a step-up: a takeoff, a gap, then a face rising to a deck `up` metres higher than the lip, which you land on, a knuckle
   and a landing. (Never land short of it: its face is what you hit.) vDesign: the speed at the foot that lands a third
   of the way along the deck. */
export class StepUp extends Line {
  constructor(o) {
    super(Object.assign({ name: 'Step-up', lip: 30, R: 9, gap: 2.2, up: 0.5, upA: 32 * RAD, deckL: 7, deckA: 5 * RAD, land: 30, Rk: 5, hw: 2.8 }, o));
    const p = pitchAt(this.z0), lip = this.lip * RAD, A = { z: this.z0, y: baseLine(this.z0) };
    const C = this.C = { z: A.z + this.R * Math.sin(p), y: A.y + this.R * Math.cos(p) };
    this.L = { z: C.z + this.R * Math.sin(lip), y: C.y - this.R * Math.cos(lip) };
    this.zU = this.L.z + this.gap; this.yD = this.L.y + this.up;
    // (its face straight at upA in the world, from the snow at zU up to the deck: a curved one on the falling slope ran
    // out three times as long and high)
    this.yU = baseLine(this.zU); this.zD0 = this.zU + (this.yD - this.yU) / Math.tan(this.upA); this.zD1 = this.zD0 + this.deckL;
    this.yE = this.yD - this.deckL * Math.tan(this.deckA);
    const la = this.land * RAD;
    this.Kc = { z: this.zD1 - this.Rk * Math.sin(this.deckA), y: this.yE - this.Rk * Math.cos(this.deckA) };
    this.zK1 = this.Kc.z + this.Rk * Math.sin(la); this.yK1 = this.Kc.y + this.Rk * Math.cos(la); this.tl = Math.tan(la);
    let z = this.zK1; while (z < this.zK1 + 80 && this.yK1 - (z - this.zK1) * this.tl > baseLine(z)) z += 0.25;
    this.zMeet = z;
    this.breaks = [this.z0, this.L.z, this.zU, this.zD0, this.zD1, this.zK1];
    this.setup(this.z0 - 0.3, this.zMeet + 3);
    // the speed off the lip that lands a third of the way along the deck, then up the ramp
    const surf = z => { const c = this.relC(z); return baseLine(z) + (c > 0 ? c : 0); };
    this.vLip = flightFor(this.L, lip, surf, this.zD0 + this.deckL * 0.33);
    const rise2 = this.L.y - baseLine(this.z0);
    this.vDesign = Math.sqrt(this.vLip * this.vLip + 2 * 9.81 * rise2 * (1.12 + 0.02 * rise2)) + 0.5;
  }
  relC(z) {
    let y = -Infinity;
    if (z >= this.z0 && z <= this.L.z) { const s = clamp((z - this.C.z) / this.R, -1, 1); y = this.C.y - this.R * Math.cos(Math.asin(s)); }
    else if (z > this.L.z && z < this.L.z + 6) y = this.L.y - (z - this.L.z) * 0.84;          // its back, at 40 degrees
    let w = -Infinity;
    if (z >= this.zU - 1 && z < this.zD0) w = smax(this.yU + (z - this.zU) * Math.tan(this.upA), baseLine(z), 0.6);
    else if (z >= this.zD0 && z < this.zD1) w = this.yD - (z - this.zD0) * Math.tan(this.deckA);
    else if (z >= this.zD1 && z < this.zK1) w = this.Kc.y + Math.sqrt(Math.max(0, this.Rk * this.Rk - (z - this.Kc.z) ** 2));
    else if (z >= this.zK1) w = smax(this.yK1 - (z - this.zK1) * this.tl, baseLine(z), 1.5);
    return Math.max(y, w) - baseLine(z);
  }
  dye(x, z) { const dx = Math.abs(x - this.x); return (Math.abs(z - this.L.z + 0.08) < 0.1 && dx < this.hw) || (Math.abs(z - this.zD0 - 0.3) < 0.1 && dx < this.hw) ? 1 : 0; }
}
/* the knuckle huck's drop-in (X Games' knuckle huck is ridden off the big air's knuckle, not its lip): a small ramp
   standing on the big air's table beside the line off its lip, its top H over the table, falling over `len` metres to
   the table, which takes you on to the knuckle; its back falls at 32 degrees towards the lip. */
export class Rollin extends Line {
  constructor(o) {
    super(Object.assign({ name: 'Knuckle huck drop-in', H: 2.0, len: 10, top: 1.5, hw: 1.2, sideS: 0.8 }, o));
    const k = this.k;
    this.yT = k.yT; this.zA = k.L.z + 4.5; this.zB = this.zA + this.top; this.zC = this.zB + this.len;
    this.zA0 = this.zA - this.H / 0.62; this.breaks = [this.zA, this.zB, this.zC];
    this.setup(this.zA0, this.zC + 0.5);
  }
  relC(z) {
    if (z < this.zA0 || z > this.zC) return -Infinity;
    const t = clamp((z - this.zB) / this.len, 0, 1), h = z < this.zA ? this.H - (this.zA - z) * 0.62 : z < this.zB ? this.H : this.H * (1 - t * t * (3 - 2 * t));
    return this.yT + h - baseLine(z);
  }
}
// the speed off a lip at L (angle a) whose flight, with the air's drag, comes down on surf(z) at z = target
function flightFor(L, a, surf, target) {
  const kd = 0.5 * 1.2 * 0.5 / 78, dt = 0.01; let lo = 3, hi = 30;
  for (let it = 0; it < 26; it++) {
    const v = (lo + hi) / 2; let vz = v * Math.cos(a), vy = v * Math.sin(a), z = L.z, y = L.y, zl = Infinity;
    for (let t = 0; t < 6; t += dt) { const sp = Math.hypot(vz, vy); vz -= kd * sp * vz * dt; vy -= (9.81 + kd * sp * vy) * dt; z += vz * dt; y += vy * dt; if (z > L.z + 0.5 && y <= surf(z)) { zl = z; break; } }
    if (zl < target) lo = v; else hi = v;
  }
  return (lo + hi) / 2;
}
/* a takeoff turned off the fall line by yaw: a Kicker worked out in its own frame (its centre line along s, over the
   run's base line under that line), its core kept level across (the snow falls across a turned takeoff: that fall is
   taken out of its core, fading out down its sides). cut: nothing past its lip's back face (it drops onto a table that
   is another feature's). */
export class SkewKicker extends Shape {
  constructor(o) {
    super(Object.assign({}, o, { name: o.name, group: o.group || 'Features' }));
    const self = this, ko = Object.assign({}, o);
    delete ko.x; delete ko.z; delete ko.yaw; delete ko.group; delete ko.cut;
    this.k = new Kicker(Object.assign(ko, { x: 0, z0: 0, base: s => baseLine(self.z + s * self.cy), pitch: s => Math.atan(Math.tan(pitchAt(self.z + s * self.cy)) * self.cy) }));
    const k = this.k;
    this.vLip = k.vLip; this.vDesign = k.vDesign; this.L = k.L; this.yT = k.yT; this.lip = k.lip; this.land = k.land;
    const reach = this.cut ? k.hwT + (k.lipH + 0.6) / k.sideS + k.shoulder + 1 : 0;
    this.u0 = this.cut ? -reach : k.x0; this.u1 = this.cut ? reach : k.x1; this.s0 = -0.5; this.s1 = this.cut ? k.zBack + 0.4 : k.z1;
    this.bound();
    const w = this.toWorld(0, k.L.z, {}); this.lipX = w.x; this.lipZ = w.z;
  }
  height(x, z, g) {
    if (x < this.x0 || x > this.x1 || z < this.zs || z > this.z1) return -Infinity;
    const L = this.toLocal(x, z, _sl), k = this.k;
    if (this.cut && L.s > k.zBack + 0.02) return -Infinity;
    const r = k.height(L.u, L.s, 0); if (r === -Infinity) return -Infinity;
    const rc = k.rel(L.s, 0), w = rc > 0.05 ? clamp(r / rc, 0, 1) : 0;
    const y = g + r - (baseLine(z) - k.bl(L.s)) * w;
    return y > g + 0.002 ? y : -Infinity;
  }
  surface(x, z) { if (x < this.x0 || x > this.x1 || z < this.zs || z > this.z1) return false; const L = this.toLocal(x, z, _sl); return (!this.cut || L.s < this.k.zBack) && this.k.surface(L.u, L.s); }
  rows(fine) { const r = this.k.rows(fine); return this.cut ? uniq([...r.filter(s => s <= this.k.zBack + 0.05), this.k.zBack + 0.03]) : r; }
  cols(fine) { return this.k.cols(fine); }
  dye(x, z) { const L = this.toLocal(x, z, _sl); return this.k.dye(L.u, L.s); }
}
/* a quarterpipe: a pipe's wall standing along z, rising towards dir (+1: +x) from its edge xAt(z), on the snow or on
   another feature's surface (base(x, z, g): the landing it stands beside). Ridden as the superpipe is (park.pipes,
   skier.js): its steep part is never a wall, pumping it gains speed, and off its top you go straight up and come back
   down it. A wallride is one with a tall vertical part (vert), faced with wood (railMeshes draws the boards). */
export class Quarter {
  constructor(o) {
    Object.assign(this, { R: 4.0, vert: 0.4, deck: 2.5, dir: 1, entry: 6, exit: 6, ownMesh: true, local: true, trim: true, lod: true, name: 'quarterpipe', group: 'Features', base: null, xAt: null }, o);
    if (!this.xAt) { const x = this.x; this.xAt = () => x; }
    this.H = this.R + this.vert; this.aDeck = this.R + 0.15 + this.deck;
    let xa = Infinity, xb = -Infinity, hb = 0;
    for (let z = this.z0; z <= this.z1 + 1e-6; z += 1) { const e = this.xAt(z); xa = Math.min(xa, e); xb = Math.max(xb, e); if (this.base) { const g = ground(e, z); hb = Math.max(hb, this.base(e, z, g) - g); } }
    const reach = this.aDeck + (this.H + hb) / 0.7 + 1;
    this.x0 = this.dir > 0 ? xa - 0.5 : xa - reach; this.x1 = this.dir > 0 ? xb + reach : xb + 0.5; this.zs = this.z0;
    this.x = (xa + xb) / 2; this.reach = reach;
  }
  wall(a) { return a < this.aDeck ? Pipe.prototype.wall.call(this, a) : this.H; }
  scale(z) { return smoothstep(this.z0, this.z0 + this.entry, z) * (1 - smoothstep(this.z1 - this.exit, this.z1, z)); }
  toWorld(a, z, out) { out.x = this.xAt(z) + a * this.dir; out.z = z; return out; }
  toLocal(x, z, out) { out.u = (x - this.xAt(z)) * this.dir; out.s = z; return out; }
  height(x, z, g) {
    if (z < this.z0 || z > this.z1 || x < this.x0 || x > this.x1) return -Infinity;
    const s = this.scale(z); if (s <= 0) return -Infinity;
    const a = (x - this.xAt(z)) * this.dir; if (a < 0.01) return -Infinity;
    const b = this.base ? this.base(x, z, g) : g;
    const y = a <= this.aDeck ? b + this.wall(a) * s : b + this.H * s - (a - this.aDeck) * 0.7;
    return y > g + 0.002 ? y : -Infinity;
  }
  surface(x, z) { if (z < this.z0 || z > this.z1) return false; const a = (x - this.xAt(z)) * this.dir; return a > -0.5 && a < this.aDeck && this.scale(z) > 0; }
  rows(fine) { return uniq([...span(this.z0, this.z1, fine ? 0.9 : 2.0), ...span(this.z0, this.z0 + this.entry, fine ? 0.5 : 0.8), ...span(this.z1 - this.exit, this.z1, fine ? 0.5 : 0.8)]); }
  // by arc length over the wall, so its steep part gets as many points as the flat
  cols(fine) {
    const st = fine ? 0.3 : 0.5, c = [0.02]; let a = 0.02, prev = this.wall(a);
    while (a < this.aDeck) {
      let da = st;
      for (let k = 0; k < 6; k++) { const l = Math.hypot(da, this.wall(a + da) - prev); if (l > st * 1.05) da *= st / l; else break; }
      a = Math.min(this.aDeck, a + Math.max(da, 0.008)); prev = this.wall(a); c.push(a);
    }
    for (const v of span(this.aDeck, this.reach, fine ? 1.0 : 1.6)) c.push(v);
    return uniq(c);
  }
}

// ---- the layout ------------------------------------------------------------------------------------------------------
export function makePark() {
  setRun();                                       // (J, round 9: the park map's own run profile, terrain.js SECTIONS)
  const kickers = [
    new Kicker({ name: 'Small kicker', x: -16, z0: 66, lip: 24, R: 7, drop: 0.35, table: 5, land: 27, wT: 2.4, wD: 4, wL: 6.5 }),
    new Kicker({ name: 'Medium kicker', x: -16, z0: 146, lip: 27, R: 10, drop: 0.5, table: 9, land: 31, wT: 2.7, wD: 4.6, wL: 7.5 }),
    new Kicker({ name: 'Large kicker', x: -16, z0: 240, lip: 29, R: 13, drop: 0.7, table: 14, land: 33, wT: 3.0, wD: 5.2, wL: 8.5 }),
    new Kicker({ name: 'Side hit', x: 26, z0: 330, lip: 25, R: 7, drop: 0.3, table: 4, land: 27, wT: 2.2, wD: 3.6, wL: 6 }),
    new Kicker({ name: 'Big air', x: 0, z0: 930, lip: 31, R: 16, drop: 0.9, table: 19, land: 34, wT: 3.4, wD: 6, wL: 10 }),
  ];
  const pipe = new Pipe({ x: 0, z0: 690, z1: 880 });
  const qp = new QuarterPipe({ x: 30, z0: 1222, z1: 1262, dir: 1 });
  const ground2 = [
    new Rollers({ z0: 372, amp: 1.0, len: 13, n: 2, x: -14, w: 22 }),
    new Rollers({ z0: 590, amp: 1.3, len: 15, n: 3, x: 0, w: 34 }),
    new Rollers({ z0: 1270, amp: 0.9, len: 12, n: 2, x: 0, w: 30 }),
    new Mound({ x: 30, z: 205, r: 7, h: 0.8 }), new Mound({ x: 36, z: 240, r: 6, h: 0.6 }),
    new Mound({ x: -34, z: 470, r: 7, h: 0.7 }), new Mound({ x: 34, z: 1210, r: 8, h: 0.8 }),
  ];
  // rails: [x, z, top over snow]
  const R = (o) => new Rail(o);
  const rails = [
    R({ name: 'Flat box', kind: 'box', pts: [[16, 82, 0.35], [16, 94, 0.35]], ramp: 0.3 }),
    R({ name: 'Down rail', kind: 'rail', pts: [[16, 128, 0.85], [16, 142, 0.3]], ramp: 0.75 }),
    R({ name: 'Flat-down box', kind: 'box', pts: [[17, 170, 0.5], [17, 178, 0.5], [17, 190, 0.2]], ramp: 0.42 }),
    R({ name: 'Flat rail', kind: 'rail', pts: [[-28, 420, 0.75], [-28, 434, 0.75]], ramp: 0.62 }),
    R({ name: 'Kinked rail', kind: 'rail', pts: [[-10, 430, 0.8], [-10, 436, 0.8], [-10, 446, 0.25], [-10, 451, 0.25]], ramp: 0.68 }),
    R({ name: 'Rainbow rail', kind: 'rail', pts: rainbow(8, 428, 12, 0.55, 0.6), ramp: 0.48 }),
    R({ name: 'Down box', kind: 'box', pts: [[24, 432, 0.7], [24, 446, 0.25]], ramp: 0.6 }),
    R({ name: 'Long flat box', kind: 'box', pts: [[38, 426, 0.4], [38, 446, 0.4]], ramp: 0.32 }),
    R({ name: 'Wide down rail', kind: 'rail', pts: [[-20, 1130, 0.9], [-20, 1148, 0.3]], ramp: 0.8 }),
    R({ name: 'Rainbow box', kind: 'box', pts: rainbow(0, 1132, 12, 0.45, 0.6), ramp: 0.38 }),
    R({ name: 'Long rail', kind: 'rail', pts: [[20, 1128, 0.6], [20, 1152, 0.6]], ramp: 0.5 }),
    R({ name: 'Down-flat-down rail', kind: 'rail', pts: [[-4, 1185, 0.95], [-4, 1192, 0.6], [-4, 1198, 0.6], [-4, 1205, 0.25]], ramp: 0.85 }),
  ];
  return assemble({ kickers, pipe, qp, ground2, rails, fences: [[-30, 40, -30, 330], [-2.5, 60, -2.5, 320]], starts: [
    { name: 'Top of the park', x: -16, z: -30, v: 5 },
    { name: 'Jump line', x: -16, z: 30, v: 9 },
    { name: 'Jib line (boxes and rails)', x: 16, z: 40, v: 8 },
    { name: 'Rail garden', x: -2, z: 380, v: 8 },
    { name: 'Superpipe', x: -2, z: 700, v: 10 },
    { name: 'Big air', x: 0, z: 880, v: 12 },
    { name: 'Bottom jibs and quarterpipe', x: 0, z: 1090, v: 9 },
  ] });
}
// a layout's features made into a park: the lookup grid and the height functions the terrain and physics ask
/* (J, round 10) meshed: features with meshes of their own that are not kickers (park.js Shape, Quarter: main.js builds
   them with the jumps); pipes: everything ridden as the superpipe is (skier.js reads park.pipes, else pipe and qp) */
export function assemble({ kickers, pipe = null, qp = null, ground2 = [], rails = [], starts, fences = [], banner = null, meshed = [], pipes = null }) {
  const ramps = rails.filter(r => r.ramp).map(r => new Wedge({ x: r.pts[0][0], zEnd: r.pts[0][1] - 0.7, h: r.ramp, hw: r.rampW ?? (r.kind === 'box' ? 1.4 : 1.2) }));
  const all = [...kickers, pipe, qp, ...meshed, ...ground2, ...ramps].filter(Boolean);
  // a 32 m bucket grid over x and z
  // (2026-11-12, loading: the cells' keys are numbers, not strings made for every height asked for; the same cells)
  const B = 32, buckets = new Map(), bkey = (bx, bz) => (bx + 32768) * 65536 + (bz + 32768);
  for (const f of all) {
    const zs = f.zs ?? f.z0, ze = f.z1 ?? f.zEnd + 2;
    for (let bx = Math.floor(f.x0 / B); bx <= Math.floor(f.x1 / B); bx++) for (let bz = Math.floor(zs / B); bz <= Math.floor(ze / B); bz++) {
      const k = bkey(bx, bz); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(f);
    }
  }
  const near = (x, z) => buckets.get(bkey(Math.floor(x / B), Math.floor(z / B)));
  /* the highest feature's snow, rounded into the next one where their slopes meet in a crease (2026-11-05: where two
     lanes' sides met there was a sharp V that took 1.5 to 1.9 m/s off a rider crossing it in one step). The rounding is
     as wide as the slopes differ (up to 1.6 m), so two features lying in one plane (the lanes' shared landing) are not
     raised where they overlap. g is the bare ground under x, z. */
  const KX = 1.6, E = 0.05;
  const topOf = (l, x, z, g, terrainOnly) => {
    let a = -Infinity, b = -Infinity, fa = null, fb = null;
    for (const f of l) {
      if (terrainOnly && f.ownMesh) continue;
      const y = f.height(x, z, g);
      if (y > a) { b = a; fb = fa; a = y; fa = f; } else if (y > b) { b = y; fb = f; }
    }
    if (b === -Infinity || a - b >= KX) return a;
    const ax = fa.height(x + E, z, g) - fa.height(x - E, z, g), az = fa.height(x, z + E, g) - fa.height(x, z - E, g);
    const bx = fb.height(x + E, z, g) - fb.height(x - E, z, g), bz = fb.height(x, z + E, g) - fb.height(x, z - E, g);
    if (!(Number.isFinite(ax) && Number.isFinite(az) && Number.isFinite(bx) && Number.isFinite(bz))) return a;
    // (and no wider than the crease stands over the ground: two sides meeting at their feet are already rounded there by
    // their toes, and rounding them again raised a ridge between them)
    const k = Math.min(KX, Math.hypot(ax - bx, az - bz) / (2 * E) * 1.3, Math.max(0, b - g) * 2.5);
    return a - b >= k ? a : smax(a, b, k);
  };
  const park = {
    kickers, pipe, qp, rails, all, fences, banner, meshed, pipes,
    // where a rider can start: the top and the start of each part of the park
    starts,
    height(x, z, g) { const l = near(x, z); return l ? topOf(l, x, z, g, false) : -Infinity; },
    heightTerrainOnly(x, z, g) { const l = near(x, z); return l ? topOf(l, x, z, g, true) : -Infinity; },
    // the ground under kickers and the pipe is lowered so it never shows through their meshes
    visualDip(x, z) {
      const l = near(x, z); if (!l) return 0;
      let d = 0;
      for (const f of l) if (f.ownMesh) {
        const g = ground(x, z), y = f.height(x, z, g);
        if (y > g + 0.02) d = Math.max(d, Math.min(0.35, (y - g) * 2));
      }
      return d;
    },
    surface(x, z) { const l = near(x, z); if (!l) return false; for (const f of l) if (f.surface && f.surface(x, z)) return true; return false; },
  };
  return park;
}
/* ---- the Jump Line (2026-11-03) ------------------------------------------------------------------------------------
   Jumps down the run, each one three takeoffs side by side, Large, Medium and Small, landing on one shared landing:
   the Large lane's table and landing are built first, and each smaller lane is placed up the hill so that its own
   (lower) table meets that same landing plane, just further down it, with the table length asked for (found by
   bisection: further down the hill, the table comes out shorter). So you can choose a size at each jump and change
   lanes between them.
   (2026-11-08, J, for "make the large jumps even larger and upscale all the jumps respectively" and "make the jumps in
   jump line more transitionable and easier to jump from one line to the other without casing":)
   - every jump is bigger, after real slopestyle and park jumps: at full size the Large table 23 m (a 75 ft pro jump),
     the Medium 17 m, the Small 12 m; each jump is as big as the slope there can feed with speed (a smaller size where
     the run is gentle, rather than a long empty run-out);
   - each next jump is placed where riders coming off this jump's Medium and Small landings have the next Large
     takeoff's design speed (rollTo, with the physics' own drag and snow friction), with room to cross the line, so off
     any lane's landing you can take any lane of the next jump; a rider with more than a takeoff wants is checked down
     on its in-run (skier.js);
   - the lanes are closer together, so crossing from one to another is shorter;
   - below the last jump, on the gentler run, is a jib line (jibLine): rails, tubes and boxes in three columns, row
     after row, each with its own snow ramp in.
   The features that stood on the takeoffs beside the jumps (2026-11-05, from Leon's picture: a fat tube up the left
   part of a kicker's ramp) were off in v20 to v22 (TAKEOFF_FEATURES) and are back (2026-11-11, J, round 9, for "put
   rails on the jumps like before"): a rail, tube, box, bench or donkey dick on the same ramp beside every jump, three
   different kinds across each jump's three lanes (PLAN), as fat as the jib line's; the lanes sit a little further
   apart for their strips (x -20, 2, 18).
   (2026-11-11, J, round 9, for "make the inrun for jumpline shorter":) the start is 100 m above the first jump's
   Large takeoff (it was 198 m), with a steep drop in below it (JUMPLINE_RUN: 27 degrees, then the 14 degrees the
   first jump stands on), so the first jump is still reached at its design speed and a little more. */
const TAKEOFF_FEATURES = true;
/* the Jump Line's run profile ([z where it starts, pitch in degrees], as terrain.js SECTIONS, which the park map keeps):
   the old [12, 19], [42, 14] (a 19 degree pitch, then 14 degrees for 126 m before the first takeoff) is a drop in of
   27 degrees from just below the start, easing to 14 degrees 34 m before the first takeoff; below that the same as the
   park map's. A straight roll from the start at 5 m/s (rollTo) is at 20.7 m/s at the first Large takeoff's foot, which
   wants 19.7 (in the old profile, 20.0 there). */
const LANES = {
  L: { lip: 31, R: 19, drop: 1.0, table: 23, land: 35, wT: 3.6, wD: 6.2, wL: 11, Rk: 6 },
  M: { lip: 29, R: 15, drop: 0.8, table: 17, land: 35, wT: 3.2, wD: 5.6, wL: 10, Rk: 6 },
  S: { lip: 27, R: 11, drop: 0.6, table: 12, land: 35, wT: 2.8, wD: 4.8, wL: 9, Rk: 6 },
};
// the features' sizes by lane: widths of each kind's top (m), heights of their tops over the ramp, the strip they need,
// and the rainbows' reach past the lip (arcR) and top over it (arcRise)
const FEAT = {
  // (2026-11-11, J: as fat as the jib line's, WIDTH: tubes 0.45 to 0.55, boxes 0.8 to 0.9, round rails 0.16; they were
  // 0.36 to 0.5, 0.6 to 0.8 and 0.12 to 0.14)
  L: { wF: 3.0, tube: 0.55, box: 0.9, boxH: 0.45, bench: 0.6, benchL: 4.2, rail: 0.16, railH: 0.55, dd: 0.45, ddIn: 2.4, ddOut: 2.2, arcR: 5.6, arcRise: 0.75 },
  M: { wF: 2.8, tube: 0.5, box: 0.85, boxH: 0.4, bench: 0.6, benchL: 3.5, rail: 0.16, railH: 0.52, dd: 0.42, ddIn: 2.0, ddOut: 1.8, arcR: 4.4, arcRise: 0.6 },
  S: { wF: 2.6, tube: 0.45, box: 0.8, boxH: 0.35, bench: 0.55, benchL: 2.8, rail: 0.16, railH: 0.48, dd: 0.4, ddIn: 1.6, ddOut: 1.4, arcR: 3.2, arcRise: 0.42 },
};
// what stands on each jump's takeoffs: [Large, Medium, Small] (three different kinds at every jump)
const PLAN = [
  ['tube', 'box', 'bench'],
  ['kinkTube', 'dd', 'tube'],
  ['rainbowBox', 'tube', 'box'],
  ['box', 'bench', 'dd'],
  ['dd', 'rainbow', 'tube'],
  ['bench', 'kink', 'box'],
  ['upRail', 'tube', 'rainbow'],
];
// box sides and donkey dicks: park colours
const PAINT = [0xff6a13, 0x1f6fd1, 0x2fa84f, 0xd8312b, 0xf2c014, 0x8a3ffc];
// a lane that lands on another kicker's landing line, with about the table length asked for
function laneOn(big, o) {
  const tl = Math.tan(big.land * RAD), Rk = big.Rk;
  const c = big.Kend.y + big.Kend.z * tl;                        // the landing line: y + z tan(land) = c
  const tableFor = k => (c - k.yT + Rk * (1 - Math.cos(big.land * RAD))) / tl - Rk * Math.sin(big.land * RAD) - k.L.z;
  let lo = big.z0 - 60, hi = big.K.z;
  for (let it = 0; it < 40; it++) {
    const mid = (lo + hi) / 2, t = tableFor(new Kicker(Object.assign({}, o, { z0: mid, table: 5, geomOnly: true })));   // (C: the shape only)
    if (t > o.table) lo = mid; else hi = mid;
  }
  const k0 = new Kicker(Object.assign({}, o, { z0: (lo + hi) / 2, table: 5, geomOnly: true }));   // (2026-11-12, loading: only its z0 and shape are read)
  return new Kicker(Object.assign({}, o, { z0: k0.z0, table: Math.max(2.5, tableFor(k0)), Rk }));
}
// points along the ramp at x from za to zb, the top T over the snow (abs y)
function alongRamp(k, x, za, zb, T, step = 0.7) {
  const n = Math.max(1, Math.ceil((zb - za) / step)), pts = [];
  for (let i = 0; i <= n; i++) { const z = za + (zb - za) * i / n; pts.push([x, z, k.snowY(x, z) + T]); }
  return pts;
}
// a snow ramp up to a feature's start, its top `gap` under the feature's
function entry(k, x, z1, T, hw, gap = 0.03) { k.ents.push({ x, z0: z1 - clamp(T * 5.5, 1.5, 2.8), z1, h: Math.max(0.05, T - gap), hw }); }
// the feature on one takeoff
function takeoffFeature(k, kind, sz, j, lane) {
  const F = FEAT[sz], x = k.x + k.side * (k.wT + k.wF / 2), ramp = k.L.z - k.z0, under = (px, pz) => k.snowY(px, pz);
  const name = `Jump ${j + 1} ${{ L: 'Large', M: 'Medium', S: 'Small' }[sz]} `, colour = PAINT[(j * 3 + lane) % PAINT.length];
  const R = o => new Rail(Object.assign({ abs: true, under, onKicker: k, colour, size: sz }, o));
  const lipA = k.lip * RAD;
  switch (kind) {
    case 'tube': {        // Leon's picture: a fat tube lying on the ramp, from part way up to the lip
      const w = F.tube, T = w * 0.95, za = k.z0 + 0.32 * ramp;
      entry(k, x, za, T, w / 2 + 0.35);
      return R({ name: name + 'tube', kind: 'tube', w, pts: alongRamp(k, x, za, k.L.z - 0.04, T), look: 'tube' });
    }
    case 'box': {         // a flat box up the ramp to the lip
      const w = F.box, T = F.boxH, za = k.z0 + 0.38 * ramp;
      entry(k, x, za, T, w / 2 + 0.3);
      return R({ name: name + 'box', kind: 'box', w, pts: alongRamp(k, x, za, k.L.z - 0.03, T), look: 'box' });
    }
    case 'bench': {       // a wooden bench laid up the top of the ramp, its seat straight, ending at the lip
      /* (2026-11-11, J: its seat at 2 degrees under the lip's angle, its lip end propped up on longer legs: laid along the
         ramp's chord it left 6 to 7 degrees flatter than the jump, and on the bigger jumps a rider coming across onto the
         Large one landed on the knuckle) */
      const w = F.bench, T = 0.48 - (sz === 'S' ? 0.04 : 0), zb = k.L.z - 0.08, a = lipA - 2 * RAD;
      const za = zb - F.benchL * Math.cos(a), ya = k.snowY(x, za) + T;
      entry(k, x, za, T, w / 2 + 0.3);
      return R({ name: name + 'bench', kind: 'bench', w, pts: [[x, za, ya], [x, zb, ya + F.benchL * Math.sin(a)]], look: 'bench' });
    }
    case 'dd': {          // a donkey dick: a short fat tube coming out of the ramp below the lip and sticking out past it
      const w = F.dd, za = k.L.z - F.ddIn, a = lipA + 8 * RAD, ya = k.snowY(x, za) + 0.03;
      // aimed so that it leaves the snow at the lip's angle plus 8 degrees and runs ddOut past the lip
      const zb = k.L.z + F.ddOut * Math.cos(a), yb = ya + (zb - za) * Math.tan(a);
      return R({ name: name + 'donkey dick', kind: 'dd', w, pts: [[x, za, ya], [x, zb, yb]], look: 'dd' });
    }
    case 'rainbow': case 'rainbowBox': {   // an arc out of the lip, over the table and down onto it
      /* it starts 0.6 m down the ramp, flush with the snow and along it, so the skis meet its top as they ride up
         (started past the lip, its end stood in the way of a rider still coming up to it); then two smooth curves, up
         to a top over the table and down to end over it */
      const box = kind === 'rainbowBox', w = box ? F.box * 0.9 : F.rail, pts = [];
      const zS = k.L.z - 0.6, yS = k.snowY(x, zS) + 0.03, mS = Math.tan(Math.asin(clamp((zS - k.arc.C.z) / k.R, -1, 1)));
      const zA = k.L.z + F.arcR * 0.38, yA = k.L.y + F.arcRise, zE = k.L.z + F.arcR, yE = k.yT + (box ? 0.42 : 0.45), mE = -Math.tan(28 * RAD);
      const herm = (t, p0, m0, p1, m1, L) => { const t2 = t * t, t3 = t2 * t; return (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * m0 * L + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * m1 * L; };
      for (const [za, ya, ma, zb, yb, mb] of [[zS, yS, mS, zA, yA, 0], [zA, yA, 0, zE, yE, mE]]) {
        const n = Math.max(3, Math.ceil((zb - za) / 0.3));
        for (let i = pts.length ? 1 : 0; i <= n; i++) { const t = i / n; pts.push([x, za + (zb - za) * t, herm(t, ya, ma, yb, mb, zb - za)]); }
      }
      return R({ name: name + (box ? 'rainbow box' : 'rainbow rail'), kind: 'rainbow', top: box ? 'flat' : 'round', w, pts, look: box ? 'box' : 'steel', legs: true });
    }
    case 'kink': case 'kinkTube': case 'upRail': {   // up the ramp; then level over the table and down (kinks), or straight on off the lip
      const tube = kind === 'kinkTube', w = tube ? F.tube : F.rail, T = tube ? w * 0.95 : F.railH, za = k.z0 + 0.4 * ramp;
      entry(k, x, za, T, w / 2 + 0.35);
      const pts = alongRamp(k, x, za, k.L.z - 0.02, T, 0.8), top = pts[pts.length - 1][2];
      if (kind === 'upRail') {
        const out = sz === 'L' ? 1.4 : 1.1;
        pts.push([x, k.L.z + out * Math.cos(lipA), top + out * Math.sin(lipA)]);
      } else {
        // the bend over the lip rounded (a tube bends; a steel kink is sharper), level for part of the table, then down
        const rb = tube ? 2.2 : 0.8, zl = k.L.z - 0.02, flat = k.table * (tube ? 0.55 : 0.45);
        for (let i = 1; i <= 4; i++) { const a = lipA * (1 - i / 4); pts.push([x, zl + rb * (Math.sin(lipA) - Math.sin(a)), top + rb * (Math.cos(a) - Math.cos(lipA))]); }
        const [, zf, yf] = pts[pts.length - 1], zd = zf + flat, dn = (tube ? 22 : 25) * RAD;
        pts.push([x, zd, yf]);
        const hEnd = tube ? 0.85 : 0.6;
        let z = zd, y = yf;
        for (let i = 0; i < 40 && y - k.snowY(x, z) > hEnd; i++) { z += 0.25 * Math.cos(dn); y -= 0.25 * Math.sin(dn); }
        pts.push([x, z, y]);
      }
      return R({ name: name + (tube ? 'up-flat-down tube' : kind === 'upRail' ? 'up rail' : 'kinked rail'), kind: tube ? 'kink' : kind === 'upRail' ? 'rail' : 'kink', w, pts, look: tube ? 'tube' : 'steel', legs: true });
    }
  }
  return null;
}
// ---- speeds down the snow: a point riding straight, with the physics' own air drag (standing tall) and snow friction
// (skier.js), for placing the jumps
const G = 9.81, KD = 0.5 * 1.2 * 0.55 / 78, MU = 0.036;
const accel = (th, v) => G * Math.sin(th) - MU * G * Math.cos(th) - KD * v * v;
// down the base line from z at speed v, to z1 or until the speed reaches vWant: { z, v }
function rollTo(z, v, z1, vWant = Infinity) {
  for (; z < z1 && v < vWant; z += 0.25) { const th = pitchAt(z); v = Math.sqrt(Math.max(0.25, v * v + 2 * accel(th, v) * 0.25 / Math.cos(th))); }
  return { z, v };
}
// a straight air off kicker k leaving its lip at its own design speed: the flight, the speed along the landing where it
// comes down, and down the rest of the landing to where it meets the slope: the speed there
function exitSpeed(k) {
  const lip = k.lip * RAD, land = k.land * RAD, dt = 0.01;
  let vz = k.vLip * Math.cos(lip), vy = k.vLip * Math.sin(lip), z = k.L.z, y = k.L.y;
  for (let t = 0; t < 8; t += dt) {
    const sp = Math.hypot(vz, vy); vz -= KD * sp * vz * dt; vy -= (G + KD * sp * vy) * dt; z += vz * dt; y += vy * dt;
    const d = k.deckY(z), gy = d > -Infinity ? d : k.bl(z);
    if (z > k.L.z + 0.5 && y <= gy) break;
  }
  // (what is left along the landing: the part across it is taken by the legs)
  let v = Math.max(1, vz * Math.cos(land) - vy * Math.sin(land));
  for (let zz = Math.max(z, k.Kend.z); zz < k.zMeet; zz += 0.25) v = Math.sqrt(Math.max(0.25, v * v + 2 * accel(land, v) * 0.25 / Math.cos(land)));
  return v;
}
/* ---- the Jump Line as a slopestyle course (J, round 10) ----------------------------------------------------------
   For "introduce different kinds of jumps that allow you to have transitions and different features rather than just
   the same jump over and over again. Research x-games and olympic park setups and make sure that everything in those
   park setups is in my park" (Leon, round 10). Laid out as the Olympic and X Games slopestyle courses are (rail
   sections at the top with five options each, then the jumps), with a transition section between them (as Dew Tour's
   and the Laax Open's), a big air with a roll-in to its knuckle (X Games' knuckle huck) and a superpipe at the bottom
   (the FIS's: 22 foot walls, 19 to 21 m from coping to coping, 18 degrees, over 150 m). From the top:
   - Rail section 1: flat box, jersey barrier, down rail, cannon rail, down-flat-down rail.
   - Rail section 2: flat tube, rainbow box, mailbox, up-flat-down rail, waterfall rail.
   - Wall section: shipping container, wallride, pole jam to a down rail, tank, tyre bonk.
   - Transitions: quarterpipe side hits on both edges, a spine, a hip, a volcano, a shark fin, banked turns down the
     right (the easy way down), butter pads, a step-up and a step-down.
   - Jump 1: two skew kickers turned in over one table, with a roller to its knuckle between them (Beijing 2022's
     first jump has the skews over a table, its second the roller to the knuckle).
   - Jump 2: a big jump and a small one onto one landing, with a quarterpipe down each side of it to air out of.
   - Jump 3, the money booter: three sizes side by side onto one landing, a rail, tube or box on each takeoff.
   - The big air, the course's biggest jump, with a small drop-in on its table for knuckle hucks.
   - The superpipe.
   Each jump is placed where riders coming off the one above have its speed (rollTo), as the Jump Line's were. The
   beginners' way down: the flat box and tube in the rail sections, the banked turns, the small lanes of jumps 2 and 3,
   the roller of jump 1, and the snow beside the big air and the pipe.
   (2026-11-12 plan: every number the layout searches for (each kicker's speed off its lip, where each jump goes, where
   each lane and skew sits) is kept in order in park.plan and read back in the same order (memo, kick), so a start with
   the plan builds the very same course without the searches.) */
let PQ = null, PO = [];
function memo(f) { const v = PQ && PQ.i < PQ.a.length ? PQ.a[PQ.i++] : f(); PO.push(v); return v; }
function kick(o) { const v = PQ && PQ.i < PQ.a.length ? PQ.a[PQ.i++] : 0; const k = new Kicker(v > 0 ? Object.assign({}, o, { vLip: v }) : o); PO.push(k.vLip); return k; }
function skewKick(o) { const v = PQ && PQ.i < PQ.a.length ? PQ.a[PQ.i++] : 0; const k = new SkewKicker(v > 0 ? Object.assign({}, o, { vLip: v }) : o); PO.push(k.vLip); return k; }
const okPlan = p => Array.isArray(p) && p.length > 0 && p.every(v => typeof v === 'number' || (Array.isArray(v) && v.every(w => typeof w === 'number')));
const JL_START = 68;
// the course's run down to the big air; below it the superpipe's 18 degrees and the run-out are added (pipeRun)
const JUMPLINE_RUN = [[-900, 12], [-150, 10], [-55, 10], [70, 12], [92, 10], [250, 12], [430, 14], [700, 15]];
const pipeRun = (zP, len) => JUMPLINE_RUN.concat([[zP - 22, 18], [zP + len + 6, 9], [zP + len + 40, 3], [zP + len + 110, 0.5]]);
/* the rail sections: [x, kind, name, length (m), top over the snow at its start, at its end, extra]. Five options a
   row, as Beijing's first two sections had, the easiest on the left. */
const RAIL_ROWS = [
  { name: 'Rail section 1', items: [
    [-28, 'box', 'Flat box', 10, 0.42, 0.42, { w: 1.05 }],
    [-14, 'barrier', 'Jersey barrier', 8, 0.8, 0.8],
    [0, 'down', 'Down rail', 12, 1.0, 0.4],
    [14, 'cannon', 'Cannon rail', 12, 0.85, 0.35],
    [28, 'dfd', 'Down-flat-down rail', 15, 1.0, 0.3],
  ] },
  { name: 'Rail section 2', items: [
    [-28, 'tube', 'Flat tube', 10, 0.5, 0.5],
    [-14, 'rainbowBox', 'Rainbow box', 12, 0.5, 0.5, { rise: 0.55 }],
    [0, 'mailbox', 'Mailbox', 1.8, 1.0, 1.0],
    [14, 'ufd', 'Up-flat-down rail', 14, 0.55, 0.4],
    [28, 'waterfall', 'Waterfall rail', 15, 1.05, 0.45],
  ] },
  { name: 'Wall section', items: [
    [-28, 'container', 'Shipping container', 8, 1.1, 1.1],
    [-14, 'wallride', 'Wallride', 22],
    [0, 'poljam', 'Pole jam to down rail', 11],
    [14, 'tank', 'Tank', 6, 0.95, 0.95],
    [28, 'bonk', 'Tyre bonk', 1.0, 0.85, 0.85],
  ] },
];
const ROW_GAP = 54;
function railRow(row, zr, rails, meshed, pipes, i) {
  row.items.forEach(([x, kind, name, len, h0, h1, o = {}], c) => {
    const colour = PAINT[(i * 5 + c) % PAINT.length], za = zr, zb = za + len, R = q => rails.push(new Rail(Object.assign({ colour, group: row.name }, q)));
    switch (kind) {
      case 'box': case 'tube': R({ name, kind, pts: [[x, za, h0], [x, zb, h1]], ramp: h0 - 0.08, w: o.w }); break;
      case 'barrier': R({ name, kind: 'box', look: 'barrier', w: 0.36, pts: [[x, za, h0], [x, zb, h1]], ramp: h0 - 0.08, colour: 0x9c9b95 }); break;
      case 'down': R({ name, kind: 'rail', pts: [[x, za, h0], [x, zb, h1]], ramp: h0 - 0.08, legs: true }); break;
      case 'cannon': {     // a rail coming out of a cannon's mouth: ride the barrel, then the down rail out of it
        R({ name: name + ' (barrel)', kind: 'tube', look: 'cannon', w: 0.8, pts: [[x, za, h0], [x, za + 2.4, h0]], ramp: h0 - 0.08 });
        R({ name, kind: 'rail', pts: [[x, za + 2.45, h0 - 0.02], [x, zb, h1]], legs: true });
        break;
      }
      case 'dfd': R({ name, kind: 'kink', pts: [[x, za, h0], [x, za + len * 0.3, 0.6], [x, za + len * 0.7, 0.6], [x, zb, h1]], ramp: h0 - 0.08, legs: true }); break;
      case 'rainbowBox': R({ name, kind: 'rainbow', top: 'flat', look: 'box', w: 0.85, pts: rainbow(x, za, len, h0, o.rise), ramp: h0 - 0.08, legs: true }); break;
      case 'mailbox': R({ name, kind: 'box', look: 'mailbox', w: 0.5, pts: [[x, za, h0], [x, zb, h1]], ramp: h0 - 0.08 }); break;
      case 'ufd': R({ name, kind: 'kink', pts: [[x, za, h0], [x, za + len * 0.3, 1.1], [x, za + len * 0.6, 1.1], [x, zb, h1]], ramp: h0 - 0.08, legs: true }); break;
      case 'waterfall': R({ name, kind: 'kink', pts: [[x, za, h0], [x, za + 3.4, h0], [x, za + 5.6, 0.8], [x, za + 8.6, 0.8], [x, za + 10.8, 0.55], [x, za + 13.4, 0.55], [x, zb, h1]], ramp: h0 - 0.08, legs: true }); break;
      case 'container': R({ name, kind: 'box', look: 'container', w: 2.4, pts: [[x, za, h0], [x, zb, h1]], ramp: h0 - 0.08, rampW: 1.7, colour: 0x2f6f9f }); break;
      case 'tank': R({ name, kind: 'tube', look: 'tank', w: 1.4, pts: [[x, za, h0], [x, zb, h1]], ramp: h0 - 0.08, rampW: 1.3, colour: 0xd8312b }); break;
      case 'bonk': R({ name, kind: 'tube', look: 'bonk', w: 0.9, pts: [[x, za, h0], [x, zb, h1]], ramp: h0 - 0.1 }); break;
      case 'poljam': {     // a pole jam out of the snow, then a gap to a down rail (Laax's)
        R({ name: 'Pole jam', kind: 'dd', look: 'pole', w: 0.16, pts: [[x, za, 0.04], [x, za + 2.6, 1.08]] });
        R({ name: 'Down rail after the pole jam', kind: 'rail', pts: [[x, za + 4.4, 0.95], [x, za + len, 0.35]], legs: true });
        break;
      }
      case 'wallride': {   // a wall of boards on a short transition, ridden from the right
        const q = new Quarter({ name, group: row.name, x: x + 2.4, dir: -1, z0: za - 2, z1: za + len, R: 2.0, vert: 2.8, deck: 0.6, entry: 2.5, exit: 3.5, wood: true });
        meshed.push(q); pipes.push(q); rails.panels.push(q);
        break;
      }
    }
  });
}
// the transition section, from zT; returns where it ends
function transitions(zT, kickers, meshed, pipes, ground2, starts) {
  const G = 'Transitions', add = f => { meshed.push(f); return f; };
  // quarterpipe side hits on both edges, 4 m walls (Dew Tour's "mirrored side hits with 13 ft walls")
  pipes.push(add(new Quarter({ name: 'Left side hit', group: G + ' 1', x: -30, dir: -1, z0: zT, z1: zT + 50, R: 3.6, vert: 0.4, deck: 2.5 })));
  pipes.push(add(new Quarter({ name: 'Right side hit', group: G + ' 1', x: 30, dir: 1, z0: zT + 16, z1: zT + 66, R: 3.6, vert: 0.4, deck: 2.5 })));
  add(new Ridge({ name: 'Spine', group: G + ' 1', x: -9, z: zT + 4, len: 28, H: 2.4, deck: 0.3, te: 5, left: { take: 38 * RAD }, right: { take: 38 * RAD } }));
  add(new Ridge({ name: 'Hip', group: G + ' 1', x: 12, z: zT + 8, len: 26, H: 2.6, deck: 3, te: 5, left: { take: 30 * RAD }, right: { land: 34 * RAD, Rk: 2.5, Rr: 5 } }));
  add(new Volcano({ name: 'Volcano', group: G + ' 2', x: -16, z: zT + 84, H: 2.8, Rc: 3.4, A: 30 * RAD }));
  add(new Ridge({ name: 'Shark fin', group: G + ' 2', x: 6, z: zT + 64, len: 34, H: 3.2, deck: 0.25, te: 3, grow: 0.8, left: { take: 38 * RAD }, right: { take: 38 * RAD } }));
  ground2.push(new Mound({ x: -34, z: zT + 66, r: 6, h: 0.7 }), new Mound({ x: -2, z: zT + 114, r: 7, h: 0.8 }));
  // banked turns down the right: a slalom round x 31, 4 m either way, 36 m a turn; a bank outside each turn
  const zb = zT + 76, xm = 31, amp = 4, wl = 36, rc = wl * wl / (4 * Math.PI * Math.PI * amp);
  for (let i = 0; i < 4; i++) {
    const right = i % 2 === 0, ze = zb + wl / 4 + i * wl / 2, xe = xm + (right ? amp : -amp);
    add(new Berm({ name: 'Banked turn ' + (i + 1), group: G + ' 2', x: xe - (right ? rc : -rc), z: ze, a: right ? 0 : Math.PI, Rc: rc - 2.2 }));
  }
  // the step-up and the step-down
  add(new StepUp({ name: 'Step-up', group: G + ' 3', x: -18, z0: zT + 122 }));
  kickers.push(kick({ name: 'Step-down', group: G + ' 3', lod: true, x: 10, z0: zT + 128, lip: 28, R: 12, drop: 1.8, table: 3, land: 32, wT: 2.6, wD: 3.6, wL: 7, Rk: 3 }));
  starts.push({ name: 'Transitions: side hits, spine and hip', x: 0, z: zT - 24, v: 9 }, { name: 'Transitions: volcano, fin and banked turns', x: 4, z: zT + 40, v: 9 },
    { name: 'Step-up and step-down', x: -4, z: zT + 74, v: 8 });
  return zT + 176;
}
/* a skew's place: its lip at (x, z) turned in by yaw, its own table at height yT (another feature's table): the radius
   of its takeoff found by bisection (a bigger radius stands its foot further up the hill, higher) */
function skewPlace(o, x, z, yT) {
  const lip = o.lip * RAD, cy = Math.cos(o.yaw);
  const make = (R, zf) => new Kicker(Object.assign({}, o, { x: 0, z0: 0, R, table: 5, geomOnly: true, base: s => baseLine(zf + s * cy), pitch: s => Math.atan(Math.tan(pitchAt(zf + s * cy)) * cy) }));
  // (the foot D back along the line from the lip: the lip's own distance from its foot, found again for each radius)
  const at = R => { let D = R * (Math.sin(lip) + 0.25), k = null; for (let i = 0; i < 4; i++) { k = make(R, z - D * cy); D = k.L.z; } return [k, D]; };
  let lo = 4, hi = 60;
  for (let it = 0; it < 30; it++) { const R = (lo + hi) / 2; if (at(R)[0].yT < yT) lo = R; else hi = R; }
  const R = (lo + hi) / 2, D = at(R)[1];
  return [R, x - D * Math.sin(o.yaw), z - D * cy];
}
// a start at z whose speed brings a rider riding straight down to zTo at vTo and a little more (riders check speed)
function startFor(name, x, z, zTo, vTo) {
  let lo = 2, hi = vTo + 2;
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (rollTo(z, m, zTo).v < vTo + 0.4) lo = m; else hi = m; }
  return { name, x, z, v: Math.round(hi * 10) / 10 };
}
// a lane on another kicker's landing (laneOn's search): [z0, table]
function lanePlace(big, o) { const k = laneOn(big, Object.assign({}, o, { geomOnly: true })); return [k.z0, k.table]; }
export function makeJumpLine(plan = null) {
  setRun(JUMPLINE_RUN);                           // (J, round 9: its own run; the pipe's part is added further down)
  PQ = okPlan(plan) ? { a: plan, i: 0 } : null; PO = [];
  const kickers = [], rails = [], meshed = [], pipes = [], ground2 = [], starts = [{ name: 'Top of the course', x: 0, z: JL_START, v: 5 }];
  rails.panels = [];
  // the rail sections, then the transitions
  const zR = JL_START + 56;                       // (56 m to the first rails: room to pick any of the five from the start)
  RAIL_ROWS.forEach((row, i) => { const zr = zR + i * ROW_GAP; if (i) starts.push({ name: row.name, x: 0, z: zr - 34, v: 6 }); railRow(row, zr, rails, meshed, pipes, i); });
  // (riders leave the transitions at about 9 m/s: the banked turns' speed)
  let z = transitions(zR + RAIL_ROWS.length * ROW_GAP + 10, kickers, meshed, pipes, ground2, starts), v = 9;
  /* Jump 1: the table (a roller rising gently from the snow to it, between the two skews: ride it over the table and
     off the knuckle), 27 m across, then the two skews turned in by 14 degrees, their lips 5 m down the table. Placed
     where a rider leaving the transitions at 9 m/s has the skews' speed at their feet. */
  const TAB = { name: 'Jump 1 roller to the knuckle', group: 'Jump 1', lod: true, x: 0, lip: 0, drop: 0, R: 120, table: 18, land: 35, Rk: 7, wT: 3.6, wTab: 13.5, wD: 3.6, wL: 15, vLip: 12, noCheck: true };
  const SKW = { group: 'Jump 1', lip: 30, drop: 0.9, land: 35, wT: 2.6, wD: 2.6, wL: 6, Rk: 6, cut: true };
  const skews = (T, z0) => [-1, 1].map(sd => {
    const o = Object.assign({}, SKW, { name: `Jump 1 ${sd < 0 ? 'left' : 'right'} skew`, yaw: -sd * 14 * RAD });
    const lx = sd * (T.wTab - 3.2), lz = T.L.z + 5;
    const [R, fx, fz] = memo(() => skewPlace(o, lx, lz, T.yT));
    return skewKick(Object.assign(o, { R, x: fx, z: fz, table: Math.max(6, (T.K.z - lz) / Math.cos(o.yaw)) }));
  });
  const z1 = memo(() => {
    let z0 = z + 60;
    for (let it = 0; it < 30; it++) {
      const T = new Kicker(Object.assign({}, TAB, { z0, geomOnly: true })), o = Object.assign({}, SKW, { yaw: 14 * RAD });
      const [R, fx, fz] = skewPlace(o, -(T.wTab - 3.2), T.L.z + 5, T.yT), sk = new SkewKicker(Object.assign(o, { R, x: fx, z: fz, table: 15 }));
      if (rollTo(z, v, fz, sk.vDesign + 0.4).v >= sk.vDesign + 0.4) return z0;
      z0 += 5;
    }
    return z0;
  });
  const T1 = kick(Object.assign({}, TAB, { z0: z1 }));
  kickers.push(T1);
  const sk1 = skews(T1);
  meshed.push(...sk1);
  starts.push(startFor('Jump 1 (skew kickers)', sk1[0].x - 8, sk1[0].z - 50, sk1[0].z, sk1[0].vDesign), { name: 'Jump 1 (the roller to the knuckle)', x: 0, z: T1.z0 - 25, v: 6 });
  let vM = exitSpeed(sk1[0].k), vS = vM;
  z = T1.zMeet;
  // Jump 2: a Large jump and a Small one onto one landing, a quarterpipe down each side of it
  const L2 = { name: 'Jump 2 Large', group: 'Jump 2', x: -9, lip: 31, R: 18, drop: 1.0, table: 19, land: 35, wT: 3.6, wD: 6, wL: 10, Rk: 6 };
  const S2 = { name: 'Jump 2 Small', group: 'Jump 2', x: 11, lip: 27, R: 11, drop: 0.6, table: 11, land: 35, wT: 2.8, wD: 4.8, wL: 10 };
  const z2 = memo(() => nextAt(z, vM, vS, L2));
  const big2 = kick(Object.assign({}, L2, { z0: z2 }));
  const [s2z, s2t] = memo(() => lanePlace(big2, S2));
  const sml2 = kick(Object.assign({}, S2, { z0: s2z, table: s2t, Rk: big2.Rk }));
  kickers.push(big2, sml2);
  // (down the landing's sides from just past the knuckle, and on past its foot into the run-out, where riders turn up them)
  // (long enough that a rider airing out of one comes back down onto it: about 3 s up and down at 10 m/s along)
  const qz0 = big2.Kend.z + 3, qz1 = big2.zMeet + 50, onLanding = k => (x, z, g) => g + Math.max(0, k.tableY(z) - k.bl(z));
  for (const [k, dir, nm] of [[big2, -1, 'left'], [sml2, 1, 'right']]) {
    const q = new Quarter({ name: `Jump 2 ${nm} quarterpipe`, group: 'Jump 2', dir, z0: qz0, z1: qz1, R: 3.4, vert: 0.3, deck: 2.2, entry: 5, exit: 6, xAt: z => k.cxT + dir * k.hwAt(z), base: onLanding(k) });
    meshed.push(q); pipes.push(q);
  }
  starts.push(startFor('Jump 2 (quarterpipe sides)', 1, z2 - 50, z2, big2.vDesign));
  for (const k of [big2, sml2]) k.vExit = exitSpeed(k);
  vM = big2.vExit; vS = sml2.vExit; z = Math.max(big2.zMeet, sml2.zMeet);
  // Jump 3, the money booter: three lanes, a feature on each takeoff
  const X3 = { L: -20, M: 3, S: 23 };
  const L3 = Object.assign({ name: 'Jump 3 Large', group: 'Jump 3', x: X3.L, side: 1, wF: FEAT.L.wF }, LANES.L, { table: 21 });
  const M3 = Object.assign({ name: 'Jump 3 Medium', group: 'Jump 3', x: X3.M, side: 1, wF: FEAT.M.wF }, LANES.M);
  const S3 = Object.assign({ name: 'Jump 3 Small', group: 'Jump 3', x: X3.S, side: 1, wF: FEAT.S.wF }, LANES.S);
  const z3 = memo(() => nextAt(z, vM, vS, L3));
  const big3 = kick(Object.assign({}, L3, { z0: z3 }));
  const [m3z, m3t] = memo(() => lanePlace(big3, M3)), [s3z, s3t] = memo(() => lanePlace(big3, S3));
  const ks3 = [big3, kick(Object.assign({}, M3, { z0: m3z, table: m3t, Rk: big3.Rk })), kick(Object.assign({}, S3, { z0: s3z, table: s3t, Rk: big3.Rk }))];
  kickers.push(...ks3);
  ks3.forEach((k, i) => { k.size = 1; k.vExit = exitSpeed(k); const r = takeoffFeature(k, ['tube', 'dd', 'box'][i], 'LMS'[i], 2, i); if (r) rails.push(r); });
  starts.push(startFor('Jump 3 (the money booter)', X3.M, z3 - 50, z3, big3.vDesign));
  vM = ks3[1].vExit; vS = ks3[2].vExit; z = Math.max(...ks3.map(k => k.zMeet));
  // the big air, and the drop-in on its table for knuckle hucks
  const BA = { name: 'Big air', group: 'Big air', lod: true, x: -6, lip: 35, R: 15, drop: 1.4, table: 24, land: 37, wT: 4.2, wTab: 9, wD: 7.5, wL: 14, Rk: 8 };
  const zB = memo(() => nextAt(z, vM, vS, BA));
  const ba = kick(Object.assign({}, BA, { z0: zB }));
  kickers.push(ba);
  const roll = new Rollin({ group: 'Big air', k: ba, x: ba.cxT + 7 });
  meshed.push(roll);
  starts.push(startFor('Big air', ba.x, zB - 50, zB, ba.vDesign), { name: 'Knuckle huck (the drop-in)', x: roll.x, z: roll.zA + 0.7, v: 2 });
  // the superpipe, 45 m below the big air's landing, on a run of its own at 18 degrees
  const zP = ba.zMeet + 45, PL = 215;
  setRun(pipeRun(zP, PL));
  const pipe = new Pipe({ x: 0, z0: zP, z1: zP + PL, F: 3.6, R: 6.3, vert: 0.41, deck: 8, entry: 32, exit: 16, lod: true });
  starts.push({ name: 'Superpipe', x: 0, z: zP - 18, v: 9 });
  const zEnd = pipe.z1 + 10;
  // fences just outside everything
  let fl = Infinity, fr = -Infinity;
  for (const k of kickers) for (let zz = k.z0; zz < k.zMeet; zz += 2) {
    for (let x = k.x0; x < k.cxT; x += 0.5) if (k.bareRel(x, zz) > 0) { fl = Math.min(fl, x); break; }
    for (let x = k.x1; x > k.cxT; x -= 0.5) if (k.bareRel(x, zz) > 0) { fr = Math.max(fr, x); break; }
  }
  for (const f of meshed) { fl = Math.min(fl, f.x0); fr = Math.max(fr, f.x1); }
  for (const r of rails) for (const p of r.P) { fl = Math.min(fl, p.x - 4); fr = Math.max(fr, p.x + 4); }
  const zF = JL_START + 14;
  const park = assemble({ kickers, pipe, rails, starts, ground2, meshed, pipes: [pipe, ...pipes], banner: 'JUMP  LINE', fences: [[fl - 2.5, zF, fl - 2.5, zEnd], [fr + 2.5, zF, fr + 2.5, zEnd]] });
  park.archZ = JL_START + 5;                      // (world.js puts the start arch here)
  park.plan = PO;                                 // (2026-11-12: for the next start, memo above)
  park.course = { skews: sk1, table: T1, big2, sml2, money: ks3, bigAir: ba, roll, zEnd };   // (for tests)
  PQ = null;
  return park;
}
/* where the next jump's takeoff starts, from where the last landings meet the slope (z), riders leaving the Medium lane
   at vM and the Small lane at vS: where both have its design speed and a little more, and at least GAP0 m on, at most
   130 m on (2026-11-09, J). Its design speed changes with the slope it stands on: placed, measured, placed again. */
const GAP0 = 100;
function nextAt(z, vM, vS, o) {
  let z0 = z + GAP0;
  for (let it = 0; it < 6; it++) {
    const k = new Kicker(Object.assign({}, o, { z0 }));
    const more = 0.6 * smoothstep(13 * RAD, 11 * RAD, pitchAt(z0));
    const z1 = Math.min(z + 130, Math.max(z + GAP0, rollTo(z, vM, z + 400, k.vDesign + 0.3).z, rollTo(z, vS, z + 400, k.vDesign + 0.3 + more).z));
    if (Math.abs(z1 - z0) < 0.01) break;
    z0 = z1;
  }
  return z0;
}

// the backcountry map has no built features
export function emptyPark() {
  return { kickers: [], pipe: null, qp: null, rails: [], all: [], height: () => -Infinity, heightTerrainOnly: () => -Infinity, visualDip: () => 0, surface: () => false,
    starts: [{ name: 'The summit', x: 0, z: 0, v: 2, here: true }] };
}
function rainbow(x, z0, len, h0, rise) {
  const pts = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push([x, z0 + t * len, h0 + rise * Math.sin(Math.PI * t)]); }
  return pts;
}

// ---- meshes ----------------------------------------------------------------------------------------------------------
// a feature with its own mesh: a grid on its rows and columns, heights from the full height function
/* thin: 0 for the full mesh; else the far copy (2026-11-06, the lag pass): rows and columns at least thin and 1.4 x thin
   metres apart, about a third of the triangles, drawn once a jump is far enough off that the difference is about a
   pixel (main.js) */
const thinOut = (a, step) => { if (!step || a.length < 3) return a; const o = [a[0]]; for (let i = 1; i < a.length - 1; i++) if (a[i] - o[o.length - 1] >= step) o.push(a[i]); o.push(a[a.length - 1]); return o; };
export function featureMesh(f, heightFn, material, fine = true, thin = 0) {
  const it = featureMeshSteps(f, heightFn, material, fine, thin);
  let r = it.next(); while (!r.done) r = it.next();
  return r.value;
}
/* (2026-11-12, for "improving loading time": the same mesh, built a row at a time: it yields after each row of the grid
   and each entry ramp, so main.js can build the jumps a few milliseconds a frame after the start, nearest first, and
   none of it holds a frame up. The heights are the same numbers as before; the bare ground under each point is worked
   out once (it was twice), and the entry ramps' grids go into typed arrays (they were copied through plain arrays).) */
export function* featureMeshSteps(f, heightFn, material, fine = true, thin = 0) {
  const rows = thinOut(f.rows(fine), thin), cols = thinOut(f.cols(fine), thin * 1.4), nx = cols.length, nz = rows.length;
  const pos = new Float32Array(nx * nz * 3), nor = new Float32Array(nx * nz * 3), grm = new Float32Array(nx * nz), dye = new Float32Array(nx * nz);
  const n = new THREE.Vector3();
  // (J, round 10: a shape in a frame of its own, a grid over its own u (cols) and s (rows), placed by toWorld)
  const loc = f.local ? f : null, wp = { x: 0, z: 0 };
  // (J, 2026-11-11: the kicker's own grid is the snow without its features' entry ramps, which are drawn over it by grids
  // of their own, below; f.ents is put back before anything else can read it: within each row, so the physics, which
  // may run between two rows, always sees them)
  const ents = f.ents && f.ents.length ? f.ents : null;
  /* a kicker's grid reaches well past its sides: only the cells where it is the snow on top are kept (2026-11-05: the
     wider Jump Line kickers overlap their neighbours, and most of each grid was bare slope the terrain draws anyway) */
  const keep = f instanceof Kicker || f.trim ? new Uint8Array(nx * nz) : null;
  // (the terrain's own height, worked out here with the bare ground kept for the test above: terrain.js height())
  const pk = heightFn === height ? getPark() : undefined;
  for (let j = 0; j < nz; j++) {
    if (ents) f.ents = [];
    try {
      for (let i = 0; i < nx; i++) {
        const v = j * nx + i; let x = cols[i], z = rows[j];
        if (loc) { loc.toWorld(x, z, wp); x = wp.x; z = wp.z; }
        let y, g;
        if (pk !== undefined) { g = ground(x, z); if (pk) { const fh = pk.height(x, z, g); y = fh > g ? fh : g; } else y = g; }
        else { y = heightFn(x, z); if (keep) g = ground(x, z); }
        pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
        grm[v] = 0.65; dye[v] = f.dye ? f.dye(x, z) : 0;
        if (keep) { const fy = f.height(x, z, g); keep[v] = fy > g + 0.003 && fy >= pos[v * 3 + 1] - 0.45 ? 1 : 0; }   // (0.45: the rounding between features lifts the snow by up to 0.4)
      }
    } finally { if (ents) f.ents = ents; }
    yield;
  }
  // normals from the grid (central differences, uneven spacing; in a frame of its own, from the world places round it)
  if (loc) for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const v = j * nx + i, a = j * nx + Math.max(0, i - 1), b = j * nx + Math.min(nx - 1, i + 1), c = Math.max(0, j - 1) * nx + i, d = Math.min(nz - 1, j + 1) * nx + i;
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const wx = pos[d * 3] - pos[c * 3], wy = pos[d * 3 + 1] - pos[c * 3 + 1], wz = pos[d * 3 + 2] - pos[c * 3 + 2];
    n.set(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
    if (n.y < 0) n.negate();
    if (n.lengthSq() < 1e-12) n.set(0, 1, 0); else n.normalize();
    nor[v * 3] = n.x; nor[v * 3 + 1] = n.y; nor[v * 3 + 2] = n.z;
  }
  else for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const v = j * nx + i;
    const il = Math.max(0, i - 1), ir = Math.min(nx - 1, i + 1), jd = Math.max(0, j - 1), ju = Math.min(nz - 1, j + 1);
    const dx = cols[ir] - cols[il], dz = rows[ju] - rows[jd];
    const hx = (pos[(j * nx + ir) * 3 + 1] - pos[(j * nx + il) * 3 + 1]) / dx;
    const hz = (pos[(ju * nx + i) * 3 + 1] - pos[(jd * nx + i) * 3 + 1]) / dz;
    n.set(-hx, 1, -hz).normalize(); nor[v * 3] = n.x; nor[v * 3 + 1] = n.y; nor[v * 3 + 2] = n.z;
  }
  yield;
  const idx = new (nx * nz > 65535 ? Uint32Array : Uint16Array)((nx - 1) * (nz - 1) * 6);
  let k = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    if (keep && !(keep[a] | keep[b] | keep[c] | keep[d])) continue;
    idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
  }
  yield;
  // (the vertices no kept cell uses are dropped too)
  let P = pos, N = nor, G = grm, D = dye, I = k < idx.length ? idx.slice(0, k) : idx;
  if (keep) {
    const map = new Int32Array(nx * nz).fill(-1); let n2 = 0;
    for (let q = 0; q < k; q++) if (map[I[q]] < 0) map[I[q]] = n2++;
    P = new Float32Array(n2 * 3); N = new Float32Array(n2 * 3); G = new Float32Array(n2); D = new Float32Array(n2);
    for (let v = 0; v < nx * nz; v++) { const w = map[v]; if (w < 0) continue; P.set(pos.subarray(v * 3, v * 3 + 3), w * 3); N.set(nor.subarray(v * 3, v * 3 + 3), w * 3); G[w] = grm[v]; D[w] = dye[v]; }
    const I2 = new (n2 > 65535 ? Uint32Array : Uint16Array)(k);
    for (let q = 0; q < k; q++) I2[q] = map[I[q]];
    I = I2;
  }
  yield;
  if (ents) ({ P, N, G, D, I } = yield* withEntryGrids(f, ents, heightFn, { P, N, G, D, I }, thin ? 0.5 : fine ? 0.25 : 0.35));
  yield;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('aGroom', new THREE.BufferAttribute(G, 1));
  g.setAttribute('aDye', new THREE.BufferAttribute(D, 1));
  g.setIndex(new THREE.BufferAttribute(I, 1));
  g.computeBoundingSphere(); g.computeBoundingBox();
  const m = new THREE.Mesh(g, material);
  m.receiveShadow = true; m.castShadow = false; m.matrixAutoUpdate = false; m.name = f.name;
  return m;
}

/* the entry ramps' grids added to a kicker's mesh: the full height (the ramp on the bare kicker) over each ramp's
   footprint, only the cells the ramp stands up in, lifted up to 1.5 cm where it stands clear of the snow under it (so the
   kicker's own grid, the bare snow, never shows through it) and not at all at its rim, where the two meet */
function* withEntryGrids(f, ents, heightFn, M, step) {
  const grids = [], nrm = new THREE.Vector3();
  let nv = M.P.length / 3, ni = M.I.length;
  for (const e of ents) {
    const { xs, zs } = f.entryGrid(e, step), nx = xs.length, nz = zs.length;
    const h = new Float32Array(nx * nz), r = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { h[j * nx + i] = heightFn(xs[i], zs[j]); r[j * nx + i] = f.entryRel(xs[i], zs[j]); }
    let nq = 0;
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1; if (Math.max(r[a], r[b], r[c], r[d]) >= 0.002) nq++; }
    grids.push({ xs, zs, nx, nz, h, r, base: nv }); nv += nx * nz; ni += nq * 6;
    yield;
  }
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), G = new Float32Array(nv), D = new Float32Array(nv), I = new (nv > 65535 ? Uint32Array : Uint16Array)(ni);
  P.set(M.P); N.set(M.N); G.set(M.G); D.set(M.D); I.set(M.I);
  let ii = M.I.length;
  for (const { xs, zs, nx, nz, h, r, base } of grids) {
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const v = j * nx + i, il = Math.max(0, i - 1), ir = Math.min(nx - 1, i + 1), jd = Math.max(0, j - 1), ju = Math.min(nz - 1, j + 1);
      const hx = (h[j * nx + ir] - h[j * nx + il]) / (xs[ir] - xs[il]), hz = (h[ju * nx + i] - h[jd * nx + i]) / (zs[ju] - zs[jd]);
      nrm.set(-hx, 1, -hz).normalize();
      const w = base + v;
      P[w * 3] = xs[i]; P[w * 3 + 1] = h[v] + 0.015 * smoothstep(0, 0.05, r[v]); P[w * 3 + 2] = zs[j];
      N[w * 3] = nrm.x; N[w * 3 + 1] = nrm.y; N[w * 3 + 2] = nrm.z; G[w] = 0.65; D[w] = f.dye ? f.dye(xs[i], zs[j]) : 0;
    }
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      if (Math.max(r[a], r[b], r[c], r[d]) < 0.002) continue;
      I[ii++] = base + a; I[ii++] = base + c; I[ii++] = base + b; I[ii++] = base + b; I[ii++] = base + c; I[ii++] = base + d;
    }
  }
  return { P, N, G, D, I };
}

/* rails, tubes, boxes and benches, all in three merged meshes: the steel, one painted mesh whose colours are in its
   vertices (black plastic tubes, the boxes' slick tops and coloured sides, donkey dicks, posts), and the wooden
   benches; so the whole park's features are three draw calls (2026-11-05). Round tops are swept along the top line (the skis ride the line, so the
   tube's axis is its radius under the top, square to the line); boxes are a top plate on coloured sides down into the
   snow; the bench is a downloaded model ("Low Poly Old Red Painted Wooden Bench" by Kuutti Siitonen, CC BY 4.0) cut at
   its legs and stretched to each bench's length, its legs reaching down to the ramp. */
class Geo {
  constructor(colour) { this.p = []; this.n = []; this.c = colour ? [] : null; this.i = []; this.cur = null; }
  // (with colours, a vertex given none takes this.cur)
  v(x, y, z, nx, ny, nz, col) { this.p.push(x, y, z); this.n.push(nx, ny, nz); if (this.c) { const c = col || this.cur; this.c.push(c.r, c.g, c.b); } return this.p.length / 3 - 1; }
  // a triangle facing the way of the normal given (wound to suit)
  tri(a, b, c, nx, ny, nz) {
    const P = this.p, ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az, wx = P[c * 3] - ax, wy = P[c * 3 + 1] - ay, wz = P[c * 3 + 2] - az;
    const d = (uy * wz - uz * wy) * nx + (uz * wx - ux * wz) * ny + (ux * wy - uy * wx) * nz;
    if (d >= 0) this.i.push(a, b, c); else this.i.push(a, c, b);
  }
  quad(a, b, c, d, nx, ny, nz) { this.tri(a, b, c, nx, ny, nz); this.tri(a, c, d, nx, ny, nz); }
  geometry() {
    if (!this.i.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    if (this.c) g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    // texture coordinates for the scuffs and scratches: projected along the axis the face mostly looks down, 2 m a repeat
    const n = this.p.length / 3, uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = this.p[i * 3], y = this.p[i * 3 + 1], z = this.p[i * 3 + 2], ax = Math.abs(this.n[i * 3]), ay = Math.abs(this.n[i * 3 + 1]), az = Math.abs(this.n[i * 3 + 2]);
      if (ay >= ax && ay >= az) { uv[i * 2] = x * 0.5; uv[i * 2 + 1] = z * 0.5; } else if (ax >= az) { uv[i * 2] = z * 0.5; uv[i * 2 + 1] = y * 0.5; } else { uv[i * 2] = x * 0.5; uv[i * 2 + 1] = y * 0.5; }
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(this.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere();
    return g;
  }
}
const UPV = new THREE.Vector3(0, 1, 0);
// frames along a top line: the tangent (between its two segments at a joint), square-to-it up, and the side
function frames(P) {
  const F = [];
  for (let i = 0; i < P.length; i++) {
    const t = new THREE.Vector3();
    if (i > 0) t.add(P[i].clone().sub(P[i - 1]).normalize());
    if (i < P.length - 1) t.add(P[i + 1].clone().sub(P[i]).normalize());
    t.normalize();
    const u = UPV.clone().addScaledVector(t, -t.y).normalize(), s = new THREE.Vector3().crossVectors(t, u).normalize();
    F.push({ t, u, s });
  }
  return F;
}
// a round tube whose top runs along P, radius r, n sides, flat ends
function sweepTube(G, P, r, n, col) {
  const F = frames(P), rings = [], c = new THREE.Vector3(), d = new THREE.Vector3();
  for (let i = 0; i < P.length; i++) {
    const { t, u, s } = F[i], ring = [];
    c.copy(P[i]).addScaledVector(u, -r);
    for (let k = 0; k <= n; k++) {
      const a = k / n * Math.PI * 2; d.copy(u).multiplyScalar(Math.cos(a)).addScaledVector(s, Math.sin(a));
      ring.push(G.v(c.x + d.x * r, c.y + d.y * r, c.z + d.z * r, d.x, d.y, d.z, col));
    }
    rings.push({ ring, c: c.clone(), t });
  }
  for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < n; k++) {
    const a = rings[i].ring[k], b = rings[i].ring[k + 1], cc = rings[i + 1].ring[k + 1], dd = rings[i + 1].ring[k];
    const nx = G.n[a * 3] + G.n[cc * 3], ny = G.n[a * 3 + 1] + G.n[cc * 3 + 1], nz = G.n[a * 3 + 2] + G.n[cc * 3 + 2];
    G.quad(a, b, cc, dd, nx, ny, nz);
  }
  for (const [e, sg] of [[rings[0], -1], [rings[rings.length - 1], 1]]) {
    const nx = e.t.x * sg, ny = e.t.y * sg, nz = e.t.z * sg, m = G.v(e.c.x, e.c.y, e.c.z, nx, ny, nz, col), cap = [];
    for (let k = 0; k <= n; k++) { const q = e.ring[k]; cap.push(G.v(G.p[q * 3], G.p[q * 3 + 1], G.p[q * 3 + 2], nx, ny, nz, col)); }
    for (let k = 0; k < n; k++) G.tri(m, cap[k], cap[k + 1], nx, ny, nz);
  }
}
// a box: a top plate w wide along P (top: boxTop) on sides (paint) reaching down to under() - 0.15, or `skirt` deep
function sweepBox(Gt, Gp, P, w, under, col, skirt) {
  const F = frames(P), hw = w / 2, th = 0.05, L = [], hs = hw - 0.025;
  for (let i = 0; i < P.length; i++) {
    const { u, s } = F[i], p = P[i];
    const tl = p.clone().addScaledVector(s, -hw), tr = p.clone().addScaledVector(s, hw);
    const bl = tl.clone().addScaledVector(u, -th), br = tr.clone().addScaledVector(u, -th);
    const sl = p.clone().addScaledVector(s, -hs).addScaledVector(u, -th), sr = p.clone().addScaledVector(s, hs).addScaledVector(u, -th);
    const gl = skirt ? sl.y - skirt : under(sl.x, sl.z) - 0.15, gr = skirt ? sr.y - skirt : under(sr.x, sr.z) - 0.15;
    L.push({
      t: [Gt.v(tl.x, tl.y, tl.z, u.x, u.y, u.z), Gt.v(tr.x, tr.y, tr.z, u.x, u.y, u.z)],
      e: [Gt.v(tl.x, tl.y, tl.z, -s.x, -s.y, -s.z), Gt.v(bl.x, bl.y, bl.z, -s.x, -s.y, -s.z), Gt.v(tr.x, tr.y, tr.z, s.x, s.y, s.z), Gt.v(br.x, br.y, br.z, s.x, s.y, s.z)],
      k: [Gp.v(sl.x, sl.y, sl.z, -s.x, 0, -s.z, col), Gp.v(sl.x, gl, sl.z, -s.x, 0, -s.z, col), Gp.v(sr.x, sr.y, sr.z, s.x, 0, s.z, col), Gp.v(sr.x, gr, sr.z, s.x, 0, s.z, col)],
      s, u, pts: [tl, tr, sl, sr, gl, gr],
    });
  }
  for (let i = 0; i < L.length - 1; i++) {
    const A = L[i], B = L[i + 1], u = A.u, s = A.s;
    Gt.quad(A.t[0], A.t[1], B.t[1], B.t[0], u.x, u.y, u.z);
    Gt.quad(A.e[0], A.e[1], B.e[1], B.e[0], -s.x, -s.y, -s.z);
    Gt.quad(A.e[2], A.e[3], B.e[3], B.e[2], s.x, s.y, s.z);
    Gp.quad(A.k[0], A.k[1], B.k[1], B.k[0], -s.x, 0, -s.z);
    Gp.quad(A.k[2], A.k[3], B.k[3], B.k[2], s.x, 0, s.z);
  }
  // the two ends: the plate's edge and a painted panel under it
  for (const [i, sg] of [[0, -1], [L.length - 1, 1]]) {
    const t = F[i].t, [tl, tr, sl, sr, gl, gr] = L[i].pts, nx = t.x * sg, ny = 0, nz = t.z * sg;
    const a = Gp.v(sl.x, sl.y, sl.z, nx, ny, nz, col), b = Gp.v(sr.x, sr.y, sr.z, nx, ny, nz, col), c = Gp.v(sr.x, gr, sr.z, nx, ny, nz, col), d = Gp.v(sl.x, gl, sl.z, nx, ny, nz, col);
    Gp.quad(a, b, c, d, nx, ny, nz);
    const bl = tl.clone().addScaledVector(F[i].u, -0.05), br = tr.clone().addScaledVector(F[i].u, -0.05);
    const e0 = Gt.v(tl.x, tl.y, tl.z, t.x * sg, t.y * sg, t.z * sg), e1 = Gt.v(tr.x, tr.y, tr.z, t.x * sg, t.y * sg, t.z * sg), e2 = Gt.v(br.x, br.y, br.z, t.x * sg, t.y * sg, t.z * sg), e3 = Gt.v(bl.x, bl.y, bl.z, t.x * sg, t.y * sg, t.z * sg);
    Gt.quad(e0, e1, e2, e3, t.x * sg, t.y * sg, t.z * sg);
  }
}
// (J, round 10) the rail sections' new looks: a jersey barrier (concrete, its sides falling outward to the snow), stacked
// tyres for the bonk, and the wallride's boards
function sweepJersey(G, P, wt, wb, under, col) {
  const F = frames(P), L = [];
  for (let i = 0; i < P.length; i++) {
    const { s } = F[i], p = P[i];
    const tl = p.clone().addScaledVector(s, -wt / 2), tr = p.clone().addScaledVector(s, wt / 2), bl = p.clone().addScaledVector(s, -wb / 2), br = p.clone().addScaledVector(s, wb / 2);
    bl.y = under(bl.x, bl.z) - 0.12; br.y = under(br.x, br.z) - 0.12;
    L.push([tl, tr, bl, br]);
  }
  const q = (a, b, c, d, n) => { const i0 = G.v(a.x, a.y, a.z, n.x, n.y, n.z), i1 = G.v(b.x, b.y, b.z, n.x, n.y, n.z), i2 = G.v(c.x, c.y, c.z, n.x, n.y, n.z), i3 = G.v(d.x, d.y, d.z, n.x, n.y, n.z); G.quad(i0, i1, i2, i3, n.x, n.y, n.z); };
  for (let i = 0; i < L.length - 1; i++) {
    const [a0, b0, c0, d0] = L[i], [a1, b1, c1, d1] = L[i + 1], { s, u } = F[i];
    q(a0, b0, b1, a1, u);
    q(c0, a0, a1, c1, s.clone().negate().addScaledVector(u, 0.45).normalize());
    q(b0, d0, d1, b1, s.clone().addScaledVector(u, 0.45).normalize());
  }
  for (const [i, sg] of [[0, -1], [L.length - 1, 1]]) { const [a, b, c, d] = L[i], n = F[i].t.clone().multiplyScalar(sg); q(a, b, d, c, n); }
}
function tyres(G, x, z, r, y0, y1, col) {
  const n = 14, H = y1 - y0, nt = Math.max(1, Math.round(H / 0.3)), rows = [];
  for (let j = 0; j <= nt * 4; j++) {
    const t = j / (nt * 4), y = y0 + H * t, rr = r * (0.84 + 0.16 * Math.sin(Math.PI * ((t * nt) % 1 || (j ? 1 : 0)))), row = [];
    for (let k = 0; k <= n; k++) { const a = k / n * Math.PI * 2, c = Math.cos(a), s = Math.sin(a); row.push(G.v(x + c * rr, y, z + s * rr, c, 0, s, col)); }
    rows.push(row);
  }
  for (let j = 0; j < rows.length - 1; j++) for (let k = 0; k < n; k++) { const a = rows[j][k], b = rows[j][k + 1], c = rows[j + 1][k + 1], d = rows[j + 1][k]; G.quad(a, b, c, d, G.n[a * 3] + G.n[c * 3], 0, G.n[a * 3 + 2] + G.n[c * 3 + 2]); }
  const top = rows[rows.length - 1], m = G.v(x, y1, z, 0, 1, 0, col), cap = top.map(i => G.v(G.p[i * 3], G.p[i * 3 + 1], G.p[i * 3 + 2], 0, 1, 0, col));
  for (let k = 0; k < n; k++) G.tri(m, cap[k], cap[k + 1], 0, 1, 0);
}
function boards(G, q, col) {
  const zs = [], a0 = q.R * 0.9, a1 = q.R + 0.17, d = q.dir;
  for (let z = q.z0 + q.entry * 0.55; z <= q.z1 - q.exit * 0.55 + 1e-6; z += 1) zs.push(z);
  const rows = zs.map(z => {
    const s = q.scale(z), x = q.xAt(z), g0 = ground(x + d * a0, z), g1 = ground(x + d * a1, z);
    const b = G.v(x + d * (a0 - 0.03), g0 + q.wall(a0) * s + 0.02, z, -d, 0.15, 0, col), t = G.v(x + d * (a1 - 0.03), g1 + q.H * s + 0.05, z, -d, 0, 0, col);
    const c0 = G.v(x + d * (a1 - 0.03), g1 + q.H * s + 0.05, z, 0, 1, 0, col), c1 = G.v(x + d * (a1 + 0.3), g1 + q.H * s + 0.05, z, 0, 1, 0, col);
    return [b, t, c0, c1];
  });
  for (let i = 0; i < rows.length - 1; i++) { const A = rows[i], B = rows[i + 1]; G.quad(A[0], A[1], B[1], B[0], -d, 0.1, 0); G.quad(A[2], A[3], B[3], B[2], 0, 1, 0); }
}
// a square post from y0 down to y1 at x, z
function post(G, x, z, y0, y1, w) {
  const h = w / 2, c = [[-h, -h], [h, -h], [h, h], [-h, h]];
  for (let k = 0; k < 4; k++) {
    const [ax, az] = c[k], [bx, bz] = c[(k + 1) % 4], nx = (ax + bx), nz = (az + bz), l = Math.hypot(nx, nz);
    const a = G.v(x + ax, y0, z + az, nx / l, 0, nz / l), b = G.v(x + bx, y0, z + bz, nx / l, 0, nz / l), cc = G.v(x + bx, y1, z + bz, nx / l, 0, nz / l), d = G.v(x + ax, y1, z + az, nx / l, 0, nz / l);
    G.quad(a, b, cc, d, nx / l, 0, nz / l);
  }
}
// posts every `every` metres where the rail stands clear of the snow
function legsUnder(G, r, every, w, from) {
  for (let s = 0.35; s < r.len - 0.2; s += every) {
    const p = r.at(s), sy = r.under(p.x, p.z), y0 = p.y - from;
    if (y0 - sy < 0.12) continue;
    post(G, p.x, p.z, y0, sy - 0.25, w);
  }
}
let benchSrc = null;
function loadBench() {
  if (!benchSrc) benchSrc = new GLTFLoader().loadAsync('models/park/bench.glb?v=26').then(g => { let m = null; g.scene.traverse(o => { if (o.isMesh && !m) m = o; }); return m; });
  return benchSrc;
}
// the bench model stretched along a rail's two points: the ends (with their legs) kept, the seat between stretched, the
// legs reaching down to the snow under each one
function benchGeometry(src, r) {
  const g = src.geometry, pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  g.computeBoundingBox();
  const bb = g.boundingBox, half = (bb.max.x - bb.min.x) / 2, top = bb.max.y, seatBot = 0.39, end = 0.62;
  const A = r.P[0], B = r.P[1], t = B.clone().sub(A), len = t.length(); t.divideScalar(len);
  const s = new THREE.Vector3().crossVectors(t, UPV).normalize(), sw = r.w / (bb.max.z - bb.min.z);
  const J = new THREE.Matrix3(), N = new THREE.Matrix3();
  const P = new Float32Array(pos.count * 3), Nn = new Float32Array(pos.count * 3), U = new Float32Array(pos.count * 2);
  const w = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    // along the bench: the ends' parts keep their distance from the ends, the middle stretches
    const ax = Math.abs(x), along = ax > half - end ? Math.sign(x) * (len / 2 - (half - ax)) : x * (len / 2 - end) / (half - end);
    const k = ax > half - end ? 1 : (len / 2 - end) / (half - end);
    w.copy(A).addScaledVector(t, len / 2 + along).addScaledVector(s, z * sw).addScaledVector(UPV, y - top);
    if (y < seatBot) {                       // the legs: down to the snow under them
      const lo = r.under(w.x, w.z) - 0.08, yb = w.y + (seatBot - y);
      w.y = lo + (yb - lo) * (y / seatBot);
    }
    P[i * 3] = w.x; P[i * 3 + 1] = w.y; P[i * 3 + 2] = w.z;
    // normals through the stretch and shear (the inverse transpose of how the model was laid on the line)
    J.set(t.x * k, 0, s.x * sw, t.y * k, 1, s.y * sw, t.z * k, 0, s.z * sw);
    N.copy(J).invert().transpose();
    n.set(nor.getX(i), nor.getY(i), nor.getZ(i)).applyMatrix3(N).normalize();
    Nn[i * 3] = n.x; Nn[i * 3 + 1] = n.y; Nn[i * 3 + 2] = n.z;
    U[i * 2] = uv.getX(i); U[i * 2 + 1] = uv.getY(i);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.BufferAttribute(Nn, 3)); out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  out.setIndex(g.index.clone());
  return out;
}
export function railMeshes(rails, mats) {
  const out = new THREE.Group(); out.name = 'rails';
  // (everything but the steel and the benches is one painted mesh, its colours in its vertices: black plastic tubes,
  // the boxes' dark slick tops, their coloured sides, the donkey dicks, the dark posts)
  const steel = new Geo(), paint = new Geo(true);
  const col = new THREE.Color(), lin = h => new THREE.Color(h).convertSRGBToLinear();
  const PLASTIC = lin(0x15171a), TOP = lin(0x1d2128), POST = lin(0x2c3036), IRON = lin(0x2b2c2e), RUBBER = lin(0x18181a), WOOD = lin(0x9a6a3c);
  for (const r of rails) {
    col.set(r.colour ?? 0xff6a13).convertSRGBToLinear();
    const look = r.look || (r.top === 'flat' ? 'box' : r.kind === 'tube' ? 'tube' : 'steel');
    if (look === 'bench' || r.ownMesh) continue;
    paint.cur = TOP;
    if (look === 'box') sweepBox(paint, paint, r.P, r.w, r.under, col, r.legs ? 0.24 : 0);
    else if (look === 'dd') sweepTube(paint, r.P, r.w / 2, 18, col);
    else if (look === 'tube') sweepTube(paint, r.P, r.w / 2, 18, PLASTIC);
    // (J, round 10: the rail sections' jersey barrier, shipping container, mailbox, tank, tyre bonk, cannon and pole jam)
    else if (look === 'barrier') { paint.cur = col; sweepJersey(paint, r.P, r.w, 0.78, r.under, col); }
    else if (look === 'container') { paint.cur = col; sweepBox(paint, paint, r.P, r.w, r.under, col, 0); }
    else if (look === 'mailbox') { sweepBox(paint, paint, r.P, r.w, r.under, col, 0.24); paint.cur = POST; const m = r.at(r.len / 2); post(paint, m.x, m.z, m.y - 0.25, r.under(m.x, m.z) - 0.2, 0.12); }
    else if (look === 'tank') sweepTube(paint, r.P, r.w / 2, 22, col);
    else if (look === 'bonk') { const m = r.at(r.len / 2); tyres(paint, m.x, m.z, r.w / 2, r.under(m.x, m.z) - 0.1, m.y, RUBBER); }
    else if (look === 'cannon') { sweepTube(paint, r.P, r.w / 2, 16, IRON); const e = r.P[r.P.length - 1], d = r.dirAt(r.len); sweepTube(paint, [e.clone().addScaledVector(d, -0.3).add(new THREE.Vector3(0, 0.06, 0)), e.clone().add(new THREE.Vector3(0, 0.06, 0))], r.w / 2 + 0.06, 16, IRON); }
    else sweepTube(steel, r.P, r.w / 2, 10, null);
    // posts: steel rails always; tubes and boxes only where they stand off the snow (over a table, off a lip)
    paint.cur = POST;
    if (look === 'steel') legsUnder(paint, r, 1.6, Math.max(0.05, r.w * 0.45), r.w / 2);
    else if (r.legs) legsUnder(paint, r, 1.8, 0.08, look === 'box' ? 0.28 : r.w / 2);
  }
  for (const q of rails.panels || []) boards(paint, q, WOOD);   // (J, round 10: the wallride's boards)
  const add = (G, mat) => { const g = G.geometry(); if (!g) return; const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false; out.add(m); };
  /* scuffed plastic and scratched steel: roughness maps from ambientCG's CC0 "Plastic 010" (its roughness) and "Scratches
     005" (its scratches made into roughness), 512 px */
  const tl = new THREE.TextureLoader(), rough = f => new Promise(res => tl.load('models/park/' + f + '?v=26', t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; res(t); }, undefined, () => res(null)));
  const plRough = rough('plastic_rough.webp'), stRough = rough('steel_rough.webp');
  const paintM = mats.paint || (mats.paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0.05 }));
  const steelM = mats.railSteel || (mats.railSteel = new THREE.MeshStandardMaterial({ color: 0xb8bdc2, metalness: 0.9, roughness: 0.32 }));
  add(steel, steelM); add(paint, paintM);
  // (the materials take their maps before the boot compiles them: the maps change the shader)
  const maps = Promise.all([plRough, stRough]).then(([a, b]) => {
    if (a) { paintM.roughnessMap = a; paintM.roughness = 1; paintM.needsUpdate = true; }
    if (b) { steelM.roughnessMap = b; steelM.roughness = 1; steelM.needsUpdate = true; }
  });
  // the benches arrive with their model (ready resolves once they are in, so they can be compiled before the first frame)
  const benches = rails.filter(r => r.look === 'bench' && !r.ownMesh);
  const benchesIn = !benches.length ? Promise.resolve() : loadBench().then(src => {
    if (!src) return;
    const g = mergeGeometries(benches.map(r => benchGeometry(src, r)), false);
    const m = new THREE.Mesh(g, src.material); m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false; m.name = 'benches';
    out.add(m); out.updateMatrixWorld(true);
  }).catch(e => {
    // (the model could not be had: plain wooden-coloured boxes stand in, so a bench is never an invisible rail)
    console.warn('bench', e);
    const t2 = new Geo(), p2 = new Geo(true); col.set(0x8a4b32).convertSRGBToLinear();
    for (const r of benches) sweepBox(t2, p2, r.P, r.w, r.under, col, 0);
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a4b32, roughness: 0.85 });
    add(t2, wood); add(p2, paintM); out.updateMatrixWorld(true);
  });
  out.ready = Promise.all([benchesIn, maps]);
  return out;
}
