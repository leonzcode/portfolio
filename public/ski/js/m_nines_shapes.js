/* (N, round 12) Shapes for the Nines map's snow structures, built from the course's measured profiles.
   A profile is drawn as a turtle path in (t, y): straight runs and circular arcs between them, so every profile is smooth
   (no corner a ski could catch) where the real one is, and sharp only where it is meant to be (a lip's edge). An Ext is a
   profile extruded across its own width: in a frame of its own (u across, s along, turned by yaw about x, z; s along +z
   when yaw is 0), with the profile either along s (a takeoff, a landing, a step: ext 's') or across u (a hip's or a
   wall's section, run along s: ext 'u'). Its heights are absolute (metres in the map's frame), so a deck is level however
   the ground under it lies; where the ground stands higher, the ground is the snow. Past its core it falls away at its
   own side slope over a rounded shoulder down into the ground, as packed snow does. The ends of the extruded direction
   fall the same way, or are cut square (ends: 'cut'), or tapered into the ground (ends: 'taper').
   Each Ext has a mesh of its own (main.js builds it with the jumps: park.js featureMeshSteps reads toWorld, rows, cols). */
import { smoothstep, clamp, smax } from './noise.js?v=31';

const RAD = Math.PI / 180;
const uniq = a => [...new Set(a.map(v => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
const span = (a, b, st) => { const o = [], n = Math.max(1, Math.ceil((b - a) / st)); for (let i = 0; i <= n; i++) o.push(a + (b - a) * i / n); return o; };

/* a turtle path: start at (t, y) heading a (degrees, + up), then .line(len), .arcTo(angle, R) (turn to the new heading
   along a circle of radius R), .lineTo(t) (straight on to t), .dropTo(t, y) (a straight face to a point), .flat(len).
   sample() gives evenly spaced heights for lookups, and the breaks (where the shape changes) for the mesh rows. */
export class Prof {
  constructor(t, y, a = 0) { this.pts = [[t, y]]; this.t = t; this.y = y; this.a = a * RAD; this.breaks = [t]; }
  line(len) { this.t += len * Math.cos(this.a); this.y += len * Math.sin(this.a); this.pts.push([this.t, this.y]); this.breaks.push(this.t); return this; }
  lineTo(t) { return this.line((t - this.t) / Math.cos(this.a)); }
  // a straight run that ends at height y (on the current heading)
  lineToY(y) { return Math.abs(Math.sin(this.a)) < 1e-6 ? this : this.line((y - this.y) / Math.sin(this.a)); }
  arcTo(deg, R) {
    const a1 = deg * RAD, a0 = this.a, n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / (2 * RAD)));
    const sg = a1 > a0 ? 1 : -1;                   // (turning up: the centre above the path)
    const cx = this.t - sg * R * Math.sin(a0), cy = this.y + sg * R * Math.cos(a0);
    for (let i = 1; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; this.pts.push([cx + sg * R * Math.sin(a), cy - sg * R * Math.cos(a)]); }
    const e = this.pts[this.pts.length - 1]; this.t = e[0]; this.y = e[1]; this.a = a1; this.breaks.push(this.t);
    return this;
  }
  // a face straight to (t, y) (a back face, a lip's drop): the heading then follows it
  dropTo(t, y) { this.a = Math.atan2(y - this.y, t - this.t); this.t = t; this.y = y; this.pts.push([t, y]); this.breaks.push(t); return this; }
  flat(len) { this.a = 0; return this.line(len); }
  get end() { return this.t; }
  // evenly spaced samples (every dt metres): y(t) for t0 <= t <= t1, -Infinity outside
  done(dt = 0.04) {
    const P = this.pts, t0 = P[0][0], t1 = P[P.length - 1][0], n = Math.max(2, Math.ceil((t1 - t0) / dt) + 1);
    const Y = new Float32Array(n); let k = 0;
    for (let i = 0; i < n; i++) {
      const t = t0 + (t1 - t0) * i / (n - 1);
      while (k < P.length - 2 && P[k + 1][0] < t) k++;
      const [ta, ya] = P[k], [tb, yb] = P[k + 1];
      Y[i] = tb > ta ? ya + (yb - ya) * clamp((t - ta) / (tb - ta), 0, 1) : Math.max(ya, yb);
    }
    this.S = { t0, t1, n, dt: (t1 - t0) / (n - 1), Y };
    return this;
  }
  at(t) {
    const S = this.S; if (t < S.t0 || t > S.t1) return -Infinity;
    const f = (t - S.t0) / S.dt, i = Math.min(S.n - 2, Math.floor(f)), r = f - i;
    return S.Y[i] + (S.Y[i + 1] - S.Y[i]) * r;
  }
}

/* an extrusion. o: { name, group, x, z, yaw (radians; s along the profile's direction when ext 's'), prof: Prof (t along s
   from 0 when ext 's', along u when ext 'u'), w: half width of the flat core across (ext 's') or half length along s
   (ext 'u': the core runs s from -w to +w), side: side slope (rise over run), shoulder: its rounding (m), ends: 'fall' |
   'cut' | 'taper' (ext 'u': the ends along s), taper: metres the ends take, dyeBands: [[t0, t1], ...] bands sprayed blue
   (along the profile), dyeEdges: true for lines along the core's edges }. heights of the profile are absolute. */
export class Ext {
  constructor(o) {
    Object.assign(this, { ext: 's', yaw: 0, w: 3, side: 0.62, shoulder: 0.8, ends: 'fall', taper: 4, ownMesh: true, local: true, trim: true, lod: true, name: 'feature', group: 'Features', dyeBands: [], dyeEdges: false, wMax: null, groomV: 0.96 }, o);   // (groomV: main.js gives the mesh this groomed value: built snow, no rock on its faces)
    this.sy = Math.sin(this.yaw); this.cy = Math.cos(this.yaw);
    const P = this.prof.S, hMax = Math.max(...P.Y) - Math.min(...P.Y) + 2;
    this.reach = this.shoulder + hMax / this.side + 1;
    if (this.ext === 's') { this.u0 = -this.w - this.reach; this.u1 = this.w + this.reach; this.s0 = P.t0; this.s1 = P.t1; }
    else if (this.ext === 'u') { this.u0 = P.t0; this.u1 = P.t1; this.s0 = -this.w - (this.ends === 'fall' ? this.reach : 0); this.s1 = this.w + (this.ends === 'fall' ? this.reach : 0); }
    this.bound();
  }
  toWorld(u, s, out) { out.x = this.x + u * this.cy + s * this.sy; out.z = this.z - u * this.sy + s * this.cy; return out; }
  toLocal(x, z, out) { const dx = x - this.x, dz = z - this.z; out.u = dx * this.cy - dz * this.sy; out.s = dx * this.sy + dz * this.cy; return out; }
  bound() {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; const p = {};
    for (const [u, s] of [[this.u0, this.s0], [this.u1, this.s0], [this.u0, this.s1], [this.u1, this.s1]]) { this.toWorld(u, s, p); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    this.x0 = x0 - 0.5; this.x1 = x1 + 0.5; this.zs = z0 - 0.5; this.z1 = z1 + 0.5; this.z0 = this.zs;
  }
  // the drop beside the core, d metres out: a rounded shoulder, then the side slope
  sideDrop(d) { const r = this.shoulder; return d <= 0 ? 0 : d < r ? this.side * d * d / (2 * r) : this.side * (d - r / 2); }
  // the absolute height at local (u, s), or -Infinity
  yAt(u, s) {
    if (this.ext === 's') {
      const y = this.prof.at(s); if (y === -Infinity) return -Infinity;
      const hw = this.wAt ? this.wAt(s) : this.w;
      return y - this.sideDrop(Math.abs(u) - hw);
    }
    let y = this.prof.at(u); if (y === -Infinity) return -Infinity;
    if (this.along) y += this.along(s);            // (ext 'u': the section raised or lowered along its length)
    const d = Math.abs(s) - this.w;
    if (d <= 0) return y;
    if (this.ends === 'cut') return -Infinity;
    if (this.ends === 'taper') { const k = 1 - smoothstep(0, this.taper, d); return k <= 0 ? -Infinity : y - (1 - k) * (this.taperH || 6); }
    return y - this.sideDrop(d);
  }
  height(x, z, g) {
    if (x < this.x0 || x > this.x1 || z < this.zs || z > this.z1) return -Infinity;
    const L = this.toLocal(x, z, this._l || (this._l = {}));
    let y = this.yAt(L.u, L.s);
    if (this.blendG && y > -Infinity && (this.blendFrom == null || (this.ext === 's' ? L.s : L.u) > this.blendFrom)) y = smax(y, g, this.blendG);   // (blendG: run out into the snow, rounded over that many metres; only past blendFrom along the profile)
    return y > g + 0.002 ? y : -Infinity;
  }
  surface(x, z) {
    if (x < this.x0 || x > this.x1 || z < this.zs || z > this.z1) return false;
    const L = this.toLocal(x, z, this._l2 || (this._l2 = {}));
    const y = this.yAt(L.u, L.s); if (y === -Infinity) return false;
    return y > this.groundAt(x, z) + 0.05;
  }
  groundAt(x, z) { return this.ground ? this.ground(x, z) : -Infinity; }
  // the mesh: rows along s, columns across u (fine over the profile's breaks and the core's edges)
  rows(fine) {
    if (this.ext === 's') return this.profRows(fine, this.s0, this.s1);
    const r = span(this.s0, this.s1, fine ? 0.8 : 1.4);
    for (const e of [-0.3, 0, 0.3]) r.push(-this.w + e, this.w + e);
    return uniq(r.filter(v => v >= this.s0 && v <= this.s1));
  }
  cols(fine) {
    if (this.ext === 'u') return this.profRows(fine, this.u0, this.u1);
    const c = span(this.u0, this.u1, fine ? 0.8 : 1.3);
    // (the core's edge where it is widest and narrowest: a core that flares, wAt, gets both)
    for (const hw of [this.wMax || this.w, this.wMin].filter(Boolean)) for (const sg of [-1, 1]) for (const e of [-0.25, 0, 0.2, 0.45, 0.8, 1.2]) c.push(sg * (hw + e));
    return uniq(c.filter(v => v >= this.u0 && v <= this.u1));
  }
  // along the profile: every 0.5 m (0.9 on the low tier) where it is straight, 0.15 (0.3) through its arcs, fine at breaks
  profRows(fine, a, b) {
    const S = this.prof.S, Y = S.Y, r = [a, b], st = fine ? 0.5 : 0.9, sa = fine ? 0.15 : 0.3;
    let last = a;
    for (let i = 1; i < S.n - 1; i++) {
      const t = S.t0 + i * S.dt, k = Math.abs(Y[i + 1] - 2 * Y[i] + Y[i - 1]) / (S.dt * S.dt);   // (curvature)
      const want = k > 0.02 ? sa : st;
      if (t - last >= want) { r.push(t); last = t; }
    }
    for (const t of this.prof.breaks) for (const e of [-0.06, 0, 0.06]) r.push(t + e);
    return uniq(r.filter(v => v >= a && v <= b));
  }
  rowsFar() { return this.ext === 's' ? uniq(this.profRows(false, this.s0, this.s1).filter((v, i, a) => i % 2 === 0 || i === a.length - 1)) : span(this.s0, this.s1, 2.5); }
  colsFar() { return this.ext === 'u' ? uniq(this.profRows(false, this.u0, this.u1).filter((v, i, a) => i % 2 === 0 || i === a.length - 1)) : span(this.u0, this.u1, 2); }
  dye(x, z) {
    if (!this.dyeBands.length && !this.dyeEdges) return 0;
    const L = this.toLocal(x, z, this._l3 || (this._l3 = {})), t = this.ext === 's' ? L.s : L.u, a = this.ext === 's' ? L.u : L.s;
    const hw = this.ext === 's' ? (this.wAt ? this.wAt(L.s) : this.w) : this.w;
    if (Math.abs(a) > hw + 0.05) return 0;
    for (const [t0, t1] of this.dyeBands) if (t >= t0 && t <= t1) return 1;
    if (this.dyeEdges && Math.abs(Math.abs(a) - hw + 0.08) < 0.08) return 1;
    return 0;
  }
}

/* a round shape in a frame of its own: u the radius from (x, z), s the arc length at radius RR (a full turn). y(r) is a
   profile in r (a Prof from 0 outwards): a dome, a cone, a round bowl's rim and pit, a volcano. Absolute heights. */
export class Round extends Ext {
  constructor(o) { super(Object.assign({ ext: 'r', RR: 4 }, o)); }
  toWorld(u, s, out) { const a = s / this.RR; out.x = this.x + u * Math.cos(a); out.z = this.z + u * Math.sin(a); return out; }
  toLocal(x, z, out) { const dx = x - this.x, dz = z - this.z; out.u = Math.hypot(dx, dz); out.s = Math.atan2(dz, dx) * this.RR; return out; }
  bound() {
    const R = this.prof.S.t1; this.u0 = 0; this.u1 = R; this.s0 = -Math.PI * this.RR; this.s1 = Math.PI * this.RR;
    this.x0 = this.x - R - 0.5; this.x1 = this.x + R + 0.5; this.zs = this.z0 = this.z - R - 0.5; this.z1 = this.z + R + 0.5;
  }
  yAt(u) { return this.prof.at(u); }
  rows(fine) { const n = Math.max(24, Math.round(this.prof.S.t1 * (fine ? 2.2 : 1.3))), o = []; for (let i = 0; i <= n; i++) o.push(this.s0 + (this.s1 - this.s0) * i / n); return o; }
  cols(fine) { return this.profRows(fine, 0, this.prof.S.t1); }
  rowsFar() { const n = Math.max(16, Math.round(this.prof.S.t1 * 0.6)), o = []; for (let i = 0; i <= n; i++) o.push(this.s0 + (this.s1 - this.s0) * i / n); return o; }
  colsFar() { return uniq(this.profRows(false, 0, this.prof.S.t1).filter((v, i, a) => i % 2 === 0 || i === a.length - 1)); }
  dye(x, z) { if (!this.dyeBands.length) return 0; const r = Math.hypot(x - this.x, z - this.z); for (const [a, b] of this.dyeBands) if (r >= a && r <= b) return 1; return 0; }
}

/* a sunken rounded rectangle (a skate pool): its floor at yF, its coping at yC, transitions of radius R from the floor up
   to near-vertical walls, a flat deck round it at yC out to `deck`, then the snow falling away at `side`. hx, hz: half
   the inside's length across x and z at the coping (before turning by yaw), rc: the corners' radius in plan. */
export class Pool extends Ext {
  constructor(o) {
    const P = Object.assign({ R: 1.8, deck: 2.5, side: 0.7, rc: 2.5 }, o), depth = P.yC - P.yF;
    // the cross-section from the coping inwards (t: metres in from the coping, y)
    const pr = new Prof(-P.deck - depth / P.side - 1, P.yC - depth - 1, 0);
    super(Object.assign({ ext: 'pool', prof: pr.done(), depth }, P));
  }
  bound() {
    const e = this.deck + this.depth / this.side + 1.5, r = Math.hypot(this.hx + e, this.hz + e);
    this.u0 = -this.hx - e; this.u1 = this.hx + e; this.s0 = -this.hz - e; this.s1 = this.hz + e;
    this.x0 = this.x - r; this.x1 = this.x + r; this.zs = this.z0 = this.z - r; this.z1 = this.z + r;
  }
  // signed distance in plan from the coping's rounded rectangle (negative inside)
  sd(u, s) { const qx = Math.abs(u) - (this.hx - this.rc), qz = Math.abs(s) - (this.hz - this.rc); return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - this.rc; }
  yAt(u, s) {
    const d = this.sd(u, s), R = Math.min(this.R, this.depth);
    if (d <= 0) {                           // inside: the wall, the transition, the floor
      const t = -d;                         // metres in from the coping
      if (t >= R) return this.yF;
      // a quarter circle of radius R from the floor (t = R) up to the wall (t = 0), plus the vertical part above it
      const k = R - t, yr = this.yF + R - Math.sqrt(Math.max(0, R * R - k * k));
      return t < 0.04 ? this.yC : yr + (this.depth - R) * (t < 0.15 ? 1 : 0);
    }
    if (d < this.deck) return this.yC;
    return this.yC - (d - this.deck) * this.side;
  }
  rows(fine) { const o = span(this.s0, this.s1, fine ? 0.35 : 0.6); for (const sg of [-1, 1]) for (const e of [-1.2, -0.6, -0.3, -0.15, -0.05, 0, 0.05, 0.3]) o.push(sg * (this.hz + e)); return uniq(o.filter(v => v >= this.s0 && v <= this.s1)); }
  cols(fine) { const o = span(this.u0, this.u1, fine ? 0.35 : 0.6); for (const sg of [-1, 1]) for (const e of [-1.2, -0.6, -0.3, -0.15, -0.05, 0, 0.05, 0.3]) o.push(sg * (this.hx + e)); return uniq(o.filter(v => v >= this.u0 && v <= this.u1)); }
  rowsFar() { return span(this.s0, this.s1, 1.2); }
  colsFar() { return span(this.u0, this.u1, 1.2); }
  dye() { return 0; }
}

/* a shape given by a height function in its own frame: y(u, s) -> absolute height or -Infinity; mesh rows and columns
   every `step` metres (fine) plus the lines given (breaksU, breaksS) and a little either side of them. For built
   structures whose parts are carved out of each other (a skate pool and a bowl in a platform, tunnels under them). */
export class Fn extends Ext {
  constructor(o) {
    const S = { t0: 0, t1: 1, n: 2, dt: 1, Y: new Float32Array(2) };
    super(Object.assign({ ext: 'fn', prof: { S, at: () => 0, breaks: [] }, step: 0.4, stepLow: 0.6, breaksU: [], breaksS: [] }, o));
  }
  bound() {
    const p = {}; let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [u, s] of [[this.u0, this.s0], [this.u1, this.s0], [this.u0, this.s1], [this.u1, this.s1]]) { this.toWorld(u, s, p); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    this.x0 = x0 - 0.5; this.x1 = x1 + 0.5; this.zs = this.z0 = z0 - 0.5; this.z1 = z1 + 0.5;
  }
  yAt(u, s) { return u < this.u0 || u > this.u1 || s < this.s0 || s > this.s1 ? -Infinity : this.y(u, s); }
  lines(a, b, st, br) { const o = span(a, b, st); for (const v of br) for (const e of [-0.12, -0.04, 0, 0.04, 0.12]) o.push(v + e); return uniq(o.filter(v => v >= a && v <= b)); }
  // (denseS, denseU: [[a, b, step], ...] bands where the grid is finer: round a skate bowl's or dome's rim, which a coarse
  // square grid draws sawtooth; the far copy keeps the plain grid)
  dense(o, bands, fine) { if (bands) for (const [a, b, st] of bands) for (const v of span(a, b, fine ? st : st * 1.8)) o.push(v); return o; }
  rows(fine) { return uniq(this.dense(this.lines(this.s0, this.s1, fine ? this.step : this.stepLow, this.breaksS), this.denseS, fine).filter(v => v >= this.s0 && v <= this.s1)); }
  cols(fine) { return uniq(this.dense(this.lines(this.u0, this.u1, fine ? this.step : this.stepLow, this.breaksU), this.denseU, fine).filter(v => v >= this.u0 && v <= this.u1)); }
  rowsFar() { return this.lines(this.s0, this.s1, this.stepLow * 2, []); }
  colsFar() { return this.lines(this.u0, this.u1, this.stepLow * 2, []); }
  dye(x, z) { if (!this.dyeAt) return 0; const L = this.toLocal(x, z, this._l3 || (this._l3 = {})); return this.dyeAt(L.u, L.s) ? 1 : 0; }
}
