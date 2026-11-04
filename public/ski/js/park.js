// The park: kickers, a superpipe, rollers, butter pads, rails and boxes, laid out as real parks are (a jump line
// from small to large, a rail garden, the pipe, one big air, a jib line at the bottom). Every shape is a height
// function the physics reads directly; kickers and the pipe also get meshes of their own, much finer at the lips,
// knuckles and coping than the terrain's patches.
import * as THREE from 'three';
import { baseLine, pitchAt, ground } from './terrain.js?v=9';
import { smoothstep, clamp, smax } from './noise.js?v=9';

const RAD = Math.PI / 180;

// ---- kickers --------------------------------------------------------------------------------------------------------
// The centre line in (z, y): a takeoff arc of radius R from the slope's pitch up to the lip angle, a steep back face
// down to a level table, a rounded knuckle, a straight landing, and a blend back into the slope.
class Kicker {
  constructor(o) {
    Object.assign(this, { lip: 27, R: 10, drop: 0.5, table: 10, Rk: 3.5, land: 31, wT: 2.6, wD: 4.5, wL: 7.5, name: 'kicker' }, o);
    this.ownMesh = true;
    const p = pitchAt(this.z0), A = { z: this.z0, y: baseLine(this.z0) };
    const C = { z: A.z + this.R * Math.sin(p), y: A.y + this.R * Math.cos(p) };
    const lip = this.lip * RAD, land = this.land * RAD;
    this.L = { z: C.z + this.R * Math.sin(lip), y: C.y - this.R * Math.cos(lip) };
    this.arc = { C, R: this.R, a0: -p, a1: lip };
    this.zBack = this.L.z + this.drop / Math.tan(65 * RAD);
    this.yT = this.L.y - this.drop;
    this.K = { z: this.L.z + this.table, y: this.yT };
    this.Kend = { z: this.K.z + this.Rk * Math.sin(land), y: this.yT - this.Rk * (1 - Math.cos(land)) };
    this.tl = Math.tan(land);
    // where the landing meets the slope
    let z = this.Kend.z;
    while (z < this.Kend.z + 200 && this.Kend.y - (z - this.Kend.z) * this.tl > baseLine(z)) z += 0.25;
    this.zMeet = z; this.z1 = z + 14;
    this.x0 = this.x - this.wL - 9; this.x1 = this.x + this.wL + 9;
    this.lipH = this.L.y - baseLine(this.L.z);
    /* the speed off the lip that lands about 45% of the way down the landing, with the air's drag the skier feels in flight
       (left out, the big jumps' riders landed on the knuckle: 2026-11-03) */
    // (aimed deeper for a higher lip: the riders' flights come out a little shorter than this one, more so on the big
    // jumps, measured: a 1.6 m lip landed where it was aimed, a 4.3 m one 23% of the landing short)
    const frac = clamp(0.45 + 0.08 * (this.lipH - 1.6), 0.4, 0.75);
    const target = this.Kend.z + frac * (this.zMeet - this.Kend.z), kd = 0.5 * 1.2 * 0.5 / 78, dt = 0.01;
    let lo = 4, hi = 34;
    for (let it = 0; it < 30; it++) {
      const v = (lo + hi) / 2;
      let vz = v * Math.cos(lip), vy = v * Math.sin(lip), z = this.L.z, y = this.L.y, zl = Infinity;
      for (let t = 0; t < 8; t += dt) {
        const sp = Math.hypot(vz, vy); vz -= kd * sp * vz * dt; vy -= (9.81 + kd * sp * vy) * dt; z += vz * dt; y += vy * dt;
        const d = this.deckY(z), gy = d > -Infinity ? d : baseLine(z);
        if (z > this.L.z + 0.5 && y <= gy) { zl = z; break; }
      }
      if (zl < target) lo = v; else hi = v;
    }
    this.vLip = (lo + hi) / 2;
    // the speed at the foot of the takeoff that leaves the lip at vLip (climbing the ramp costs g x its rise, and the
    // snow and the air take more on a long ramp)
    const rise = this.L.y - baseLine(this.z0);
    this.vDesign = Math.sqrt(this.vLip * this.vLip + 2 * 9.81 * rise * (1.12 + 0.02 * rise)) + 0.5;
    this.knuckleH = this.yT - baseLine(this.K.z);
  }
  // centre-line height of the takeoff (or -Inf) and of the deck (or -Inf)
  takeY(z) {
    if (z < this.z0 || z > this.L.z) return -Infinity;
    const { C, R } = this.arc, s = clamp((z - C.z) / R, -1, 1);
    return C.y - R * Math.cos(Math.asin(s));
  }
  deckY(z) {
    if (z < this.L.z || z > this.z1) return -Infinity;
    if (z < this.zBack) return this.L.y - (z - this.L.z) * Math.tan(65 * RAD);
    if (z < this.K.z) return this.yT;
    if (z < this.Kend.z) { const s = (z - this.K.z) / this.Rk; return this.yT - this.Rk * (1 - Math.sqrt(Math.max(0, 1 - s * s))); }
    const lineY = this.Kend.y - (z - this.Kend.z) * this.tl;
    return smax(lineY, baseLine(z), 2.2);
  }
  deckHalf(z) { return this.wD + (this.wL - this.wD) * smoothstep(this.K.z, this.zMeet, z); }
  height(x, z, g) {
    if (z < this.z0 - 0.5 || z > this.z1 || x < this.x0 || x > this.x1) return -Infinity;
    const bz = baseLine(z), dx = Math.abs(x - this.x), lift = g - bz;
    let best = -Infinity;
    const ty = this.takeY(z);
    if (ty > -Infinity) {
      const rel = ty - bz - Math.max(0, dx - this.wT) * 1.6;
      if (rel > 0) best = rel;
    }
    const dy = this.deckY(z);
    if (dy > -Infinity) {
      let rel = dy - bz - Math.max(0, dx - this.deckHalf(z)) * 1.15;
      if (dx > this.wT) rel = Math.min(rel, (z - this.L.z) * 0.9 + 0.05);   // the table's front face beside the ramp
      if (rel > best) best = rel;
    }
    return best > 0 ? bz + lift + best : -Infinity;
  }
  surface(x, z) { return z > this.z0 && z < this.zMeet && Math.abs(x - this.x) < this.wL; }
  // the dye lines park crews spray: along the lip and across the knuckle
  dye(x, z) {
    const dx = Math.abs(x - this.x);
    if (Math.abs(z - this.L.z + 0.08) < 0.1 && dx < this.wT) return 1;
    if (Math.abs(z - this.K.z - 0.4) < 0.12 && dx < this.wD) return 1;
    return 0;
  }
  // rows in z: fine at the lip and the knuckle
  rows(fine) {
    const r = [], st = fine ? 0.6 : 1.0;
    for (let z = this.z0 - 0.5; z < this.z1; z += st) r.push(z);
    for (let z = this.L.z - 0.5; z < this.zBack + 0.25; z += fine ? 0.05 : 0.1) r.push(z);
    for (let z = this.K.z - 0.5; z < this.Kend.z + 0.5; z += fine ? 0.2 : 0.35) r.push(z);
    for (const z of [this.L.z - 0.2, this.L.z - 0.17, this.L.z + 0.03, this.K.z + 0.26, this.K.z + 0.29, this.K.z + 0.51, this.K.z + 0.54]) r.push(z);
    r.push(this.L.z, this.L.z - 0.005, this.zBack);
    return [...new Set(r.map(v => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
  }
  cols(fine) {
    const c = [], st = fine ? 0.5 : 0.85;
    for (let x = this.x0; x <= this.x1; x += st) c.push(x);
    for (const s of [-1, 1]) for (const w of [this.wT, this.wD]) for (const e of [-0.12, 0, 0.12]) c.push(this.x + s * (w + e));
    return [...new Set(c.map(v => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
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
    const half = [], st = fine ? 0.3 : 0.5;
    let a = -this.F, prevY = this.wall(a);
    half.push(a);
    const end = this.R + 0.15 + this.deck + this.H / 0.7 + 2;
    while (a < end) {
      let da = st;
      for (let k = 0; k < 6; k++) { const y = this.wall(a + da); const l = Math.hypot(da, y - prevY); if (l > st * 1.05) da *= st / l; else break; }
      da = Math.max(da, 0.008);
      a += da; prevY = this.wall(a); half.push(a);
    }
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
// pts: [x, z, height of the top over the snow]; kind 'rail' (a round tube), 'tube' (a fat one, 0.22 m across) or
// 'box' (a flat top 0.5 m wide)
export class Rail {
  constructor(o) {
    Object.assign(this, { kind: 'rail', name: 'rail' }, o);
    this.w = this.kind === 'box' ? 0.5 : this.kind === 'tube' ? 0.22 : 0.07;
    this.P = this.pts.map(([x, z, h]) => new THREE.Vector3(x, ground(x, z) + h, z));
    this.seg = []; let s = 0;
    for (let i = 0; i < this.P.length - 1; i++) {
      const a = this.P[i], b = this.P[i + 1], d = b.clone().sub(a), len = d.length();
      this.seg.push({ a, b, d: d.clone().divideScalar(len), len, s0: s }); s += len;
    }
    this.len = s;
    this.box = new THREE.Box3().setFromPoints(this.P).expandByScalar(1.5);
  }
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

// ---- the layout ------------------------------------------------------------------------------------------------------
export function makePark() {
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
function assemble({ kickers, pipe = null, qp = null, ground2 = [], rails = [], starts, fences = [], banner = null }) {
  const ramps = rails.filter(r => r.ramp).map(r => new Wedge({ x: r.pts[0][0], zEnd: r.pts[0][1] - 0.7, h: r.ramp, hw: r.kind === 'box' ? 1.4 : 1.2 }));
  const all = [...kickers, pipe, qp, ...ground2, ...ramps].filter(Boolean);
  // a 32 m bucket grid over x and z
  const B = 32, buckets = new Map();
  for (const f of all) {
    const zs = f.zs ?? f.z0, ze = f.z1 ?? f.zEnd + 2;
    for (let bx = Math.floor(f.x0 / B); bx <= Math.floor(f.x1 / B); bx++) for (let bz = Math.floor(zs / B); bz <= Math.floor(ze / B); bz++) {
      const k = bx + ',' + bz; if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(f);
    }
  }
  const near = (x, z) => buckets.get(Math.floor(x / B) + ',' + Math.floor(z / B));
  const park = {
    kickers, pipe, qp, rails, all, fences, banner,
    // where a rider can start: the top and the start of each part of the park
    starts,
    height(x, z, g) {
      const l = near(x, z); if (!l) return -Infinity;
      let best = -Infinity;
      for (const f of l) { const y = f.height(x, z, g); if (y > best) best = y; }
      return best;
    },
    heightTerrainOnly(x, z, g) {
      const l = near(x, z); if (!l) return -Infinity;
      let best = -Infinity;
      for (const f of l) { if (f.ownMesh) continue; const y = f.height(x, z, g); if (y > best) best = y; }
      return best;
    },
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
   Seven jumps down the run, each one three takeoffs side by side, Large, Medium and Small, landing on one shared
   landing: the Large lane's table and landing are built first, and each smaller lane is placed up the hill so that its
   own (lower) table meets that same landing plane, just further down it, with the table length asked for (found by
   bisection: further down the hill, the table comes out shorter). So you can choose a size at each jump and change
   lanes between them. Beside every Large lane a fat tube runs up alongside the takeoff, along the table and out over
   the knuckle, ending just over the landing so it sets you down in it. */
const LANES = {
  L: { lip: 30, R: 15, drop: 0.8, table: 17, land: 34, wT: 3.2, wD: 5.6, wL: 9.5 },
  M: { lip: 27, R: 11, drop: 0.6, table: 11, land: 34, wT: 2.8, wD: 4.8, wL: 8.5 },
  S: { lip: 24, R: 7.5, drop: 0.4, table: 6, land: 34, wT: 2.4, wD: 4.2, wL: 7.5 },
};
// a lane that lands on another kicker's landing line, with about the table length asked for
function laneOn(big, o) {
  const tl = Math.tan(big.land * RAD), Rk = big.Rk;
  const c = big.Kend.y + big.Kend.z * tl;                        // the landing line: y + z tan(land) = c
  const tableFor = k => (c - k.yT + Rk * (1 - Math.cos(big.land * RAD))) / tl - Rk * Math.sin(big.land * RAD) - k.L.z;
  let lo = big.z0 - 60, hi = big.K.z;
  for (let it = 0; it < 40; it++) {
    const mid = (lo + hi) / 2, t = tableFor(new Kicker(Object.assign({}, o, { z0: mid, table: 5 })));
    if (t > o.table) lo = mid; else hi = mid;
  }
  const k0 = new Kicker(Object.assign({}, o, { z0: (lo + hi) / 2, table: 5 }));
  return new Kicker(Object.assign({}, o, { z0: k0.z0, table: Math.max(2.5, tableFor(k0)), Rk }));
}
export function makeJumpLine() {
  const kickers = [], rails = [], starts = [{ name: 'Top of the Jump Line', x: 0, z: -30, v: 5 }];
  const X = { L: -19, M: -6, S: 6 };
  let z0 = 58;
  for (let j = 0; j < 7; j++) {
    const big = new Kicker(Object.assign({ name: `Jump ${j + 1} Large`, x: X.L, z0 }, LANES.L));
    const med = laneOn(big, Object.assign({ name: `Jump ${j + 1} Medium`, x: X.M }, LANES.M));
    const sml = laneOn(big, Object.assign({ name: `Jump ${j + 1} Small`, x: X.S }, LANES.S));
    kickers.push(big, med, sml);
    // the tube: from the foot of the Large takeoff up beside it, along the table half a metre over it, out over the
    // knuckle, and down with the landing to stop 0.9 m over it (heights are over the bare ground, as rails take them)
    const tx = X.L - big.wD - 1.6, gz = z => ground(tx, z);
    const top = big.yT + 0.55, zA = big.z0 - 3, zB = big.L.z + 1.5, zK = big.Kend.z + 1.2, zE = zK + 4.5;
    const landY = z => big.deckY(z);
    rails.push(new Rail({ name: `Jump ${j + 1} tube`, kind: 'tube', ramp: 0.7, pts: [
      [tx, zA, 0.7], [tx, zB, top - gz(zB)], [tx, zK, top - gz(zK)], [tx, zE, landY(zE) + 0.9 - gz(zE)]] }));
    starts.push({ name: `Jump ${j + 1} (in-run)`, x: X.M, z: big.z0 - 40, v: 10 });
    // the next jump: room after this landing to set up again
    z0 = big.zMeet + 34;
  }
  const zEnd = kickers[kickers.length - 3].zMeet + 10;
  return assemble({ kickers, rails, starts, banner: 'JUMP  LINE', fences: [[X.L - LANES.L.wL - 3, 30, X.L - LANES.L.wL - 3, zEnd], [X.S + LANES.S.wL + 3, 30, X.S + LANES.S.wL + 3, zEnd]] });
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
export function featureMesh(f, heightFn, material, fine = true) {
  const rows = f.rows(fine), cols = f.cols(fine), nx = cols.length, nz = rows.length;
  const pos = new Float32Array(nx * nz * 3), nor = new Float32Array(nx * nz * 3), grm = new Float32Array(nx * nz), dye = new Float32Array(nx * nz);
  const n = new THREE.Vector3();
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const v = j * nx + i, x = cols[i], z = rows[j];
    pos[v * 3] = x; pos[v * 3 + 1] = heightFn(x, z); pos[v * 3 + 2] = z;
    grm[v] = 0.65; dye[v] = f.dye ? f.dye(x, z) : 0;
  }
  // normals from the grid (central differences, uneven spacing)
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const v = j * nx + i;
    const il = Math.max(0, i - 1), ir = Math.min(nx - 1, i + 1), jd = Math.max(0, j - 1), ju = Math.min(nz - 1, j + 1);
    const dx = cols[ir] - cols[il], dz = rows[ju] - rows[jd];
    const hx = (pos[(j * nx + ir) * 3 + 1] - pos[(j * nx + il) * 3 + 1]) / dx;
    const hz = (pos[(ju * nx + i) * 3 + 1] - pos[(jd * nx + i) * 3 + 1]) / dz;
    n.set(-hx, 1, -hz).normalize(); nor[v * 3] = n.x; nor[v * 3 + 1] = n.y; nor[v * 3 + 2] = n.z;
  }
  const idx = new (nx * nz > 65535 ? Uint32Array : Uint16Array)((nx - 1) * (nz - 1) * 6);
  let k = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('aGroom', new THREE.BufferAttribute(grm, 1));
  g.setAttribute('aDye', new THREE.BufferAttribute(dye, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere(); g.computeBoundingBox();
  const m = new THREE.Mesh(g, material);
  m.receiveShadow = true; m.castShadow = false; m.matrixAutoUpdate = false; m.name = f.name;
  return m;
}

// rails and boxes: steel tubes and plastic-topped boxes on legs, all in two instanced-free merged meshes
export function railMeshes(rails, mats) {
  const tubes = [], boxes = [], legs = [];
  for (const r of rails) {
    for (const g of r.seg) {
      const mid = g.a.clone().lerp(g.b, 0.5), len = g.len;
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), g.d);
      if (r.kind === 'rail' || r.kind === 'tube') {
        const rr = r.w / 2, c = new THREE.CylinderGeometry(rr, rr, len + 0.02, r.kind === 'tube' ? 20 : 14, 1, false); c.rotateX(Math.PI / 2);
        c.applyQuaternion(q); c.translate(mid.x, mid.y - rr, mid.z); tubes.push(c);
      } else {
        const b = new THREE.BoxGeometry(0.5, 0.06, len + 0.01); b.applyQuaternion(q); b.translate(mid.x, mid.y - 0.03, mid.z); boxes.push(b);
        const s = new THREE.BoxGeometry(0.46, 0.28, len); s.applyQuaternion(q); s.translate(mid.x, mid.y - 0.06 - 0.14, mid.z); legs.push(s);
      }
    }
    // legs every 2.5 m down into the snow
    for (let s = 0.4; s < r.len; s += 2.5) {
      const p = r.at(Math.min(s, r.len - 0.3)), gy = ground(p.x, p.z), h = p.y - gy;
      if (h < 0.15) continue;
      const w = r.kind === 'rail' ? 0.05 : r.kind === 'tube' ? 0.09 : 0.08;
      const l = new THREE.BoxGeometry(w, h + 0.4, w); l.translate(p.x, gy + (h - 0.4) / 2 - 0.05, p.z); legs.push(l);
      if (r.kind !== 'box') { const f = new THREE.BoxGeometry(r.kind === 'tube' ? 0.7 : 0.5, 0.05, 0.08); f.translate(p.x, gy + 0.02, p.z); legs.push(f); }
    }
  }
  const merge = (list) => {
    if (!list.length) return null;
    let n = 0, ni = 0; for (const g of list) { n += g.attributes.position.count; ni += g.index.count; }
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), idx = new Uint32Array(ni);
    let o = 0, oi = 0;
    for (const g of list) {
      pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
      const ix = g.index.array; for (let i = 0; i < ix.length; i++) idx[oi + i] = ix[i] + o;
      o += g.attributes.position.count; oi += ix.length; g.dispose();
    }
    const m = new THREE.BufferGeometry();
    m.setAttribute('position', new THREE.BufferAttribute(pos, 3)); m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    m.setIndex(new THREE.BufferAttribute(idx, 1)); m.computeBoundingSphere();
    return m;
  };
  const out = new THREE.Group(); out.name = 'rails';
  const add = (g, mat) => { if (!g) return; const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false; out.add(m); };
  add(merge(tubes), mats.steel); add(merge(boxes), mats.boxTop); add(merge(legs), mats.frame);
  return out;
}
