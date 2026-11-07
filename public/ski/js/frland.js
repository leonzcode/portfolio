/* Freeride's land: the made-up big-mountain face's height and what stands on it (2026-11-06, for Leon: "create a new
   freeride mountain that has jumps and rails built off of rock cliffs and there are chutes and many other cliff drops
   like a freeride mountain venue ... and add a ski lift that goes from the bottom to the top").
   Second pass (2026-11-07, for a face that looks like a real big-mountain face rather than a grid): our own mountain,
   after what real venues have (the Freeride World Tour's faces, Natural Selection's built-in-nature courses, Corbet's
   Couloir, Alaska's spines, Japan's pillows), not a copy of any one of them:
     - the face is a bowl between two side ridges (the arms), with rocky walls and buttresses: the summit's shoulder rolls
       in over a sharp brink, the face steepest just under it and easing all the way down (concave, so a rider just over
       the brink sees the face, the arms and the finish below), its contours swinging forward towards the sides; broad
       ribs and gullies run down the fall line (rock showing on the ribs), and convex rolls here and there hide what is
       below them
     - skier's left (+x): the Couloirs, four rock ribs of uneven height, rocky on top, and three chutes between them that bend,
       narrow and widen: a mandatory air into the narrow one (a 4.5 m cornice step between its walls, a 3.1 m choke), a
       dog-leg one with a 2.3 m choke at its bend, and a wider one with a smaller cornice and a sneak beside it; the ribs
       end in 12 to 13 m cliffs over the fan
     - the centre: cliff bands that follow the rock: the Teeth (2 to 4 m, broken in three), Tier A curving down to the
       east into the Fan cliffs (5 to 8 m, with breaks and a stacked step-down at its west end), the Big Ones (9 to 19 m)
       wrapped round a buttress, the Great Wall low on the face; outcrops that are natural kickers and drops, boulders
     - skier's right (-x): spines and flutes up high, wind lips on the convex breaks, and the Selection zone: kickers
       built on rock bands (park.js Kickers whose lips sit on the rock), a log laid off a rock ledge, a rock slab, stumps
     - pillows in clusters over rock: a stacked line down a steep roll, a garden of mixed sizes, two smaller groups
   Everything is a height function over x (across, + skier's left looking down) and z (down the fall line), y up,
   with y = 0 at the main start. The physics reads it directly (terrain.js ground through setMountain); rock faces are
   steeper than skier.js's walls (about 53 degrees), so they are walls to ride into and drops to ride off.
   This module is plain JS (no three.js) so it can be checked in Node. */
import { simplex, fbm, ridged, smoothstep, clamp, smax } from './noise.js?v=19';

const RAD = Math.PI / 180;

// ---- the long profile down the face ----------------------------------------------------------------------------
/* [z, pitch in degrees], the pitch linear between them: the peak behind the summit, the summit shoulder, a roll-in of
   24 degrees, a sharp brink, then the face, 41 degrees for its first 20 m under the brink and easing all the way down
   (concave), the apron, the runout. (Most open slopes stay near 36 at most: steeper, the game's skis start to slip.) */
export const PROF = [[-1400, -16], [-520, -16], [-390, -24], [-342, 4], [-300, 34], [-185, 34], [-135, 9], [-60, 7], [-36, 9],
  [-27, 11], [-20, 24], [-13, 24], [-9, 35], [-4, 41], [14, 41], [40, 38], [110, 36], [190, 34], [280, 32.5], [370, 31], [450, 30], [530, 28], [575, 22],
  [620, 15], [670, 10], [750, 6], [900, 4], [1000, 3.5], [1400, 2]];
const PZ0 = -1400, PZ1 = 2600, PDZ = 0.5, PN = Math.round((PZ1 - PZ0) / PDZ) + 1;
const PB = new Float32Array(PN);
(function profile() {
  const P = new Float32Array(PN);
  let k = 0;
  for (let i = 0; i < PN; i++) {
    const z = PZ0 + i * PDZ;
    while (k + 1 < PROF.length && z >= PROF[k + 1][0]) k++;
    const a = PROF[k], b = PROF[Math.min(PROF.length - 1, k + 1)];
    P[i] = (b[0] > a[0] ? a[1] + (b[1] - a[1]) * clamp((z - a[0]) / (b[0] - a[0]), 0, 1) : a[1]) * RAD;
  }
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
/* The bowl in plan: the face's contours swing forward towards its sides by zs(x), so at the same z the sides stand
   higher than the middle (the rim a horseshoe), up to 16 m forward at 150 m out (and no more past it: the chairlift's
   top station stands on the summit's shoulder out there). Past 150 m the arms: side ridges that
   rise A(z) over the bowl's edge on steep rocky walls, with crests from 195 m out (the chairlift runs up the east one)
   and their outer sides falling away; low on the face they sink into the valley. */
export const LIFT_X = 208;
const zs = x => { const a = Math.min(150, Math.abs(x)); return 0.0007 * a * a; };
/* (each arm's wall foot, crest and height along the face tabulated every metre of z: a few noises a sample before) */
const AZ0 = -600, AN = 2200, ARM = [0, 1].map(e => {
  const foot = new Float32Array(AN), crest = new Float32Array(AN), A = new Float32Array(AN);
  for (let i = 0; i < AN; i++) {
    const z = AZ0 + i;
    foot[i] = 146 + 11 * Math.sin(z * 0.013 + (e ? 0.7 : 2.9)) + 6 * simplex(z * 0.025, e ? 3.3 : -3.3);
    crest[i] = e ? 202 : foot[i] + 58 + 12 * Math.sin(z * 0.009 + 1.3) + 6 * simplex(z * 0.02 + 7, 1.1);
    A[i] = (e ? 28 : 34) * (1 + 0.18 * simplex(z * 0.011, e ? 5 : -5)) * smoothstep(-70, 60, z) * (1 - smoothstep(470, 720, z)) + (e ? 8 : 14) * (1 - smoothstep(-40, 60, z));
  }
  return { foot, crest, A };
});
function arms(x, z) {
  const a = Math.abs(x);
  if (a < 128) return 0;
  /* the inner wall's foot wanders in and out along the face (bays and spurs); the east arm's crest stays at 200 to 216
     m out all the way down (the chairlift runs up it), the west one wanders too. Their height along the face: low at
     the summit ridge's ends, highest over the middle of the face, gone by the apron */
  const T = ARM[x > 0 ? 1 : 0], q = clamp(z - AZ0, 0, AN - 1.001), i = q | 0, t = q - i;
  const foot = T.foot[i] + (T.foot[i + 1] - T.foot[i]) * t;
  if (a < foot - 1) return 0;
  const crest = T.crest[i] + (T.crest[i + 1] - T.crest[i]) * t, A = T.A[i] + (T.A[i + 1] - T.A[i]) * t;
  const u = clamp((a - foot) / (crest - foot), 0, 1), up = u * u * (2.2 - 1.2 * u);       // (concave at its foot, rounding over at the top)
  const out = a > crest + 14 ? 0.3 * (a - crest - 14) * smoothstep(crest + 14, crest + 50, a) : 0;    // over the crest, falling away outside
  return A * up - out + 1.8 * simplex(x * 0.03 + 9, z * 0.02) * smoothstep(foot, foot + 25, a);
}
// the runout: the valley's floor swings east to the chairlift's bottom station
function runout(x, z) {
  const k = smoothstep(620, 820, z);
  return k > 0 ? k * (-0.06 * Math.max(0, x - 60) * smoothstep(700, 900, z) + 0.0004 * Math.min(Math.abs(x - 80), 220) ** 2 * 0.25) : 0;
}
// the far mountains: grow from about 300 m out of the venue
function far(x, z) {
  const dx = Math.max(0, Math.abs(x - 20) - 280), dz = Math.max(0, -500 - z, z - 1150), d = Math.hypot(dx, dz);
  if (d < 1) return 0;
  const k = smoothstep(0, 700, d);
  return k * (280 * ridged(x * 0.0011 + 7.7, z * 0.0011 - 2.3, 4) - 60);
}
/* Ribs and gullies down the fall line: broad, wandering, a few metres high (each its cross-section a cosine bump,
   half width w; its middle wanders down the face). The couloirs' gullies run on down the face as avalanche paths. */
const FALL = [
  { x: -8, a: 5.5, w: 36, z0: 30, z1: 340, ph: 0.3 },      // the centre spur the Teeth and Tier A cross
  { x: 38, a: -5.0, w: 24, z0: 110, z1: 560, ph: 1.9 },    // the gully east of it, down from the Big Ones' buttress
  { x: -50, a: -4.4, w: 22, z0: 60, z1: 480, ph: 3.1 },    // the gully between the spines and the centre
  { x: -100, a: 4.6, w: 30, z0: 150, z1: 480, ph: 4.4 },   // the Selection spur
  { x: 96, a: -5.6, w: 28, z0: 140, z1: 600, ph: 5.2 },    // the couloirs' fan and its avalanche path
  { x: 132, a: 4.2, w: 20, z0: 150, z1: 520, ph: 2.6 },    // a rib by the east wall
  { x: -142, a: -3.6, w: 18, z0: 120, z1: 520, ph: 0.9 },  // a gully along the west wall's foot
  { x: 62, a: 3.4, w: 18, z0: 330, z1: 560, ph: 6.0 },     // a low rib under the Fan cliffs
  { x: -10, a: -3.2, w: 26, z0: 360, z1: 600, ph: 1.4 },   // the lower centre gully, out to the apron
];
/* the lanes of the kickers built on the rock and of the logs (freeride.js puts them there): across each the fall lines are levelled to
   their height on its middle line (blended back over 8 to 24 m out), so each kicker stands square on its slope with no
   trench or bank beside it */
export const LANES = [[-102, 180, 290], [-71, 236, 330], [-107, 340, 440], [-108, 440, 530], [-71, 392, 530], [-30, 440, 530], [40, 440, 530],
  // (and the logs: each lies square on its slope too)
  [106, 238, 276], [62, 466, 502], [77, 434, 468], [112, 402, 438]];
/* (each fall line's middle and its fade in and out along the face tabulated every 0.5 m of z, and each lane's level
   too: they were most of the land's cost, a sine and a noise for each fall line at every sample) */
const FZ = 0.5;
/* (kept in flat typed arrays, not on the FALL objects: read through their properties, V8 kept throwing away and
   rebuilding the compiled fallRaw, and it cost ten times what it should) */
const FN = FALL.length, FX = new Float64Array(FN), FW = new Float64Array(FN), FA = new Float64Array(FN), FZA = new Float64Array(FN), FZB = new Float64Array(FN), FO = new Int32Array(FN + 1);
FALL.forEach((f, k) => { FX[k] = f.x; FW[k] = f.w; FA[k] = f.a; FZA[k] = f.z0 - 40; FZB[k] = f.z1 + 60; FO[k + 1] = FO[k] + Math.ceil((FZB[k] - FZA[k]) / FZ) + 2; });
const FTC = new Float32Array(FO[FN]), FTE = new Float32Array(FO[FN]);
FALL.forEach((f, k) => {
  for (let i = 0, n = FO[k + 1] - FO[k]; i < n; i++) {
    const z = FZA[k] + i * FZ;
    FTC[FO[k] + i] = f.x + 7 * Math.sin(z * 0.011 + f.ph) + 3 * simplex(z * 0.02, f.ph * 5);
    FTE[FO[k] + i] = smoothstep(f.z0 - 40, f.z0 + 40, z) * (1 - smoothstep(f.z1 - 40, f.z1 + 60, z));
  }
});
function fallRaw(x, z) {
  let y = 0;
  for (let k = 0; k < FN; k++) {
    if (z <= FZA[k] || z >= FZB[k] || Math.abs(x - FX[k]) > FW[k] + 11) continue;
    const q = (z - FZA[k]) / FZ, i = q | 0, t = q - i, o = FO[k] + i, e = FTE[o] + (FTE[o + 1] - FTE[o]) * t;
    if (e <= 0) continue;
    const u = (x - (FTC[o] + (FTC[o + 1] - FTC[o]) * t)) / FW[k];
    if (u <= -1 || u >= 1) continue;
    const v = 1 - u * u; y += FA[k] * v * v * e;           // (a smooth bump, (1 - u^2)^2: the cosine's shape without its cost)
  }
  return y;
}
const LT = LANES.map(([lx, z0, z1]) => { const zA = z0 - 24, n = Math.ceil((z1 + 24 - zA) / FZ) + 2, t = new Float32Array(n); for (let i = 0; i < n; i++) t[i] = fallRaw(lx, zA + i * FZ); return { lx, z0, z1, zA, t }; });
export function fallLines(x, z) {
  let y = fallRaw(x, z);
  for (let k = 0; k < LT.length; k++) {
    const L = LT[k];
    if (z < L.z0 - 24 || z > L.z1 + 24) continue;
    const d = Math.abs(x - L.lx); if (d > 24) continue;
    const w = (1 - smoothstep(8, 24, d)) * smoothstep(L.z0 - 24, L.z0, z) * (1 - smoothstep(L.z1, L.z1 + 24, z));
    if (w > 0) { const q = (z - L.zA) / FZ, i = q | 0, tt = q - i; y += (L.t[i] + (L.t[i + 1] - L.t[i]) * tt - y) * w; }
  }
  return y;
}
// how much of a rib's crest a point is on (0 to 1): wind strips the snow off the ribs, rock shows there
function fallCrest(x, z) {
  let c = 0;
  for (let k = 0; k < FN; k++) {
    const f = FALL[k];
    if (FA[k] < 0 || z <= FZA[k] || z >= FZB[k]) continue;
    const q = (z - FZA[k]) / FZ, i = q | 0, t = q - i, o = FO[k] + i, m = FTC[o] + (FTC[o + 1] - FTC[o]) * t, u = (x - m) / (FW[k] * 0.55);
    if (u <= -1 || u >= 1) continue;
    c = Math.max(c, (1 - u * u) * smoothstep(f.z0 - 20, f.z0 + 40, z) * (1 - smoothstep(f.z1 - 60, f.z1, z)));
  }
  return c;
}
// the small rolls of a natural face (a metre or so, 40 to 90 m across): none on the start pads, the finish, the lift
function rolls(x, z) {
  const k = smoothstep(-10, 30, z) * (1 - smoothstep(560, 660, z)) * (1 - smoothstep(170, 190, Math.abs(x)));
  return k > 0 ? (0.8 * simplex(x * 0.013 + 3.1, z * 0.011 - 1.7) + 0.45 * simplex(x * 0.036 - 4, z * 0.03)) * k : 0;
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
/* a smooth curve through [[u, v], ...] (u ascending) that never overshoots its points (monotone cubic, Fritsch and
   Carlson): flat stretches stay flat (a kicker's spot on a band), and between them it curves */
function mono(pts) {
  const n = pts.length, X = pts.map(p => p[0]), Y = pts.map(p => p[1]), d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((Y[i + 1] - Y[i]) / (X[i + 1] - X[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return u => {
    if (u <= X[0]) return Y[0];
    if (u >= X[n - 1]) return Y[n - 1];
    let i = 0; while (X[i + 1] < u) i++;
    const h = X[i + 1] - X[i], t = (u - X[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * Y[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * Y[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
const wig = (u, seed, a) => a * (simplex(u * 0.05, seed * 7.31) + 0.4 * simplex(u * 0.19, seed * 3.7 + 5.1));
// the terrain's visual height held down towards target by w (0 to 1): faded in with a face's height, so where a rock
// curtain ends (at a face of 0.4 m) the terrain is back at its own height and never steps
const fade = (y, target, w) => w >= 1 ? target : target >= y ? Infinity : y - (y - target) * w;
// a rock face's width (horizontal) for a drop of H: about 75 to 80 degrees
export const faceW = H => 0.5 + 0.15 * H;

/* A cliff band: its lip a curve across the fall line (z(x) through points, `lip`, or a straight `z`, plus a wiggle),
   its face looking down the hill, at right angles to the lip (so a band slanting down across the face, or bulging
   round a buttress, keeps its face as steep). H(x) from points [[x, H], ...] (0 at both ends; 0 between is a break),
   roughened along the band by `rough` (a share of H). The drop is shared: the snow above is raised by a x H, tapering
   back over Rup (a bench that is gentlest at the lip), the apron below lowered by (1 - a) x H, recovering over Rdn
   (steepest at its foot). With rock: false and a wide `fw` it is a convex roll of snow, not a cliff. Tabulated along x
   every 0.25 m (the lip, its slope, H), so it costs a lookup. */
export class Band {
  constructor(o) {
    Object.assign(this, { kind: 'band', a: 0.6, Rup: 16, Rdn: 24, wig: 1.2, seed: 1, rough: 0, name: 'Cliff band', rock: true, fw: 0 }, o);
    this.xa = this.pts[0][0]; this.xb = this.pts[this.pts.length - 1][0];
    const Hs = mono(this.pts), Zs = this.lip ? mono(this.lip) : null;
    const S = 0.25, n = Math.ceil((this.xb - this.xa) / S) + 3;
    this.tS = S; this.tX = this.xa - S; this.tZ = new Float32Array(n); this.tH = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = this.tX + i * S;
      this.tZ[i] = (Zs ? Zs(x) : this.z) + wig(x, this.seed, this.wig);
      const r = this.rough ? 1 + this.rough * (simplex(x * 0.11, this.seed * 2.3) * 0.7 + 0.3 * simplex(x * 0.37, this.seed + 8)) : 1;
      this.tH[i] = x <= this.xa || x >= this.xb ? 0 : Math.max(0, Hs(x) * r);
    }
    this.tC = new Float32Array(n);      // 1 / sqrt(1 + z'(x)^2): z distance to distance at right angles
    for (let i = 0; i < n; i++) { const a = this.tZ[Math.max(0, i - 1)], b = this.tZ[Math.min(n - 1, i + 1)], dz = (b - a) / (S * (i > 0 && i < n - 1 ? 2 : 1)); this.tC[i] = 1 / Math.sqrt(1 + dz * dz); }
    this.Hmax = Math.max(...this.tH);
    this.x0 = this.xa; this.x1 = this.xb;
    let zmin = Infinity, zmax = -Infinity; for (const z of this.tZ) { zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); }
    this.z0 = zmin - this.Rup * 1.6 - 1; this.z1 = zmax + (this.fwOf(this.Hmax) + this.Rdn) * 1.6 + 1;
    // (where its dip can apply: from 2.5 m above the lip to just past the foot, along its whole length)
    let cmin = 1; for (const c of this.tC) cmin = Math.min(cmin, c);
    this.dipBox = [this.xa, this.xb, zmin - 2.5 / cmin - 1, zmax + (this.fwOf(this.Hmax) + 0.5) / cmin + 1];
  }
  fwOf(H) { return this.fw || faceW(H); }
  // (a table read: the index and the fraction, no array made for them, these are asked for at every sample)
  _lerp(T, x) { const f = (x - this.tX) / this.tS, i = Math.max(0, Math.min(T.length - 2, Math.floor(f))), t = f - i; return T[i] + (T[i + 1] - T[i]) * t; }
  H(x) { return x <= this.xa || x >= this.xb ? 0 : this._lerp(this.tH, x); }
  zL(x) { return this._lerp(this.tZ, x); }
  cs(x) { return this._lerp(this.tC, x); }
  // the way out from the lip at x, at right angles to it (on the ground: x, z)
  out(x) { const e = 0.3, dz = (this.zL(x + e) - this.zL(x - e)) / (2 * e), l = Math.hypot(dz, 1); return [-dz / l, 1 / l]; }
  h(x, z) {
    if (x <= this.xa || x >= this.xb) return 0;
    const f = (x - this.tX) / this.tS, i = Math.max(0, Math.min(this.tH.length - 2, Math.floor(f))), t = f - i;
    const H = this.tH[i] + (this.tH[i + 1] - this.tH[i]) * t; if (H < 0.02) return 0;
    const zl = this.tZ[i] + (this.tZ[i + 1] - this.tZ[i]) * t, c = this.tC[i] + (this.tC[i + 1] - this.tC[i]) * t;
    const d = (z - zl) * c, w = this.fwOf(H);
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
    if (!this.rock || x <= this.xa || x >= this.xb) return Infinity;
    const H = this.H(x); if (H < 0.45) return Infinity;
    const zl = this.zL(x), c = this.cs(x), d = (z - zl) * c, w = this.fwOf(H);
    if (d < -(st + 0.3) || d > w + 0.3) return Infinity;
    return fade(y, G(x, zl + (w + 0.35) / c) - 0.5, smoothstep(0.45, 1.3, H));
  }
}

/* A rock rib: a ridge of rock raised D(z) between two edges xl(z) and xr(z) (points [[z, x], ...]), its walls
   falling outward over ww m; its top a crest of broken rock (highest along its middle, lumpy), its height along it
   from Dpts if given; it grows out of the slope from zTop over grow m (no wall there) and ends in a cliff at zEnd
   (wiggling). Chutes are the gaps between ribs. */
export class Rib {
  constructor(o) {
    Object.assign(this, { kind: 'rib', D: 12, ww: 2, grow: 18, wEnd: 2.2, seed: 2, crest: 0.1, name: 'Rock rib', rock: true }, o);
    // (each side's wall its own width: a chute's wall steep, an outer side a rocky slope down to the face)
    this.wwL = this.wwL || this.ww; this.wwR = this.wwR || this.ww;
    const xs = [...this.xl.map(p => p[1]), ...this.xr.map(p => p[1])];
    this.x0 = Math.min(...xs) - this.wwL - 4; this.x1 = Math.max(...xs) + this.wwR + 4;
    this.z0 = this.zTop - 1; this.z1 = this.zEnd + 3 + this.wEnd + 2;
    this.Dp = this.Dpts ? mono(this.Dpts) : null;
  }
  L(z) { return pl(this.xl, z) + wig(z, this.seed, this.wigL || 0.9); }
  R(z) { return pl(this.xr, z) + wig(z, this.seed + 11, this.wigR || 0.9); }
  zE(x) { return this.zEnd + wig(x, this.seed + 3, 1.6); }
  Dz(z) { return (this.Dp ? this.Dp(z) : this.D) * smoothstep(this.zTop, this.zTop + this.grow, z) * (1 + 0.16 * simplex(z * 0.045, this.seed * 1.7)); }
  h(x, z) {
    if (z < this.zTop || x < this.x0 || x > this.x1) return 0;
    const ze = this.zE(x); if (z > ze + this.wEnd * 1.2) return 0;
    const D = this.Dz(z); if (D < 0.01) return 0;
    const l = this.L(z), r = this.R(z);
    const mx = (1 - face(l - x, this.wwL, this.wwL > 4 ? 0.3 : 0.16)) * (1 - face(x - r, this.wwR, this.wwR > 4 ? 0.3 : 0.16));
    if (mx <= 0) return 0;
    // (the top: a crest along the middle, a little lower at the walls' tops, with blocks of rock on it)
    const hw = Math.max(1, (r - l) / 2), u = clamp((x - (l + r) / 2) / hw, -1, 1);
    const top = 1 - this.crest * u * u + 0.025 * simplex(x * 0.21 + this.seed, z * 0.17) + 0.012 * simplex(x * 0.6, z * 0.5 - this.seed);
    return D * mx * top * (1 - face(z - ze, this.wEnd));
  }
  dip(x, z, st, G, y) {
    if (z < this.zTop + 2 || x < this.x0 || x > this.x1) return Infinity;
    const D = this.Dz(z); if (D < 0.55) return Infinity;
    const l = this.L(z), r = this.R(z), wl = this.wwL, wr = this.wwR, ze = this.zE(x), m = st + 0.3;
    let t = Infinity;
    // the side walls (x inside the top edge by up to m, or on the wall), unless the bottom cliff is there instead
    // (a side as gentle as an outer slope is drawn by the terrain itself: no dip)
    if (z < ze + 0.3) {
      if (wl <= 4 && x > l - wl - 0.3 && x < l + m) t = Math.min(t, G(l - wl - 0.35, z) - 0.5);
      if (wr <= 4 && x < r + wr + 0.3 && x > r - m) t = Math.min(t, G(r + wr + 0.35, z) - 0.5);
    }
    // the bottom cliff
    if (x > l - wl && x < r + wr && z > ze - m && z < ze + this.wEnd + 0.3) t = Math.min(t, G(x, ze + this.wEnd + 0.35) - 0.5);
    return t === Infinity ? t : fade(y, t, smoothstep(0.55, 1.6, D));
  }
}

/* A rock outcrop on the slope: a block whose top is raised from hUp at its uphill end to hDn at its downhill lip (more
   than the slope falls, and it kicks: a natural kicker; less, and it is a rock drop), its sides and lip rock faces of
   w m. x, z: its middle; len along the fall line, hw half across; turned by rot (radians, its outline only); its
   outline roughened by wob metres (a boulder, not a box). */
export class Outcrop {
  constructor(o) {
    Object.assign(this, { kind: 'out', hUp: 0.2, w: 1.0, round: 0.45, seed: 3, rot: 0, wob: 0, name: 'Rock outcrop', rock: true }, o);
    this.za = this.z - this.len / 2; this.zb = this.z + this.len / 2;
    this.cr = Math.cos(this.rot); this.sr = Math.sin(this.rot);
    const R = Math.hypot(this.hw, this.len / 2) + this.wob + this.w + 1;
    this.x0 = this.x - R; this.x1 = this.x + R; this.z0 = this.z - R; this.z1 = this.z + R;
  }
  // signed distance outside the footprint (a rounded rectangle, turned and roughened; - inside), in metres
  out(x, z) {
    const ex = x - this.x, ez = z - this.z, px = ex * this.cr - ez * this.sr, pz = ex * this.sr + ez * this.cr;
    const r = Math.min(this.hw, this.len / 2) * this.round;
    const qx = Math.abs(px) - (this.hw - r), qz = Math.abs(pz) - (this.len / 2 - r);
    let d = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
    if (d > this.wob + this.w * 1.3 + 2) return d - this.wob;          // (far outside: the roughening cannot reach)
    if (this.wob) { const k = 1.1 / Math.min(this.hw, this.len / 2); d -= this.wob * (0.7 * simplex(px * k + this.seed, pz * k) + 0.3 * simplex(px * k * 2.3, pz * k * 2.3 - this.seed)); }
    return d;
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
      // (each its own length: they start and end at their own places down the face)
      const za = s.za ?? this.za, zb = s.zb ?? this.zb;
      const hz = s.h * smoothstep(za, za + 26, z) * (1 - smoothstep(zb - 30, zb, z));
      if (hz <= 0) continue;
      const d = x - this.cx(s, z), dd = Math.sqrt(d * d + this.crest * this.crest) - this.crest;
      const v = hz - this.cross * dd;
      if (v > a) { b = a; a = v; } else if (v > b) b = v;
    }
    // (the flute between two spines rounded, and the field never under the slope)
    return Math.max(0, smax(smax(a, b, 1.6), 0, 1.0) - 0.4) ;
  }
}

/* pillows: domes of snow over boulders, 3 to 8 m across and 0.8 to 2.8 m high, steeper on their downhill side, so a
   line of them is a staircase of small drops; a little oval and turned each, so a cluster is never a pattern */
export class Pillows {
  constructor(o) {
    Object.assign(this, { kind: 'pillows', rock: false, name: 'Pillows' }, o);
    for (const p of this.list) { p.e = p.e || 1; p.c = Math.cos(p.a || 0); p.s = Math.sin(p.a || 0); }
    this.x0 = Math.min(...this.list.map(p => p.x - p.r * p.e)) - 1; this.x1 = Math.max(...this.list.map(p => p.x + p.r * p.e)) + 1;
    this.z0 = Math.min(...this.list.map(p => p.z - p.r * p.e)) - 1; this.z1 = Math.max(...this.list.map(p => p.z + p.r * p.e)) + 1;
    // a grid of them by 8 m cells
    this.grid = new Map();
    for (const p of this.list) { const R = p.r * p.e; for (let i = Math.floor((p.x - R) / 8); i <= Math.floor((p.x + R) / 8); i++) for (let j = Math.floor((p.z - R) / 8); j <= Math.floor((p.z + R) / 8); j++) {
      const k = i * 4096 + j; if (!this.grid.has(k)) this.grid.set(k, []); this.grid.get(k).push(p);
    } }
  }
  h(x, z) {
    const l = this.grid.get(Math.floor(x / 8) * 4096 + Math.floor(z / 8)); if (!l) return 0;
    let best = 0;
    for (const p of l) {
      const ex = x - p.x, ez = z - p.z, u = (ex * p.c - ez * p.s) / p.e, w = ex * p.s + ez * p.c;
      const dx = u / p.r, dz = w / (w > 0 ? p.r * 0.58 : p.r);
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
    Object.assign(this, { kind: 'lip', rock: false, up: 4, dn: 0.9, seed: 4, name: 'Wind lip', slant: 0 }, o);
    this.x0 = this.xa; this.x1 = this.xb;
    const zr = Math.abs(this.slant) * (this.xb - this.xa);
    this.z0 = this.z - this.up - 3 - zr; this.z1 = this.z + this.dn + 3 + zr;
  }
  zAt(x) { return this.z + wig(x, this.seed, 1.2) + this.slant * (x - (this.xa + this.xb) / 2); }
  h(x, z) {
    if (x <= this.xa || x >= this.xb) return 0;
    const e = smoothstep(this.xa, this.xa + 4, x) * (1 - smoothstep(this.xb - 4, this.xb, x));
    const d = z - this.zAt(x), hh = this.h0 * e * (0.8 + 0.2 * simplex(x * 0.15, this.seed));
    if (d < -this.up || d > this.dn) return 0;
    return d <= 0 ? hh * smoothstep(-this.up, 0, d) * (0.3 + 0.7 * smoothstep(-this.up, 0, d)) : hh * (1 - face(d, this.dn, 0.3));
  }
}

// ---- the layout -----------------------------------------------------------------------------------------------------
// (all in one place; the names are what the start menu and the report call them)
let R = null;
function layout() {
  R = (s => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; })(20261107);   // (the same every time)
  const F = [];
  // a wind lip just under the brink west of the centre line, over the west summit cliffs (a cornice to air off)
  F.push(new Lip({ xa: -66, xb: -26, z: -3, h0: 0.7, up: 4, dn: 0.9, seed: 21, slant: 0.12, name: 'Summit lip' }));

  // ---- the Couloirs (skier's left): four rock ribs, rocky on top, three chutes; the block's outer sides rocky slopes
  // (the ribs' walls 9 to 18 m along their length, their edges bending: the chutes narrow and widen as they go)
  const R0 = new Rib({ name: 'West rib', wigL: 3.4, wigR: 1.1, wwL: 11, xl: [[-20, 45], [10, 47], [40, 47], [62, 43], [88, 39], [110, 41]], xr: [[-20, 60], [28, 60], [40, 59], [70, 60.5], [130, 59]],
    zTop: -4, grow: 20, D: 12, Dpts: [[-4, 9], [30, 13], [60, 10], [90, 14], [108, 12]], zEnd: 108, seed: 31, crest: 0.12 });
  const R1 = new Rib({ name: 'Middle rib', wigL: 1.0, wigR: 1.0, xl: [[-20, 67.6], [28, 67.6], [42, 72], [75, 71], [130, 72.5]], xr: [[-20, 84], [48, 84], [62, 92], [70, 97.5], [130, 97.5]],
    zTop: 0, grow: 18, D: 13, Dpts: [[0, 10], [25, 15], [55, 12], [85, 16], [124, 13]], zEnd: 124, seed: 32, crest: 0.1 });
  const R2 = new Rib({ name: 'East rib', wigL: 1.0, wigR: 1.5, xl: [[-20, 96], [48, 96], [60, 101], [70, 105], [85, 105], [100, 109.5], [130, 109.5]], xr: [[-20, 119], [20, 116], [45, 118.5], [70, 122], [95, 119], [130, 121]],
    zTop: 4, grow: 18, D: 13, Dpts: [[4, 11], [35, 16], [70, 12], [100, 15], [118, 13]], zEnd: 118, seed: 33, crest: 0.12 });
  const R3 = new Rib({ name: 'Outer rib', wigL: 0.9, wigR: 3.4, wwR: 11, xl: [[-20, 133], [16, 133], [40, 131.5], [62, 135], [85, 133], [130, 136]], xr: [[-20, 146], [20, 150], [50, 147], [80, 153], [102, 149]],
    zTop: -2, grow: 18, D: 12, Dpts: [[-2, 8], [40, 14], [80, 10], [102, 12]], zEnd: 102, seed: 34, crest: 0.1 });
  F.push(R0, R1, R2, R3);
  // the chutes' floors: steeper than the slope through their chokes
  F.push(new Gully({ name: 'Corbet-style chute', ribs: [R0, R1], left: { L: z => R0.R(z), ww: R0.ww }, right: { L: z => R1.L(z), ww: R1.ww }, xa: 56, xb: 76, za: 14, zb: 55, zc: 125, E: 3.5 }));
  F.push(new Gully({ name: 'Dog-leg chute', ribs: [R1, R2], left: { L: z => R1.R(z), ww: R1.ww }, right: { L: z => R2.L(z), ww: R2.ww }, xa: 80, xb: 113, za: 10, zb: 78, zc: 128, E: 4.2 }));
  F.push(new Gully({ name: 'Wide chute', ribs: [R2, R3], left: { L: z => R2.R(z), ww: R2.ww }, right: { L: z => R3.L(z), ww: R3.ww }, xa: 115, xb: 137, za: 8, zb: 60, zc: 122, E: 2.6 }));
  // the narrow chute's mandatory air: a 4.5 m cornice step right across its entrance, between its walls
  F.push(new Band({ name: 'Corbet-style chute entrance', z: 12, wig: 0.25, seed: 41, a: 0.2, Rup: 6, Rdn: 14, pts: [[60.4, 0], [61.6, 4.5], [65.8, 4.5], [67.2, 0]] }));
  F.push(new Lip({ xa: 60, xb: 67.6, z: 11.2, h0: 0.55, up: 2.6, dn: 0.4, seed: 42, name: 'Cornice' }));
  // the wide chute's smaller cornice: 2.5 m, with a sneak past its east end (the goat path)
  F.push(new Band({ name: 'Wide chute cornice', z: 10, wig: 0.3, seed: 43, a: 0.25, Rup: 6, Rdn: 12, pts: [[120.6, 0], [121.6, 2.5], [128.4, 2.5], [129.6, 0]] }));
  F.push(new Lip({ xa: 120.5, xb: 129.5, z: 9.3, h0: 0.45, up: 2.4, dn: 0.4, seed: 44, name: 'Cornice' }));
  // a rock buttress between the couloirs and the centre: the West rib's shoulder breaking out over the face
  F.push(new Outcrop({ name: 'Couloir buttress', x: 40, z: 64, len: 16, hw: 5, hUp: 1.5, hDn: 7, w: 1.6, round: 0.5, rot: 0.25, wob: 1.2, seed: 141 }));

  // ---- the summit cliffs: a broken band just under the brink either side of the centre line (the centre line itself, x
  // -12 to 12, rolls straight in), a cornice of a wind lip over its west part
  F.push(new Band({ name: 'Summit cliffs (west)', lip: [[-74, 14], [-56, 9], [-36, 7], [-14, 9]], wig: 1.2, seed: 15, a: 0.5, Rup: 9, Rdn: 20, rough: 0.2,
    pts: [[-76, 0], [-68, 4], [-58, 6.5], [-48, 3], [-42, 3.5], [-30, 7.5], [-20, 5], [-13, 0]] }));
  F.push(new Band({ name: 'Summit cliffs (east)', lip: [[13, 9], [26, 8], [40, 12]], wig: 1, seed: 16, a: 0.5, Rup: 9, Rdn: 20, rough: 0.2, pts: [[13, 0], [19, 4.5], [30, 6], [37, 3], [42, 0]] }));
  // ---- the bowl's walls: buttresses of rock standing out of them, unridden (they frame the face)
  for (const [x, z, len, hw, h, rot, sd] of [[-168, 70, 46, 9, 12, 0.32, 161], [-176, 190, 60, 10, 16, 0.18, 162], [-170, 320, 44, 8, 11, 0.12, 163], [-160, 430, 30, 7, 7, 0.05, 164],
    [162, 110, 40, 8, 10, -0.3, 165], [170, 260, 52, 9, 13, -0.2, 166], [160, 380, 34, 7, 8, -0.1, 167]])
    F.push(new Outcrop({ name: 'Wall buttress', x, z, len, hw, hUp: h, hDn: h * 0.8, w: 1.6, round: 0.4, rot, wob: hw * 0.28, seed: sd }));
  // ---- the centre, upper face: the Teeth, broken in three, curving down to the east
  F.push(new Band({ name: 'The Teeth', lip: [[-48, 66], [-20, 63], [8, 66], [30, 69], [46, 74]], wig: 1.3, seed: 3, a: 0.55, Rup: 13, Rdn: 16, rough: 0.25,
    pts: [[-46, 0], [-40, 2.5], [-30, 3.5], [-24, 0.2], [-15, 0.2], [-8, 3.2], [2, 4], [10, 2.6], [16, 0.2], [22, 0.2], [28, 3], [37, 3.8], [44, 0]] }));
  // the Upper steps: a short band stepping down from the Teeth's west end
  F.push(new Band({ name: 'Upper steps', lip: [[-50, 118], [-30, 120], [-12, 124]], wig: 0.9, seed: 5, a: 0.55, Rup: 12, Rdn: 14, rough: 0.2, pts: [[-50, 0], [-45, 2.6], [-32, 3], [-20, 2.2], [-12, 0]] }));
  F.push(new Outcrop({ name: 'Rock kicker (upper)', x: -28, z: 34, len: 5.5, hw: 3.4, hUp: 0.15, hDn: 5.0, rot: -0.12, wob: 0.4, seed: 51 }));
  F.push(new Outcrop({ name: 'Rock drop (upper)', x: 22, z: 40, len: 6, hw: 3.2, hUp: 0.15, hDn: 3.4, rot: 0.18, wob: 0.5, seed: 52 }));
  F.push(new Outcrop({ name: 'Rock kicker (mid)', x: -2, z: 106, len: 6, hw: 4.2, hUp: 0.2, hDn: 5.6, rot: 0.08, wob: 0.4, seed: 53 }));
  F.push(new Outcrop({ name: 'Rock drop (mid)', x: 30, z: 104, len: 6, hw: 3.2, hUp: 0.15, hDn: 3.4, rot: -0.2, wob: 0.6, seed: 54 }));
  // a convex roll across the centre-west, under the Upper steps (it hides Tier A's west end from above)
  F.push(new Band({ name: 'The roll', lip: [[-62, 160], [-30, 166], [-4, 174]], wig: 2, seed: 61, a: 0.45, Rup: 22, Rdn: 30, rock: false, fw: 20, pts: [[-74, 0], [-56, 3.5], [-24, 4], [4, 0]] }));

  // ---- the Spines (skier's right): five spines of their own lengths, wind lips on two crests
  F.push(new Spines({ za: 0, zb: 168, list: [{ x: -126, h: 4.6, ph: 0.4, za: 8, zb: 132 }, { x: -110, h: 6.4, ph: 2.1 }, { x: -93, h: 6, ph: 4.0, zb: 158 },
    { x: -77, h: 5.4, ph: 1.3, za: 4, zb: 140 }, { x: -62, h: 3.6, ph: 3.3, za: 18, zb: 112 }] }));
  F.push(new Lip({ xa: -115, xb: -105, z: 18, h0: 0.8, up: 3.5, dn: 0.8, seed: 61, name: 'Spine lip' }));
  F.push(new Lip({ xa: -82, xb: -72, z: 22, h0: 0.75, up: 3.5, dn: 0.8, seed: 62, name: 'Spine lip' }));
  // the convex break below the spines and above the Selection zone: wind lips (natural kickers), slanting with the face
  F.push(new Lip({ xa: -146, xb: -116, z: 188, h0: 0.9, up: 4.5, dn: 1.0, seed: 71, slant: -0.09, name: 'Spine lip (lower)' }));
  F.push(new Lip({ xa: -90, xb: -58, z: 186, h0: 0.8, up: 4.5, dn: 1.0, seed: 73, slant: -0.06, name: 'Spine lip (lower)' }));
  F.push(new Lip({ xa: 56, xb: 142, z: 196, h0: 0.85, up: 4.5, dn: 1.0, seed: 72, slant: 0.1, name: 'Fan lip' }));

  // ---- the centre, middle face: Tier A curving down to the east into the Fan cliffs (one band system, broken)
  // (its west end, over the step-down, is 5 m; the middle 6.5 to 8 m)
  F.push(new Band({ name: 'Tier A', lip: [[-50, 203], [-24, 201], [-4, 204], [20, 208], [48, 215]], wig: 1.4, seed: 7, a: 0.42, Rup: 15, Rdn: 26, rough: 0.12,
    pts: [[-50, 0], [-44, 5], [-24, 5], [-18, 0.3], [-10, 0.3], [-2, 6.5], [10, 8], [22, 6], [28, 0.3], [33, 0.3], [40, 7], [48, 0]] }));
  // the step-down's second 5 m drop, 14 m below the first: its ledge between is about 30 degrees, steep enough to land on
  F.push(new Band({ name: 'The step-down', lip: [[-52, 217], [-36, 216], [-23, 217]], wig: 0.8, seed: 8, a: 0.3, Rup: 9, Rdn: 18, pts: [[-52, 0], [-45, 5], [-30, 5], [-23, 0]] }));
  F.push(new Band({ name: 'Fan cliffs', lip: [[56, 252], [76, 255], [100, 261], [120, 268], [140, 277]], wig: 1.8, seed: 13, a: 0.6, Rup: 18, Rdn: 24, rough: 0.12,
    pts: [[56, 0], [63, 5], [76, 7], [84, 1], [90, 1], [98, 6], [106, 8], [112, 7.5], [120, 1], [125, 1], [131, 5], [140, 0]] }));
  // the Big Ones: 9 to 19 m wrapped round a buttress that stands out over the face (the lip bulging down round it)
  F.push(new Band({ name: 'The Big Ones', lip: [[-44, 296], [-22, 290], [0, 287], [12, 290], [22, 296], [32, 291], [46, 286], [60, 290], [74, 300]], wig: 1.5, seed: 11, a: 0.85, Rup: 58, Rdn: 60, rough: 0.06,
    pts: [[-44, 0], [-30, 7], [-16, 10], [-6, 8], [4, 11], [12, 16], [20, 17], [28, 12], [34, 12], [41, 18], [49, 19], [58, 12], [74, 0]] }));
  // the buttress: a prow of rock under the Big Ones' middle, standing out of the apron
  F.push(new Outcrop({ name: 'The buttress', x: 19, z: 304, len: 12, hw: 4.5, hUp: 7, hDn: 3.5, w: 1.6, round: 0.55, rot: 0.1, wob: 1.0, seed: 142 }));
  // ---- below the Couloirs: rock kickers and outcrops over the fan
  F.push(new Outcrop({ name: 'Rock kicker (fan)', x: 74, z: 214, len: 5.5, hw: 3.4, hUp: 0.15, hDn: 5.4, rot: 0.1, wob: 0.4, seed: 81 }));
  F.push(new Outcrop({ name: 'Rock drop (fan)', x: 114, z: 228, len: 7, hw: 4, hUp: 0.2, hDn: 4.0, rot: -0.3, wob: 0.8, seed: 82 }));
  // ---- the Selection zone (skier's right): rock bands with kickers built on them (freeride.js), lips and outcrops
  // (each band level where its kicker stands, curving and breaking up at its ends)
  F.push(new Band({ name: 'Selection rock 1', lip: [[-130, 232], [-115, 237], [-89, 237], [-76, 243]], wig: 0.4, seed: 91, a: 0.85, Rup: 22, Rdn: 22, pts: [[-130, 0], [-121, 2.4], [-112, 3.2], [-92, 3.2], [-84, 2.2], [-76, 0]] }));
  F.push(new Band({ name: 'Selection rock 2', lip: [[-96, 279], [-83, 283], [-59, 283], [-48, 288]], wig: 0.4, seed: 92, a: 0.85, Rup: 22, Rdn: 22, pts: [[-96, 0], [-88, 2.4], [-80, 3.2], [-62, 3.2], [-54, 2.0], [-48, 0]] }));
  F.push(new Outcrop({ name: 'Rock kicker (west)', x: -132, z: 268, len: 5.5, hw: 3.4, hUp: 0.15, hDn: 5.4, rot: -0.1, wob: 0.4, seed: 93 }));
  // ---- lower face: the pillow clusters
  F.push(new Pillows({ name: 'Pillow line', list: pillowLine() }));
  F.push(new Pillows({ name: 'Pillow garden', list: pillowGarden(10, 432, 28, 22, 22, 3) }));
  F.push(new Pillows({ name: 'West pillows', list: pillowGarden(-140, 438, 10, 16, 9, 5) }));
  F.push(new Pillows({ name: 'East pillows', list: pillowGarden(102, 494, 12, 9, 8, 7) }));
  // the pillow line's roll: the snow steepens over a convex break, the pillows stacked down it
  F.push(new Band({ name: 'Pillow roll', lip: [[-64, 372], [-40, 378], [-18, 382]], wig: 1, seed: 66, a: 0.5, Rup: 18, Rdn: 26, rock: false, fw: 20, pts: [[-74, 0], [-58, 3], [-30, 3.2], [-14, 0]] }));
  // the Selection zone, lower: lane A (x about -107): a rock band carrying a kicker, the stumps; lane B (x about -73): the
  // rock slab (freeride.js), the log ledge; both then the Great Wall's kickers. Boulders before the finish.
  F.push(new Band({ name: 'Selection rock 3', lip: [[-134, 389], [-118, 394], [-96, 394], [-82, 401]], wig: 0.4, seed: 101, a: 0.85, Rup: 22, Rdn: 22, pts: [[-134, 0], [-124, 2.6], [-117, 3.4], [-97, 3.4], [-90, 2.4], [-82, 0]] }));
  F.push(new Band({ name: 'Log ledge', lip: [[-90, 425], [-81, 428], [-65, 428], [-56, 432]], wig: 0.4, seed: 103, a: 0.6, Rup: 14, Rdn: 18, pts: [[-90, 0], [-82, 3], [-64, 3], [-56, 0]] }));
  // skier's left, lower: a small band into the trees, a rock kicker
  F.push(new Band({ name: 'Tree band', lip: [[62, 420], [84, 426], [104, 428], [122, 427], [138, 433]], wig: 1.6, seed: 111, a: 0.6, Rup: 14, Rdn: 18, rough: 0.15, pts: [[62, 0], [70, 3], [84, 4], [92, 0.5], [98, 0.5], [106, 3.6], [122, 4], [138, 0]] }));
  F.push(new Outcrop({ name: 'Rock kicker (lower east)', x: 124, z: 458, len: 5.5, hw: 3.4, hUp: 0.15, hDn: 5.0, rot: 0.15, wob: 0.4, seed: 112 }));
  // ---- the Great Wall: the last band across the face, sagging in the middle and stepping up to the east, kickers
  // built on it at four places (freeride.js; each lane level and 3.5 to 4.5 m), breaks to ride round, 5 to 5.5 m drops
  F.push(new Band({ name: 'The Great Wall', lip: [[-130, 480], [-114, 486], [-102, 486], [-90, 489], [-77, 487], [-65, 487], [-50, 492], [-36, 492], [-24, 492], [-6, 498], [12, 501], [34, 496], [46, 496], [62, 492], [90, 486], [120, 478]],
    wig: 1.2, seed: 121, a: 0.75, Rup: 18, Rdn: 24, rough: 0.05,
    pts: [[-128, 0], [-118, 3.5], [-99, 3.5], [-92, 0.6], [-86, 0.6], [-80, 3.5], [-62, 3.5], [-55, 0.6], [-47, 0.6], [-40, 4], [-20, 4], [-12, 5], [-5, 0.6], [5, 0.6], [12, 5], [24, 5.5], [32, 4], [48, 4], [56, 5], [64, 0.6], [72, 0.6], [80, 4.5], [104, 5], [120, 0]] }));
  // ---- rock showing through: boulders and small rock steps scattered over the face, turned and roughened each
  const rocks = [
    // [x, z, len, hw, height at the downhill end, rot, wob]
    [-44, 92, 4, 3, 2.4, 0.3, 0.6], [42, 16, 4.5, 3.4, 2.6, -0.2, 0.7], [-22, 262, 5, 3.6, 2.8, 0.5, 0.8], [-2, 150, 4, 3, 2.2, -0.4, 0.6],
    [84, 392, 5, 3.4, 3, 0.2, 0.7], [104, 520, 4.5, 3.2, 2.6, -0.3, 0.7], [-136, 168, 4.5, 3.2, 2.6, 0.4, 0.6], [-118, 330, 4, 3, 2.4, -0.2, 0.6],
    [6, 238, 3, 2.2, 1.6, 0.8, 0.5], [-66, 248, 3.2, 2.4, 1.8, -0.6, 0.5], [56, 358, 3.6, 2.6, 2.0, 0.4, 0.6], [-30, 340, 2.6, 2, 1.4, 1.1, 0.4],
    [140, 340, 4, 3, 2.2, 0.2, 0.6], [-150, 300, 3.4, 2.4, 2.0, -0.5, 0.5], [30, 452, 2.8, 2, 1.5, 0.6, 0.4], [-60, 520, 3, 2.2, 1.7, -0.2, 0.4],
    [74, 300, 3, 2.4, 1.8, 0.9, 0.5], [-90, 172, 2.6, 2, 1.4, 0.3, 0.4], [128, 160, 3, 2.2, 1.8, -0.7, 0.5], [-14, 556, 3.4, 2.4, 1.6, 0.4, 0.5],
    // (bigger islands between the lines: something to ride round, drop or look at)
    // (off the lines below the drops and kickers: a rider coming off one has the run-out clear)
    [118, 382, 9, 5, 5, -0.2, 1.4], [-128, 222, 7, 4, 4, 0.5, 1.1], [-146, 262, 8, 4.5, 4.5, 0.3, 1.2], [142, 300, 9, 5, 5, -0.4, 1.3],
  ];
  rocks.forEach(([x, z, len, hw, h, rot, wob], i) => F.push(new Outcrop({ name: 'Rock island', x, z, len, hw, hUp: 0.4, hDn: h, w: 0.9, round: 0.6, rot, wob, seed: 131 + i })));
  // small rock steps on the walls of the bowl (rock bands showing through, 1.5 to 3 m)
  F.push(new Band({ name: 'West wall band', lip: [[-176, 150], [-160, 158], [-146, 170]], wig: 1.4, seed: 151, a: 0.5, Rup: 10, Rdn: 14, rough: 0.3, pts: [[-178, 0], [-170, 2.6], [-158, 3], [-146, 0]] }));
  F.push(new Band({ name: 'East wall band', lip: [[150, 214], [164, 206], [182, 196]], wig: 1.4, seed: 152, a: 0.5, Rup: 10, Rdn: 14, rough: 0.3, pts: [[150, 0], [158, 2.4], [172, 3], [182, 0]] }));
  F.push(new Band({ name: 'West wall step', lip: [[-170, 344], [-156, 352], [-144, 362]], wig: 1, seed: 153, a: 0.5, Rup: 10, Rdn: 12, rough: 0.3, pts: [[-172, 0], [-164, 2.2], [-154, 2.4], [-144, 0]] }));
  F.push(new Outcrop({ name: 'Boulder', x: -126, z: 548, len: 5, hw: 3, hUp: 0.4, hDn: 2.6, w: 1.2, round: 0.8, rot: 0.4, wob: 0.6, seed: 104 }));
  F.push(new Outcrop({ name: 'Boulder', x: -86, z: 562, len: 4.5, hw: 2.6, hUp: 0.4, hDn: 2.2, w: 1.1, round: 0.8, rot: -0.3, wob: 0.5, seed: 105 }));
  F.push(new Outcrop({ name: 'Boulder', x: -58, z: 552, len: 5, hw: 3.2, hUp: 0.3, hDn: 2.8, w: 1.2, round: 0.75, rot: 0.7, wob: 0.6, seed: 106 }));
  return F;
}
/* the pillow line: pillows stacked down the roll's steep fall line (x about -48 to -32), each a step under the last,
   getting bigger as it goes, with a few beside the line */
function pillowLine() {
  const L = [];
  let z = 382;
  for (let k = 0; z < 440; k++) {
    const x = -40 + 4 * Math.sin(k * 1.3) + (R() - 0.5) * 3;
    L.push({ x, z, r: 2.6 + k * 0.25 + R() * 1.2, h: 1.0 + k * 0.12 + R() * 0.8, e: 1 + R() * 0.4, a: (R() - 0.5) * 1.2 });
    if (R() < 0.6) L.push({ x: x + (R() < 0.5 ? -1 : 1) * (5 + R() * 3), z: z + R() * 3, r: 1.8 + R() * 1.2, h: 0.8 + R() * 0.7, e: 1 + R() * 0.3, a: R() * 3 });
    z += 5.5 + R() * 2.5;
  }
  return L;
}
// a garden of pillows round (cx, cz): n pillows of mixed sizes in an oval rx by rz, irregularly spaced, never on top of
// one another (but touching, so some stack), bigger ones fewer
function pillowGarden(cx, cz, rx, rz, n, seed) {
  const L = [];
  for (let tries = 0; L.length < n && tries < n * 40; tries++) {
    const a = R() * Math.PI * 2, d = Math.sqrt(R()), x = cx + Math.cos(a) * rx * d, z = cz + Math.sin(a) * rz * d;
    const big = R() < 0.25, r = big ? 3.4 + R() * 1.6 : 1.6 + R() * 1.6, h = big ? 1.8 + R() * 1.0 : 0.8 + R() * 0.9;
    if (L.some(p => Math.hypot(p.x - x, p.z - z) < (p.r + r) * 0.72)) continue;
    L.push({ x, z, r, h, e: 1 + R() * 0.45, a: R() * 3.14 + seed });
  }
  return L;
}

// ---- the land: features on a grid -------------------------------------------------------------------------------------
export class Land {
  constructor() {
    this.features = layout();
    this.rocks = this.features.filter(f => f.rock);
    const B = 16; this.B = B;
    this.cells = new Map(); this.dipCells = new Map(); this.snowCells = new Map();
    for (const f of this.features) {
      for (let i = Math.floor(f.x0 / B); i <= Math.floor(f.x1 / B); i++) for (let j = Math.floor(f.z0 / B); j <= Math.floor(f.z1 / B); j++) {
        const k = i * 8192 + j;
        if (!this.cells.has(k)) this.cells.set(k, []); this.cells.get(k).push(f);
        if (f.dip && f.rock && (!f.dipBox || (i * B + B > f.dipBox[0] && i * B < f.dipBox[1] && j * B + B > f.dipBox[2] && j * B < f.dipBox[3]))) { if (!this.dipCells.has(k)) this.dipCells.set(k, []); this.dipCells.get(k).push(f); }
        if (!f.rock) { if (!this.snowCells.has(k)) this.snowCells.set(k, []); this.snowCells.get(k).push(f); }
      }
    }
    this.G = (x, z) => this.at(x, z);
    this.ribs = this.features.filter(f => f.kind === 'rib');
    this.gullies = this.features.filter(f => f.kind === 'gully');
    this.spines = this.features.find(f => f.kind === 'spines');
  }
  // the ground with nothing on it but the long profile, the bowl, its arms and the fall lines
  base(x, z) { return baseZ(z - zs(x)) + arms(x, z) + fallLines(x, z) + rolls(x, z) + runout(x, z) + far(x, z); }
  at(x, z) {
    let y = this.base(x, z);
    const l = this.cells.get(Math.floor(x / this.B) * 8192 + Math.floor(z / this.B));
    if (l) for (let i = 0; i < l.length; i++) y += l[i].h(x, z);
    return y;
  }
  // the snow without the rock (what the snow shader's rock field is made from: the rock faces draw their own rock)
  snowAt(x, z) {
    let y = this.base(x, z);
    const l = this.snowCells.get(Math.floor(x / this.B) * 8192 + Math.floor(z / this.B));
    if (l) for (let i = 0; i < l.length; i++) y += l[i].h(x, z);
    return y;
  }
  /* how rocky the snow shows here, for the rock field (materials.js): ny is the snow's own steepness (its normal's
     y); on the ribs' crests rock shows through (they are rock), in the chutes and on the spines less does (snow fills a
     chute; spines are flutings of snow) */
  rockNy(x, z, ny) {
    const a0 = Math.abs;
    for (const r of this.ribs) {
      if (x < r.x0 || x > r.x1 || z < r.zTop + 6 || z > r.zEnd) continue;
      const l = r.L(z), rr = r.R(z);
      // (rock, with snow lying in patches on its ledges)
      // (and its outer slopes, the rocky shoulders of the couloirs' block)
      if (x > l + (r.wwL > 4 ? -r.wwL : 1) && x < rr - (r.wwR > 4 ? -r.wwR : 1)) return Math.min(ny, 0.56 + 0.3 * smoothstep(0.1, 0.55, simplex(x * 0.16 + r.seed, z * 0.09) * 0.7 + 0.3 * simplex(x * 0.5, z * 0.4)));
    }
    for (const g of this.gullies) if (x > g.xa && x < g.xb && z > g.za && z < g.zc) return Math.max(ny, 0.8);
    const s = this.spines; if (s && x > s.x0 && x < s.x1 && z > s.za && z < s.zb) return ny + (Math.max(ny, 0.8) - ny) * 0.7;
    // the ribs down the face: rock in streaks along their crests (the shader's noise breaks it up)
    const c = fallCrest(x, z); if (c > 0) ny -= 0.15 * c * c;
    // thin snow over rock in streaks down the fall line here and there on the open face (wind-scoured, rock just under)
    if (z > 10 && z < 560 && a0(x) < 150) ny -= 0.09 * smoothstep(0.25, 0.6, fbm(x * 0.034 + 7, z * 0.009 - 2, 2)) * (1 - smoothstep(470, 560, z));
    // the bowl's side walls, their upper parts most, and the peak behind the summit
    const a = Math.abs(x); if (a > 150) ny -= 0.07 * smoothstep(150, 200, a) * smoothstep(-40, 40, z) * (1 - smoothstep(420, 620, z));
    if (z < -150) ny -= 0.12 * smoothstep(-150, -230, z) * (1 - smoothstep(-330, -360, z));
    return ny;
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
