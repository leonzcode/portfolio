/* Freeride's land: the made-up big-mountain face's height and what stands on it (2026-11-06, for Leon: "create a new
   freeride mountain that has jumps and rails built off of rock cliffs and there are chutes and many other cliff drops
   like a freeride mountain venue ... and add a ski lift that goes from the bottom to the top").
   Our own mountain, after what real venues have (the Freeride World Tour's faces, Natural Selection's built-in-nature
   courses, Corbet's Couloir, Alaska's spines, Japan's pillows), not a copy of any one of them:
     - a summit ridge (a gentle plateau with the start pads) rolling over into a north face of about 420 m at 35
       degrees on average, broken by two traverse benches (the Ledge and the lower bench), then a finish apron and a
       runout to the chairlift's bottom station; the lift runs up beside the face to the ridge
     - skier's left (+x): the Couloirs, four rock ribs with three chutes between them: a mandatory air into a narrow
       one (a 4.5 m cornice step between its walls, a 3.6 m choke), a dog-leg one with a 3.5 m choke at its bend, and
       a wider straight one with a smaller cornice and a sneak beside it; the ribs end in 12 m cliffs
     - the centre: cliff bands (the Teeth's 2 to 4 m drops; Tier A's 6 to 8 m with breaks; a stacked step-down of two
       5 m drops with a 14 m ledge; the Big Ones, 9 to 19 m over a long steep apron), rock outcrops that are natural
       kickers and drops, then a pillow field, and the Great Wall's 3 to 6 m band at the bottom of the face
     - skier's right (-x): spines and flutes up high, wind lips on the convex breaks, and the Selection zone: kickers
       built on rock bands (park.js Kickers whose lips sit on the rock), a log laid off a rock ledge, a rock slab, a
       rock rail, stumps and boulders
   Everything is a height function over x (across, + skier's left looking down) and z (down the fall line), y up,
   with y = 0 at the main start. The physics reads it directly (terrain.js ground through setMountain); rock faces are
   steeper than skier.js's walls (about 53 degrees), so they are walls to ride into and drops to ride off.
   This module is plain JS (no three.js) so it can be checked in Node. */
import { simplex, fbm, ridged, smoothstep, clamp, smax } from './noise.js?v=18';

const RAD = Math.PI / 180;

// ---- the long profile down the face ----------------------------------------------------------------------------
// [z where it starts, pitch in degrees]: the peak behind the ridge, the summit plateau with the start pads (7), the
// upper face, the Ledge, the middle face, the lower bench, the lower face, the finish apron, the runout
// (the open slopes are held to 36 degrees: steeper, the game's skis start to slip and its snow shows rock through; the
// steeps are the cliffs, the chutes and the aprons under them)
export const SECT = [[-1400, -16], [-470, 22], [-150, 12], [-80, 7], [-9, 36], [160, 25], [190, 36], [346, 25], [372, 36],
  [530, 30], [590, 20], [660, 13], [740, 6], [980, 3.5], [1400, 2]];
const PZ0 = -1400, PZ1 = 2600, PDZ = 0.5, PN = Math.round((PZ1 - PZ0) / PDZ) + 1;
const PB = new Float32Array(PN);
(function profile() {
  const raw = new Float32Array(PN), P = new Float32Array(PN);
  let k = 0;
  for (let i = 0; i < PN; i++) { const z = PZ0 + i * PDZ; while (k + 1 < SECT.length && z >= SECT[k + 1][0]) k++; raw[i] = SECT[k][1] * RAD; }
  const W = Math.round(8 / PDZ);           // a 16 m box filter: every change of pitch is a smooth curve
  for (let i = 0; i < PN; i++) { let s = 0; for (let j = i - W; j <= i + W; j++) s += raw[Math.max(0, Math.min(PN - 1, j))]; P[i] = s / (2 * W + 1); }
  const i0 = Math.round((-30 - PZ0) / PDZ);   // y = 0 at the main start
  PB[i0] = 0;
  for (let i = i0 + 1; i < PN; i++) PB[i] = PB[i - 1] - Math.tan(P[i]) * PDZ;
  for (let i = i0 - 1; i >= 0; i--) PB[i] = PB[i + 1] + Math.tan(P[i + 1]) * PDZ;
})();
export function baseZ(z) {
  const f = (clamp(z, PZ0, PZ1) - PZ0) / PDZ, i = Math.min(PN - 2, Math.floor(f)), t = f - i;
  return PB[i] + (PB[i + 1] - PB[i]) * t;
}

// ---- across the face ----------------------------------------------------------------------------------------------
/* a shallow bowl over the face; to the east (+x) a broad shoulder the chairlift runs up (x 150 to 205, nearly level
   across), then the east ridge; to the west the west ridge. Far off, the neighbouring peaks. */
export const LIFT_X = 172;
function lateral(x, z) {
  const ax = Math.abs(x);
  let y = 0.00045 * Math.min(ax, 150) * Math.min(ax, 150) * (1 - 0.7 * smoothstep(640, 860, z));
  // (the sides rise gently: steeper, with the face's own 36 degrees down the hill, the snow shader shows rock through)
  if (x > 150) {
    y += 0.135 * (x - 150) - 0.05 * smoothstep(150, 205, x) * (x - 150);            // the lift's shoulder
    if (x > 205) { const u = x - 205; y += 0.12 * u * smoothstep(0, 40, u); }
  } else if (x < -150) {
    const u = -x - 150; y += 0.135 * u + 0.1 * u * smoothstep(0, 40, u);
  }
  return y;
}
// the big gentle rolls of a natural face (80 to 120 m across, a metre or two): none on the start plateau, the
// finish and the lift's pads
function rolls(x, z) {
  const k = smoothstep(-6, 30, z) * (1 - smoothstep(560, 640, z)) * (1 - smoothstep(140, 160, Math.abs(x)));
  return k > 0 ? 1.6 * fbm(x * 0.011 + 3.1, z * 0.009 - 1.7, 2) * k : 0;
}
// the far mountains: grow from about 300 m out of the venue
function far(x, z) {
  const dx = Math.max(0, Math.abs(x - 10) - 260), dz = Math.max(0, -500 - z, z - 1150), d = Math.hypot(dx, dz);
  if (d < 1) return 0;
  const k = smoothstep(0, 700, d);
  return k * (280 * ridged(x * 0.0011 + 7.7, z * 0.0011 - 2.3, 4) - 60);
}

// ---- shapes ---------------------------------------------------------------------------------------------------------
// a soft-kneed ramp 0 -> 1 over [0, w] (linear between, quadratic corners of k x w): a rock face's profile
function face(d, w, k = 0.16) {
  const t = d / w;
  if (t <= -k) return 0;
  if (t >= 1 + k) return 1;
  if (t < k) return (t + k) * (t + k) / (4 * k);
  if (t > 1 - k) return 1 - (1 + k - t) * (1 + k - t) / (4 * k);
  return t;
}
// piecewise linear through [[u, v], ...] (u ascending), held at the ends
function pl(pts, u) {
  if (u <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (u <= pts[i][0]) { const [a, va] = pts[i - 1], [b, vb] = pts[i]; return va + (vb - va) * (u - a) / (b - a); }
  return pts[pts.length - 1][1];
}
const wig = (u, seed, a) => a * (simplex(u * 0.05, seed * 7.31) + 0.4 * simplex(u * 0.19, seed * 3.7 + 5.1));
// the terrain's visual height held down towards target by w (0 to 1): faded in with a face's height, so where a rock
// curtain ends (at a face of 0.4 m) the terrain is back at its own height and never steps
const fade = (y, target, w) => w >= 1 ? target : target >= y ? Infinity : y - (y - target) * w;
// a rock face's width (horizontal) for a drop of H: about 75 to 80 degrees
export const faceW = H => 0.5 + 0.15 * H;

/* A cliff band across the fall line: its lip at z(x) (wiggling), its face looking down the hill. H(x) from points
   [[x, H], ...] (0 at both ends). The drop is shared: the snow above is raised by a x H, tapering back over Rup (a bench
   that is gentlest at the lip), the apron below lowered by (1 - a) x H, recovering over Rdn (steepest at its foot). */
export class Band {
  constructor(o) {
    Object.assign(this, { kind: 'band', a: 0.6, Rup: 16, Rdn: 24, wig: 1.2, seed: 1, name: 'Cliff band', rock: true }, o);
    this.xa = this.pts[0][0]; this.xb = this.pts[this.pts.length - 1][0];
    this.Hmax = Math.max(...this.pts.map(p => p[1]));
    this.x0 = this.xa; this.x1 = this.xb;
    this.z0 = this.z - Math.abs(this.wig) * 1.5 - this.Rup - 1; this.z1 = this.z + Math.abs(this.wig) * 1.5 + faceW(this.Hmax) + this.Rdn + 1;
  }
  H(x) { return x <= this.xa || x >= this.xb ? 0 : pl(this.pts, x); }
  zL(x) { return this.z + wig(x, this.seed, this.wig) + (this.slant || 0) * (x - this.xa); }
  h(x, z) {
    if (x <= this.xa || x >= this.xb) return 0;
    const H = pl(this.pts, x); if (H < 0.02) return 0;
    const d = z - this.zL(x), w = faceW(H);
    if (d < -this.Rup || d > w + this.Rdn) return 0;
    const up = this.a * H;
    if (d <= 0) { const t = 1 + d / this.Rup; return up * t * t; }
    if (d < w) return up - H * face(d, w);
    return (up - H) * (1 - smoothstep(0, this.Rdn, d - w));
  }
  // the visual target (terrain.js visualHeight on fine patches, st m a cell): from st + 0.3 above the lip to the
  // foot, the terrain is held under the foot so its coarse triangles never stand in front of the face (the rock meshes
  // draw the real surface there)
  dip(x, z, st, G, y) {
    if (x <= this.xa || x >= this.xb) return Infinity;
    const H = pl(this.pts, x); if (H < 0.45) return Infinity;
    const zl = this.zL(x), d = z - zl, w = faceW(H);
    if (d < -(st + 0.3) || d > w + 0.3) return Infinity;
    return fade(y, G(x, zl + w + 0.35) - 0.5, smoothstep(0.45, 1.3, H));
  }
}

/* A rock rib: a ridge of rock raised D(z) between two edges xl(z) and xr(z) (points [[z, x], ...]), its walls
   falling outward over ww m; it grows out of the slope from zTop over grow m (no wall there) and ends in a cliff at
   zEnd (wiggling). Chutes are the gaps between ribs. */
export class Rib {
  constructor(o) {
    Object.assign(this, { kind: 'rib', D: 12, ww: 2, grow: 18, wEnd: 2.2, seed: 2, name: 'Rock rib', rock: true }, o);
    const xs = [...this.xl.map(p => p[1]), ...this.xr.map(p => p[1])];
    this.x0 = Math.min(...xs) - this.ww - 2; this.x1 = Math.max(...xs) + this.ww + 2;
    this.z0 = this.zTop - 1; this.z1 = this.zEnd + 3 + this.wEnd + 2;
  }
  L(z) { return pl(this.xl, z) + wig(z, this.seed, this.wigL || 0.9); }
  R(z) { return pl(this.xr, z) + wig(z, this.seed + 11, this.wigR || 0.9); }
  zE(x) { return this.zEnd + wig(x, this.seed + 3, 1.6); }
  Dz(z) { return this.D * smoothstep(this.zTop, this.zTop + this.grow, z) * (1 + 0.16 * simplex(z * 0.045, this.seed * 1.7)); }
  h(x, z) {
    if (z < this.zTop || x < this.x0 || x > this.x1) return 0;
    const ze = this.zE(x); if (z > ze + this.wEnd * 1.2) return 0;
    const D = this.Dz(z); if (D < 0.01) return 0;
    const l = this.L(z), r = this.R(z), ww = this.ww;
    const mx = (1 - face(l - x, ww)) * (1 - face(x - r, ww));
    if (mx <= 0) return 0;
    return D * mx * (1 - face(z - ze, this.wEnd));
  }
  dip(x, z, st, G, y) {
    if (z < this.zTop + 2 || x < this.x0 || x > this.x1) return Infinity;
    const D = this.Dz(z); if (D < 0.55) return Infinity;
    const l = this.L(z), r = this.R(z), ww = this.ww, ze = this.zE(x), m = st + 0.3;
    let t = Infinity;
    // the side walls (x inside the top edge by up to m, or on the wall), unless the bottom cliff is there instead
    if (z < ze + 0.3) {
      if (x > l - ww - 0.3 && x < l + m) t = Math.min(t, G(l - ww - 0.35, z) - 0.5);
      if (x < r + ww + 0.3 && x > r - m) t = Math.min(t, G(r + ww + 0.35, z) - 0.5);
    }
    // the bottom cliff
    if (x > l - ww && x < r + ww && z > ze - m && z < ze + this.wEnd + 0.3) t = Math.min(t, G(x, ze + this.wEnd + 0.35) - 0.5);
    return t === Infinity ? t : fade(y, t, smoothstep(0.55, 1.6, D));
  }
}

/* A rock outcrop on the slope: a rounded block whose top is raised from hUp at its uphill end to hDn at its downhill
   lip (more than the slope falls, and it kicks: a natural kicker; less, and it is a rock drop), its sides and lip rock
   faces of w m. x, z: its middle; len along the fall line, hw half across. */
export class Outcrop {
  constructor(o) {
    Object.assign(this, { kind: 'out', hUp: 0.2, w: 1.0, round: 0.45, seed: 3, name: 'Rock outcrop', rock: true }, o);
    this.za = this.z - this.len / 2; this.zb = this.z + this.len / 2;
    this.x0 = this.x - this.hw - this.w - 1; this.x1 = this.x + this.hw + this.w + 1;
    this.z0 = this.za - 1; this.z1 = this.zb + this.w + 1;
  }
  // signed distance outside the footprint (a rounded rectangle; - inside), in metres
  out(x, z) {
    const r = Math.min(this.hw, this.len / 2) * this.round;
    const qx = Math.abs(x - this.x) - (this.hw - r), qz = Math.abs(z - this.z) - (this.len / 2 - r);
    return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
  }
  raise(z) { return this.hUp + (this.hDn - this.hUp) * clamp((z - this.za) / this.len, 0, 1); }
  h(x, z) {
    if (x < this.x0 || x > this.x1 || z < this.z0 || z > this.z1) return 0;
    const d = this.out(x, z); if (d > this.w * 1.2) return 0;
    // (a little rough on top: snow over rock)
    return this.raise(z) * (1 - face(d, this.w)) + (d < 0 ? 0.12 * simplex(x * 0.7 + this.seed, z * 0.7) * smoothstep(0, -1.5, d) : 0);
  }
  dip(x, z, st, G, y) {
    if (x < this.x0 || x > this.x1 || z < this.z0 || z > this.z1) return Infinity;
    const d = this.out(x, z), Hh = this.raise(z);
    if (Hh < 0.5 || d < -(st + 0.3) || d > this.w + 0.3) return Infinity;
    // (the ground just outside the face, straight out from the footprint's edge)
    const e = 0.05, gx = this.out(x + e, z) - this.out(x - e, z), gz = this.out(x, z + e) - this.out(x, z - e), gl = Math.hypot(gx, gz) || 1, k = this.w + 0.4 - d;
    return fade(y, G(x + gx / gl * k, z + gz / gl * k) - 0.5, smoothstep(0.5, 1.3, Hh));
  }
}

// a chute's floor dropping deeper than the slope (steeper) and recovering: dips E m at zb, between edges L(z), R(z)
export class Gully {
  constructor(o) {
    Object.assign(this, { kind: 'gully', rock: false, name: 'Chute floor' }, o);
    this.x0 = this.xa; this.x1 = this.xb;
    this.z0 = this.za; this.z1 = this.zc;
  }
  h(x, z) {
    if (z <= this.za || z >= this.zc || x < this.xa || x > this.xb) return 0;
    const e = z < this.zb ? smoothstep(this.za, this.zb, z) : 1 - smoothstep(this.zb, this.zc, z);
    if (e <= 0) return 0;
    // (the whole chute between the walls' tops goes down: the floor stays flat across to the walls' feet, the walls
    // only get taller; it eases out on the ribs' tops just past their edges. Faded out at the walls' feet, it raised
    // 60 degree banks inside the chute that threw riders off)
    const l = this.left.L(z), r = this.right.L(z);
    const m = smoothstep(l - 1.5, l + 0.3, x) * (1 - smoothstep(r - 0.3, r + 1.5, x));
    // (a gentle V across the floor: a gully)
    const lf = l + this.left.ww, rf = r - this.right.ww, mid = (lf + rf) / 2, half = Math.max(1, (rf - lf) / 2), v = 1 - Math.min(1, Math.abs(x - mid) / half);
    return -(this.E * e + 0.35 * v * v * e) * m;
  }
}

/* spines and flutes: snow ridges down the fall line, crests 2 to 3 m across, flanks of about 36 degrees across the
   slope (with the slope's own 37, about 47 degrees at the steepest: steep enough to slip on, not a wall), the flutes
   between them rounded gullies */
export class Spines {
  constructor(o) {
    Object.assign(this, { kind: 'spines', rock: false, name: 'The Spines', cross: 0.73, crest: 1.2 }, o);
    this.x0 = Math.min(...this.list.map(s => s.x)) - 16; this.x1 = Math.max(...this.list.map(s => s.x)) + 16;
    this.z0 = this.za; this.z1 = this.zb;
  }
  cx(s, z) { return s.x + 2.6 * Math.sin(z * 0.035 + s.ph) + 1.2 * simplex(z * 0.04, s.ph * 9); }
  h(x, z) {
    if (z <= this.za || z >= this.zb || x < this.x0 || x > this.x1) return 0;
    let a = 0, b = 0;
    for (const s of this.list) {
      const hz = s.h * smoothstep(this.za, this.za + 26, z) * (1 - smoothstep(this.zb - 30, this.zb, z));
      if (hz <= 0) continue;
      const d = x - this.cx(s, z), dd = Math.sqrt(d * d + this.crest * this.crest) - this.crest;
      const v = hz - this.cross * dd;
      if (v > a) { b = a; a = v; } else if (v > b) b = v;
    }
    // (the flute between two spines rounded, and the field never under the slope)
    return Math.max(0, smax(smax(a, b, 1.6), 0, 1.0) - 0.4) ;
  }
}

/* pillows: domes of snow over boulders, 3 to 6 m across and 1.2 to 2.5 m high, steeper on their downhill side, so a
   line of them is a staircase of small drops */
export class Pillows {
  constructor(o) {
    Object.assign(this, { kind: 'pillows', rock: false, name: 'Pillow field' }, o);
    this.x0 = Math.min(...this.list.map(p => p.x - p.r)) - 1; this.x1 = Math.max(...this.list.map(p => p.x + p.r)) + 1;
    this.z0 = Math.min(...this.list.map(p => p.z - p.r)) - 1; this.z1 = Math.max(...this.list.map(p => p.z + p.r)) + 1;
    // a grid of them by 8 m cells
    this.grid = new Map();
    for (const p of this.list) for (let i = Math.floor((p.x - p.r) / 8); i <= Math.floor((p.x + p.r) / 8); i++) for (let j = Math.floor((p.z - p.r) / 8); j <= Math.floor((p.z + p.r) / 8); j++) {
      const k = i * 4096 + j; if (!this.grid.has(k)) this.grid.set(k, []); this.grid.get(k).push(p);
    }
  }
  h(x, z) {
    const l = this.grid.get(Math.floor(x / 8) * 4096 + Math.floor(z / 8)); if (!l) return 0;
    let best = 0;
    for (const p of l) {
      const dx = (x - p.x) / p.r, dzr = z - p.z, dz = dzr / (dzr > 0 ? p.r * 0.58 : p.r);
      const q = dx * dx + dz * dz; if (q >= 1) continue;
      const v = p.h * Math.pow(1 - q, 1.4);
      if (v > best) best = v;
    }
    return best;
  }
}

// a wind lip: a curl of snow along a convex break or a ridge, rising gently over `up` m to h and dropping over dn m
export class Lip {
  constructor(o) {
    Object.assign(this, { kind: 'lip', rock: false, up: 4, dn: 0.9, seed: 4, name: 'Wind lip' }, o);
    this.x0 = this.xa; this.x1 = this.xb; this.z0 = this.z - this.up - 3; this.z1 = this.z + this.dn + 3;
  }
  h(x, z) {
    if (x <= this.xa || x >= this.xb) return 0;
    const e = smoothstep(this.xa, this.xa + 4, x) * (1 - smoothstep(this.xb - 4, this.xb, x));
    const d = z - (this.z + wig(x, this.seed, 1.2)), hh = this.h0 * e * (0.8 + 0.2 * simplex(x * 0.15, this.seed));
    if (d < -this.up || d > this.dn) return 0;
    return d <= 0 ? hh * smoothstep(-this.up, 0, d) * (0.3 + 0.7 * smoothstep(-this.up, 0, d)) : hh * (1 - face(d, this.dn, 0.3));
  }
}

// ---- the layout -----------------------------------------------------------------------------------------------------
// (all in one place; the names are what the start menu and the report call them)
function layout() {
  const F = [];
  // the summit's wind lip, just before the face rolls over (a natural kicker from the main start)
  F.push(new Lip({ xa: -46, xb: 42, z: -13, h0: 0.95, up: 5, dn: 1.0, seed: 21, name: 'Summit lip' }));
  // ---- the Couloirs (skier's left): four rock ribs, three chutes
  const R0 = new Rib({ name: 'West rib', wigL: 2.4, xl: [[-20, 46], [130, 48]], xr: [[-20, 60], [28, 60], [40, 59], [130, 59]], zTop: -2, grow: 20, D: 12, zEnd: 116, seed: 31 });
  const R1 = new Rib({ name: 'Middle rib', xl: [[-20, 67.6], [28, 67.6], [42, 72], [130, 72]], xr: [[-20, 84], [48, 84], [62, 92], [70, 97.5], [130, 97.5]], zTop: 2, grow: 18, D: 13, zEnd: 120, seed: 32 });
  const R2 = new Rib({ name: 'East rib', xl: [[-20, 96], [48, 96], [60, 101], [70, 105], [85, 105], [100, 109.5], [130, 109.5]], xr: [[-20, 119], [130, 119]], zTop: 6, grow: 18, D: 13, zEnd: 118, seed: 33 });
  const R3 = new Rib({ name: 'Outer rib', wigR: 2.4, xl: [[-20, 133], [130, 133]], xr: [[-20, 142], [130, 142]], zTop: 0, grow: 18, D: 12, zEnd: 112, seed: 34 });
  F.push(R0, R1, R2, R3);
  // the chutes' floors: steeper than the slope through their chokes (C1 about 41, C2's dog-leg about 43 degrees)
  F.push(new Gully({ name: 'Corbet-style chute', ribs: [R0, R1], left: { L: z => R0.R(z), ww: R0.ww }, right: { L: z => R1.L(z), ww: R1.ww }, xa: 56, xb: 76, za: 14, zb: 55, zc: 125, E: 3.5 }));
  F.push(new Gully({ name: 'Dog-leg chute', ribs: [R1, R2], left: { L: z => R1.R(z), ww: R1.ww }, right: { L: z => R2.L(z), ww: R2.ww }, xa: 80, xb: 113, za: 10, zb: 78, zc: 128, E: 4.2 }));
  F.push(new Gully({ name: 'Wide chute', ribs: [R2, R3], left: { L: z => R2.R(z), ww: R2.ww }, right: { L: z => R3.L(z), ww: R3.ww }, xa: 115, xb: 137, za: 8, zb: 60, zc: 122, E: 2.6 }));
  // the narrow chute's mandatory air: a 4.5 m cornice step right across its 3.6 m entrance, between its walls
  F.push(new Band({ name: 'Corbet-style chute entrance', z: 12, wig: 0.25, seed: 41, a: 0.2, Rup: 6, Rdn: 14, pts: [[60.4, 0], [61.6, 4.5], [65.8, 4.5], [67.2, 0]] }));
  F.push(new Lip({ xa: 60, xb: 67.6, z: 11.2, h0: 0.55, up: 2.6, dn: 0.4, seed: 42, name: 'Cornice' }));
  // the wide chute's smaller cornice: 2.5 m, with a sneak past its east end (the goat path)
  F.push(new Band({ name: 'Wide chute cornice', z: 10, wig: 0.3, seed: 43, a: 0.25, Rup: 6, Rdn: 12, pts: [[120.6, 0], [121.6, 2.5], [128.4, 2.5], [129.6, 0]] }));
  F.push(new Lip({ xa: 120.5, xb: 129.5, z: 9.3, h0: 0.45, up: 2.4, dn: 0.4, seed: 44, name: 'Cornice' }));
  // ---- the centre, upper face
  F.push(new Band({ name: 'The Teeth', z: 68, wig: 1.5, seed: 3, a: 0.55, Rup: 13, Rdn: 16,
    pts: [[-46, 0], [-40, 2.5], [-30, 3.5], [-23, 0.2], [-15, 0.2], [-8, 3.2], [2, 4], [10, 2.6], [15, 0.2], [22, 0.2], [28, 3], [37, 3.8], [44, 0]] }));
  F.push(new Band({ name: 'Upper steps', z: 122, wig: 1, seed: 5, a: 0.55, Rup: 12, Rdn: 14, pts: [[-48, 0], [-44, 2.6], [-30, 3], [-20, 2.2], [-14, 0]] }));
  F.push(new Outcrop({ name: 'Rock kicker (upper)', x: -28, z: 34, len: 5.5, hw: 3.4, hUp: 0.15, hDn: 5.0, seed: 51 }));
  F.push(new Outcrop({ name: 'Rock drop (upper)', x: 22, z: 40, len: 6, hw: 3.2, hUp: 0.15, hDn: 3.4, seed: 52 }));
  F.push(new Outcrop({ name: 'Rock kicker (mid)', x: -2, z: 108, len: 6, hw: 4.2, hUp: 0.2, hDn: 5.6, seed: 53 }));
  F.push(new Outcrop({ name: 'Rock drop (mid)', x: 34, z: 102, len: 6, hw: 3.2, hUp: 0.15, hDn: 3.4, seed: 54 }));
  // rock islands: small drops and something to ride round on the open parts of the face
  for (const [x, z, len, hw, h, sd] of [[-44, 92, 4, 3, 2.4, 131], [42, 16, 4.5, 3.4, 2.6, 132], [-22, 262, 5, 3.6, 2.8, 133], [26, 254, 4.5, 3.2, 2.5, 134],
    [-2, 150, 4, 3, 2.2, 135], [84, 392, 5, 3.4, 3, 136], [104, 512, 4.5, 3.2, 2.6, 137], [-132, 168, 4.5, 3.2, 2.6, 138], [-118, 330, 4, 3, 2.4, 139]])
    F.push(new Outcrop({ name: 'Rock island', x, z, len, hw, hUp: 0.4, hDn: h, w: 0.9, round: 0.6, seed: sd }));
  // ---- the Spines (skier's right): five spines, wind lips on two crests
  F.push(new Spines({ za: 4, zb: 150, list: [{ x: -129, h: 5, ph: 0.4 }, { x: -112, h: 6.4, ph: 2.1 }, { x: -95, h: 6, ph: 4.0 }, { x: -78, h: 5.4, ph: 1.3 }, { x: -62, h: 3.8, ph: 3.3 }] }));
  F.push(new Lip({ xa: -117, xb: -107, z: 18, h0: 0.8, up: 3.5, dn: 0.8, seed: 61, name: 'Spine lip' }));
  F.push(new Lip({ xa: -83, xb: -73, z: 22, h0: 0.75, up: 3.5, dn: 0.8, seed: 62, name: 'Spine lip' }));
  // ---- the Ledge's convex break into the middle face: wind lips (natural kickers off the traverse)
  F.push(new Lip({ xa: -134, xb: -56, z: 186, h0: 0.9, up: 4.5, dn: 1.0, seed: 71, name: 'Ledge lip (west)' }));
  F.push(new Lip({ xa: 58, xb: 140, z: 186, h0: 0.9, up: 4.5, dn: 1.0, seed: 72, name: 'Ledge lip (east)' }));
  // ---- the centre, middle face: the Wall
  // (its west end, over the step-down, is 5 m; the middle 6.5 to 8 m)
  F.push(new Band({ name: 'Tier A', z: 206, wig: 1.4, seed: 7, a: 0.55, Rup: 15, Rdn: 24,
    pts: [[-50, 0], [-44, 5], [-24, 5], [-18, 0.3], [-10, 0.3], [-2, 6.5], [10, 8], [22, 6], [28, 0.3], [33, 0.3], [40, 7], [48, 0]] }));
  // the step-down's second 5 m drop, 14 m below the first: its ledge between is about 30 degrees, steep enough to land on
  F.push(new Band({ name: 'The step-down', z: 222, wig: 0.8, seed: 8, a: 0.3, Rup: 9, Rdn: 18, pts: [[-50, 0], [-45, 5], [-28, 5], [-23, 0]] }));
  F.push(new Band({ name: 'The Big Ones', z: 288, wig: 1.6, seed: 11, a: 0.85, Rup: 58, Rdn: 60,
    pts: [[-44, 0], [-30, 7], [-16, 10], [-6, 8], [4, 11], [12, 16], [20, 15], [28, 10], [34, 12], [41, 18], [49, 19], [58, 12], [72, 0]] }));
  // ---- below the Couloirs: rock kickers and the fan cliffs
  F.push(new Outcrop({ name: 'Rock kicker (fan)', x: 74, z: 214, len: 5.5, hw: 3.4, hUp: 0.15, hDn: 5.4, seed: 81 }));
  F.push(new Outcrop({ name: 'Rock drop (fan)', x: 114, z: 226, len: 7, hw: 4, hUp: 0.2, hDn: 4.0, seed: 82 }));
  F.push(new Band({ name: 'Fan cliffs', z: 268, wig: 1.8, seed: 13, a: 0.6, Rup: 18, Rdn: 24,
    pts: [[58, 0], [64, 5], [76, 7], [84, 1], [90, 1], [98, 6], [106, 8], [112, 7.5], [120, 1], [125, 1], [131, 5], [138, 0]] }));
  // ---- the Selection zone (skier's right): rock bands with kickers built on them (freeride.js), lips and outcrops
  F.push(new Band({ name: 'Selection rock 1', z: 238, wig: 0.4, seed: 91, a: 0.85, Rup: 22, Rdn: 22, pts: [[-122, 0], [-115, 3.2], [-89, 3.2], [-82, 0]] }));
  F.push(new Band({ name: 'Selection rock 2', z: 284, wig: 0.4, seed: 92, a: 0.85, Rup: 22, Rdn: 22, pts: [[-90, 0], [-83, 3.2], [-59, 3.2], [-52, 0]] }));
  F.push(new Outcrop({ name: 'Rock kicker (west)', x: -128, z: 266, len: 5.5, hw: 3.4, hUp: 0.15, hDn: 5.4, seed: 93 }));
  // ---- lower face: the pillow field (centre)
  F.push(new Pillows({ list: pillows() }));
  // the Selection zone, lower: lane A (x about -107): a rock band carrying a kicker, the stumps; lane B (x about -73): the
  // rock slab (freeride.js), the log ledge; both then the Great Wall's kickers. Boulders before the finish.
  F.push(new Band({ name: 'Selection rock 3', z: 394, wig: 0.4, seed: 101, a: 0.85, Rup: 22, Rdn: 22, pts: [[-126, 0], [-118, 3.4], [-96, 3.4], [-88, 0]] }));
  F.push(new Band({ name: 'Log ledge', z: 428, wig: 0.4, seed: 103, a: 0.6, Rup: 14, Rdn: 18, pts: [[-86, 0], [-81, 3], [-65, 3], [-60, 0]] }));
  F.push(new Outcrop({ name: 'Boulder', x: -126, z: 548, len: 5, hw: 3, hUp: 0.4, hDn: 2.6, w: 1.2, round: 0.8, seed: 104 }));
  F.push(new Outcrop({ name: 'Boulder', x: -86, z: 562, len: 4.5, hw: 2.6, hUp: 0.4, hDn: 2.2, w: 1.1, round: 0.8, seed: 105 }));
  F.push(new Outcrop({ name: 'Boulder', x: -58, z: 552, len: 5, hw: 3.2, hUp: 0.3, hDn: 2.8, w: 1.2, round: 0.75, seed: 106 }));
  // skier's left, lower: a small band into the trees, a rock kicker
  F.push(new Band({ name: 'Tree band', z: 428, wig: 1.6, seed: 111, a: 0.6, Rup: 14, Rdn: 18, pts: [[64, 0], [70, 3], [84, 4], [92, 0.5], [98, 0.5], [106, 3.6], [122, 4], [136, 0]] }));
  F.push(new Outcrop({ name: 'Rock kicker (lower east)', x: 124, z: 458, len: 5.5, hw: 3.4, hUp: 0.15, hDn: 5.0, seed: 112 }));
  // ---- the Great Wall: the last band across the face, kickers built on it at two places (freeride.js)
  // (its kickers' lanes at x -108, -71, -30 and 40 are 3.5 to 4.5 m; between them breaks to ride round, 5 to 5.5 m drops)
  F.push(new Band({ name: 'The Great Wall', z: 486, wig: 1.2, seed: 121, a: 0.75, Rup: 18, Rdn: 24,
    pts: [[-126, 0], [-117, 3.5], [-99, 3.5], [-92, 0.6], [-86, 0.6], [-80, 3.5], [-62, 3.5], [-55, 0.6], [-47, 0.6], [-40, 4], [-20, 4], [-12, 5], [-5, 0.6], [5, 0.6], [12, 5], [24, 5.5], [32, 4], [48, 4], [56, 5], [64, 0.6], [72, 0.6], [80, 4.5], [104, 5], [118, 0]] }));
  return F;
}
// the pillow field: stacks of pillows down the lower face's middle (x -36 to 46, z 376 to 480), a gap between stacks
function pillows() {
  const L = [];
  let s = 12345;
  const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (const cx of [-30, -18, -6, 8, 22, 36]) {
    let z = 378 + r() * 6;
    while (z < 452) {
      L.push({ x: cx + (r() - 0.5) * 5, z, r: 2.2 + r() * 1.4, h: 1.2 + r() * 1.3 });
      z += 6.5 + r() * 4;
    }
  }
  return L;
}

// ---- the land: features on a grid -------------------------------------------------------------------------------------
export class Land {
  constructor() {
    this.features = layout();
    this.rocks = this.features.filter(f => f.rock);
    const B = 16; this.B = B;
    this.cells = new Map(); this.dipCells = new Map();
    for (const f of this.features) {
      for (let i = Math.floor(f.x0 / B); i <= Math.floor(f.x1 / B); i++) for (let j = Math.floor(f.z0 / B); j <= Math.floor(f.z1 / B); j++) {
        const k = i * 8192 + j;
        if (!this.cells.has(k)) this.cells.set(k, []); this.cells.get(k).push(f);
        if (f.dip) { if (!this.dipCells.has(k)) this.dipCells.set(k, []); this.dipCells.get(k).push(f); }
      }
    }
    this.G = (x, z) => this.at(x, z);
  }
  // the ground with nothing on it but the long profile and the bowl
  base(x, z) { return baseZ(z) + lateral(x, z) + rolls(x, z) + far(x, z); }
  at(x, z) {
    let y = this.base(x, z);
    const l = this.cells.get(Math.floor(x / this.B) * 8192 + Math.floor(z / this.B));
    if (l) for (let i = 0; i < l.length; i++) y += l[i].h(x, z);
    return y;
  }
  // where the terrain's fine patches (st m a cell) must sit under the rock meshes: their visual height, or Infinity
  dipTarget(x, z, st) {
    if (st > 1.75) return Infinity;
    const l = this.dipCells.get(Math.floor(x / this.B) * 8192 + Math.floor(z / this.B)); if (!l) return Infinity;
    let t = Infinity, y = null;
    for (const f of l) { const v = f.dip(x, z, st, this.G, y ?? (y = this.at(x, z))); if (v < t) t = v; }
    return t;
  }
}
