/* Buttermilk 2024 (X, round 12): a map based on the slopestyle course built at Buttermilk, Aspen, for January 2024,
   with the superpipe beside it and the Summit Express chairlift up its side. Leon asked for one real X Games winter
   course "jump for jump and rail for rail"; the edition was picked by what is published about it (scratchpad
   ski12/X/NOTES.md: the event's own 3D course renderings, its stated length, drop and big air gap, the superpipe's
   stated size, photos from the 2023 and 2024 builds, the venue map). No event, organiser or sponsor names or marks are
   used anywhere: banners carry the map's own words.

   The ground is the real ground: AWS Terrain Tiles (open data, USGS 3DEP in the US) baked into three grids in the
   game's frame (data/buttermilk2024/: fine 8 m round the venue, mid 32 m round the mountain, far 200 m out to the Elk
   Mountains), the frame's origin at the foot of the course by the base area (39.20495 N, 106.86080 W), +z down the
   course's fall line (40 degrees east of north), +x to the left looking down it (north-west). y is metres over 2405 m.
   The course and the pipe are graded into it as the venue's snow is: the course flat across its width along a smoothed
   line of the real slope, the pipe's floor a straight line cut into the hill; the features stand on that.
   Where a number is the event's own it says so; the rest are measured from the ground data or estimated from the
   photos (NOTES.md, the feature sheet). */
import { Kicker, Rail, Quarter, assemble } from './park.js?v=32';
import { setMountain, ground } from './terrain.js?v=32';
import { smoothstep, clamp, fbm, smax } from './noise.js?v=32';

export const MAP_ID = 'buttermilk2024';
export const MAP_NAME = 'Buttermilk 2024';
export const MAP_SUB = 'Based on the slopestyle course built there in 2024';
const E0 = 2405;                 // (the ground's y = 0, metres above the sea)
const RAD = Math.PI / 180;
const DATA = new URL('../data/' + MAP_ID + '/', import.meta.url);
// the grids (bake.py in scratchpad ski12/X/py: x0, z0 of the first sample, step in metres, n samples a side)
const GRIDS = { fine: { x0: -1280, z0: -1580, step: 8, n: 321 }, mid: { x0: -4000, z0: -4300, step: 32, n: 251 }, far: { x0: -32000, z0: -32300, step: 200, n: 321 } };
export const ORIGIN = { lat: 39.20495, lon: -106.86080, bearing: 40 };

// ---- the elevation grids -------------------------------------------------------------------------------------------
async function decode(name) {
  const r = await fetch(new URL(name + '.png?v=32', DATA));
  if (!r.ok) throw new Error(name + ' ' + r.status);
  const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
  const d = x.getImageData(0, 0, bmp.width, bmp.height).data, h = new Float32Array(bmp.width * bmp.height);
  for (let i = 0; i < h.length; i++) h[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768 - E0;
  bmp.close && bmp.close();
  return h;
}
// a grid's height at (x, z): bicubic (Catmull-Rom) for the fine one, so its 8 m cells leave no creases; bilinear beyond
function sampler(G, h, cubic) {
  const n = G.n, s = G.step, at = (i, j) => h[clamp(j, 0, n - 1) * n + clamp(i, 0, n - 1)];
  const cr = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  return (x, z) => {
    const fx = (x - G.x0) / s, fz = (z - G.z0) / s, i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    if (!cubic) return (at(i, j) * (1 - tx) + at(i + 1, j) * tx) * (1 - tz) + (at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx) * tz;
    const r = [];
    for (let k = -1; k <= 2; k++) r.push(cr(at(i - 1, j + k), at(i, j + k), at(i + 1, j + k), at(i + 2, j + k), tx));
    return cr(r[0], r[1], r[2], r[3], tz);
  };
}
// how far inside a grid (x, z) is, in metres (negative: outside)
const inside = (G, x, z) => Math.min(x - G.x0, G.x0 + (G.n - 1) * G.step - x, z - G.z0, G.z0 + (G.n - 1) * G.step - z);

// ---- the course's line and grade ------------------------------------------------------------------------------------
/* The course's middle line: x -10 over its lower half (its last landing comes down just west of the Summit Express,
   whose cables pass over the finish corral and whose first tower stands just east of it, and left of the superpipe
   looking up), easing to x -2 at its top (the upper course lies on the run called Government on the map). Measured:
   the lift's line and towers and the trails' lines from OpenStreetMap, the pipe's earthwork on summer aerial photos;
   the photos from the corral put the course between the lift and the pipe. */
export const courseX = z => -10 + 8 * smoothstep(-150, -390, z);
/* (2026-11-16, third pass, for "make the jumps at the end larger": the course moved SHIFT metres up the hill, so the
   bigger jumps get the in-run they need, and the footage's spacing; the rail sections' first foot at S1_FOOT) */
const SHIFT = 100;
export const S1_FOOT = -394 - SHIFT;
const COURSE_TOP = S1_FOOT - 31, COURSE_END = 60;
// (where the course narrows from the rail decks to the jump line, and widens into the finish: set by the course's layout)
const BOUNDS = { rj: -250, fin: 10 };
// half the graded width: the rail decks the widest (the renderings' terraces, about 46 m), the jump line narrower
export const courseHalf = z => 23 - 6 * smoothstep(BOUNDS.rj - 20, BOUNDS.rj + 20, z) + 6 * smoothstep(BOUNDS.fin - 15, BOUNDS.fin + 15, z);

export async function makeXg(q, step = () => Promise.resolve()) {
  if (step) await step('Reading the mountain', 0.3);
  const [hf, hm, hr] = await Promise.all([decode('fine'), decode('mid'), decode('far')]);
  const SF = sampler(GRIDS.fine, hf, true), SM = sampler(GRIDS.mid, hm, false), SR = sampler(GRIDS.far, hr, false);
  // the real ground: the finest grid that has the place, blended over 120 m at its edge
  const dem = (x, z) => {
    const a = inside(GRIDS.fine, x, z);
    if (a > 120) return SF(x, z);
    const b = inside(GRIDS.mid, x, z);
    const m = b > 400 ? SM(x, z) : b > 0 ? SR(x, z) + (SM(x, z) - SR(x, z)) * smoothstep(0, 400, b) : SR(x, z);
    return a > 0 ? m + (SF(x, z) - m) * smoothstep(0, 120, a) : m;
  };
  // the course's grade: the real slope under its middle line, smoothed over 40 m (the course is built on it; the
  // features add their own snow), worked out once every metre
  const CZ0 = COURSE_TOP - 80, CN = COURSE_END - CZ0 + 81, raw = new Float32Array(CN), prof = new Float32Array(CN);
  for (let i = 0; i < CN; i++) { const z = CZ0 + i, x = courseX(z); let s = 0; for (const d of [-6, 0, 6]) s += dem(x + d, z); raw[i] = s / 3; }
  for (let i = 0; i < CN; i++) { let s = 0, n = 0; for (let k = -20; k <= 20; k++) { const j = clamp(i + k, 0, CN - 1); s += raw[j]; n++; } prof[i] = s / n; }
  const courseY = z => { const f = clamp(z - CZ0, 0, CN - 1.001), i = Math.floor(f), t = f - i; return prof[i] + (prof[i + 1] - prof[i]) * t; };
  const coursePitch = z => Math.atan((courseY(z - 1) - courseY(z + 1)) / 2);

  // ---- the superpipe: "22' plus", "575' long" (the event's rendering: 6.7 m walls, 175 m). Its line from the earthwork
  // it is built on, seen on summer aerial photos: a straight trench about 200 m long from (20, -66) at its foot to
  // (64, -263) at its top (pipe and in-run). Its floor a straight line: the pipe's floor is cut 3.5 m into the ground at its foot and climbs at 14.5 degrees: the hill under the trench rises at
  // about 13.6 (the elevation data), so its decks stand a little over the hill at its top, as snow berms do; the pitch
  // is estimated, no published figure was found).
  // (2026-11-16, after the first comparison: the photos from the base show the pipe's walls rising right behind the
  // lounge by the finish, so the pipe runs 30 m further down than the earthwork's foot, on the snow, and the top of the
  // earthwork is its drop-in)
  const P = { ax: 20 - 30 * 44 / 201.9, az: -66 + 30 * 197 / 201.9, dx: 44 / 201.9, dz: -197 / 201.9 };      // (its foot on its axis, and its line's direction, up the hill)
  P.ux = -P.dz; P.uz = P.dx;                                             // (across it)
  const pipeLen = 175, pipeIn = 55, pipePitch = 14 * RAD;
  // along its axis: s from its foot (0) up the hill; across: u
  const pipeLocal = (x, z) => { const X = x - P.ax, Z = z - P.az; return { s: X * P.dx + Z * P.dz, u: X * P.ux + Z * P.uz }; };
  const pipeAt = (s, u) => ({ x: P.ax + P.dx * s + P.ux * u, z: P.az + P.dz * s + P.uz * u });
  // the floor's height along s: from the foot's ground level, rising at 17 degrees up the walls, then the in-run
  const foot = pipeAt(0, 0), yFoot = dem(foot.x, foot.z) - 1.0;
  const pipeFloor = s => s <= 0 ? yFoot + s * 0.06 : yFoot + Math.min(s, pipeLen) * Math.tan(pipePitch) + Math.max(0, s - pipeLen) * Math.tan(13 * RAD);
  const PIPE_W = 4 + 6.4 + 0.15 + 4.5;                                    // (half the flat, the transition, the vert, the deck)

  // ---- the ground: the real ground, with the course and the pipe graded into it --------------------------------------
  const land = { dem, courseY, coursePitch, pipeFloor, pipeLocal, pipeAt, pipe: Object.assign({ len: pipeLen }, P) };
  land.at = (x, z) => {
    let y = dem(x, z), dc = 99;
    // the course: flat across, its sides blending back into the hill over 14 m (built up or cut, as the course needs)
    if (z > COURSE_TOP - 60 && z < COURSE_END + 60) {
      const d = dc = Math.abs(x - courseX(z)) - courseHalf(z);
      const along = smoothstep(COURSE_TOP - 60, COURSE_TOP, z) * (1 - smoothstep(COURSE_END, COURSE_END + 60, z));
      if (d < 14) y += (courseY(z) - y) * (1 - smoothstep(0, 14, d)) * along;
    }
    // the pipe's cut: its floor across the whole pipe and its decks, the hill's own ground beyond, meeting over 12 m
    const L = pipeLocal(x, z);
    if (L.s > -30 && L.s < pipeLen + pipeIn + 20) {
      const d = Math.abs(L.u) - PIPE_W, k = smoothstep(-30, 0, L.s) * (1 - smoothstep(pipeLen + pipeIn, pipeLen + pipeIn + 20, L.s));
      // (not inside the course's own width: the pipe's foot pulled the big air's takeoff down by up to half a metre, a
      // crease felt at its lip, 2026-11-16)
      if (d < 12) { const f = pipeFloor(L.s); y += (f - y) * (1 - smoothstep(0, 12, d)) * k * smoothstep(-4, 2, dc); }
    }
    return y;
  };
  // packed, groomed snow on the course, the pipe and the venue; deep snow off them
  let park = null;
  const groomed = (x, z) => {
    const d = Math.abs(x - courseX(z)) - courseHalf(z), L = pipeLocal(x, z);
    if (z > COURSE_TOP - 30 && z < COURSE_END + 40 && d < 6) return 1;
    if (L.s > -20 && L.s < pipeLen + pipeIn + 10 && Math.abs(L.u) < PIPE_W + 6) return 1;
    if (z > -10 && z < 140 && x > -90 && x < 70) return 1;              // (the base area and the finish)
    return 0;
  };
  const mtn = {
    bare: true, at: (x, z) => land.at(x, z), land,
    surface: (x, z) => park && park.surface(x, z) ? 2 : groomed(x, z) ? 0 : 1,
    groom: (x, z) => groomed(x, z),
    spot: { treeline: 3550 - E0 },
  };
  if (q && q.tier === 'low') mtn.lodK = 0.7;   // (as Freeride's: a real hillside fills the view with near ground)
  setMountain(mtn);
  if (step) await step('Building the course', 0.36);
  park = buildCourse(land, q);
  park.land = land; park.xg = true;
  park.pipeLocal = pipeLocal; park.pipeAt = pipeAt; park.PIPE = { len: pipeLen, W: PIPE_W, P };
  return { id: MAP_ID, name: MAP_NAME, mtn, park, land, E0, GRIDS, grids: { hf, hm, hr }, dem };
}

// ---- the course's own shapes ----------------------------------------------------------------------------------------
/* A jump or a rail deck as the venue's crew cut them (photos 080 to 083: crisp edges, steep cut sides, flat tops):
   park.js's Kicker with steeper sides (46 deg, under the 49 the physics takes as a wall), a tight shoulder, and the
   blue dye where the photos have it, wide enough to see: a band along the lip, down the takeoff's two edges over its
   last 4 m, across the knuckle, and down the landing's two edges over its first 10 m. */
class XgKicker extends Kicker {
  constructor(o) { super(o); if (o.prog) this.progressive(o.prog); }
  /* (2026-11-16, for "make the kickers less kicky": a takeoff as crews shape the big ones, long and progressive. park.js's is
     one circular arc from the slope to the lip: the load arrives all at once at its foot and holds to the lip, 2.7 to 3.1 g
     and about 60 to 70 deg/s of pitch right up to the lip. Here the curvature rises smoothly from nothing at the foot (no
     crease where the in-run meets the ramp) over the first 35% of the transition, holds, eases off over its last 15%, and
     the last `straight` metres are a plane at the lip's angle, so nothing turns the rider at the lip. Worked out after
     park.js's Kicker has made its own, and everything that follows from the lip worked out again.) */
  progressive({ len, straight = 2.5, a = 0.35, c = 0.85 }) {
    const p = this.pa(this.z0), th = this.lip * RAD + p, ds = 0.05, n = Math.round(len / ds);
    const w = u => u < a ? smoothstep(0, a, u) : u < c ? 1 : 1 - smoothstep(c, 1, u);
    let area = 0; for (let i = 0; i < n; i++) area += w((i + 0.5) / n) * ds;
    const km = th / area;
    let z = this.z0, y = this.bl(this.z0), ph = -p;
    const zs = [z], ys = [y], m = n + Math.round(straight / ds);
    for (let i = 0; i < m; i++) { const k = i < n ? km * w((i + 0.5) / n) : 0, pm = ph + k * ds / 2; z += Math.cos(pm) * ds; y += Math.sin(pm) * ds; ph += k * ds; zs.push(z); ys.push(y); }
    this._tz = zs; this._ty = ys; this.prog = true; this.rMin = 1 / km; this.takeLen = len + straight;
    this.L = { z, y };
    const land = this.land * RAD;
    this.zBack = this.L.z + this.drop / Math.tan(65 * RAD);
    this.yT = this.L.y - this.drop;
    this.K = { z: this.L.z + this.table, y: this.yT };
    this.Kend = { z: this.K.z + this.Rk * Math.sin(land), y: this.yT - this.Rk * (1 - Math.cos(land)) };
    this.tl = Math.tan(land); this._bl = undefined;
    let zz = this.Kend.z;
    while (zz < this.Kend.z + 200 && this.Kend.y - (zz - this.Kend.z) * this.tl > this.bl(zz)) zz += 0.25;
    this.zMeet = zz; this.z1 = zz + 14;
    this.lipH = this.L.y - this.bl(this.L.z);
    // (aim: where on the landing the design speed is aimed; riders' flights come out a little short of park.js's own aim)
    const frac = this.aim ?? clamp(0.45 + 0.08 * (this.lipH - 1.6), 0.4, 0.75);
    const vL = this.lipFor(this.Kend.z + frac * (this.zMeet - this.Kend.z)), rise = this.L.y - this.bl(this.z0);
    /* (what a long ramp takes besides its height: the snow and the air, about 3 m2/s2 a metre at these speeds, measured
       riding them (a rider at 17.8 m/s at the foot of a 20.5 m ramp rising 2.5 m left its lip at 13.9); about half of it
       is put in, which lands checked riders where aimed (rampLoss, 1.6 by default, set by riding them). The game's speed
       check up a takeoff aims at vLip plus the height still to climb only, so the vLip it is given here carries the
       ramp's losses too, or it would scrub riders who need every bit of their speed.) */
    const loss = (this.rampLoss ?? 1.6) * this.takeLen;
    this.vLipDesign = vL; this.vLip = Math.sqrt(vL * vL + loss);
    this.vDesign = Math.sqrt(vL * vL + 2 * 9.81 * rise * (1.12 + 0.02 * rise) + loss) + 0.5;
    this._vcT = this.Kend.z + 0.3 * (this.zMeet - this.Kend.z); this._rise = rise; this._vClear = undefined;
    this.knuckleH = this.yT - this.bl(this.K.z);
    const hMax = Math.max(this.lipH, this.knuckleH) + 0.3;
    const reach = Math.max(this.hwT + this.splay, this.hwLand) + hMax / Math.min(this.sideS, this.landS) + this.shoulder + this.toe + 0.5;
    this.x0 = this.cxT - reach; this.x1 = this.cxT + reach;
  }
  takeY(z) {
    if (!this._tz) return super.takeY(z);
    if (z < this.z0 || z > this.L.z) return -Infinity;
    const Z = this._tz; let lo = 0, hi = Z.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (Z[mid] <= z) lo = mid; else hi = mid; }
    const t = (z - Z[lo]) / Math.max(1e-9, Z[hi] - Z[lo]);
    return this._ty[lo] + (this._ty[hi] - this._ty[lo]) * t;
  }
  dye(x, z) {
    const dx = Math.abs(x - this.cxT), hw = this.hwT;
    if (z > this.L.z - 0.32 && z < this.L.z + 0.02 && dx < hw + 0.1) return 1;
    if (z > this.z0 + 1 && z < this.L.z && Math.abs(dx - hw) < 0.2) return 1;
    if (z > this.L.z && z < this.K.z && Math.abs(dx - this.hwAt(z)) < 0.2) return 1;
    if (Math.abs(z - this.K.z - 0.35) < 0.22 && dx < this.hwAt(this.K.z) + 0.1) return 1;
    if (z > this.K.z && z < this.zMeet - 2 && Math.abs(dx - this.hwAt(z)) < 0.22) return 1;
    return 0;
  }
}
/* a rail section's deck: as XgKicker, but its deck falls gently down the hill (the decks in the renderings and the 2023
   photos run down at a few degrees, so riders keep their speed to the rails: a level one stopped them dead after the
   start, 2026-11-16), at the lip's own angle (lip -7: down 7 deg), then a round knuckle of radius Rk and the landing.
   Worked out again after park.js's Kicker has made its level one. */
/* (2026-11-16, for "less kicky": the ramp up to a rail as a smooth, low, long run-up: concave at its foot (curvature 0.09,
   a radius of 11 m), a short plane, then easing over at its top (0.065, a radius of 15 m) into the flat top, so at 9 to 10
   m/s it loads a rider about 1.8 g at its foot and never lifts them off it at its top: the snow sets the skis on the
   rail. Before, a 1.9 m concave face to 43 deg, then flat: 4 to 7 g and 160 to 315 deg/s, and every rider was thrown off
   it before the rail.) */
const RAMP = { kb: 0.09, kt: 0.065, Lm: 0.6 };
function rampProfile(h) {
  const { kb, kt, Lm } = RAMP, A = 1 / (2 * kb) + 1 / (2 * kt), th = (-Lm + Math.sqrt(Lm * Lm + 4 * A * h)) / (2 * A);
  const Lb = th / kb, Lt = th / kt;
  return { kb, kt, Lm, th, Lb, Lt, hb: kb * Lb * Lb / 2, run: Lb + Lm + Lt };
}
class DeckKicker extends XgKicker {
  constructor(o) {
    super(o);
    const d = -this.lip * RAD, la = this.land * RAD, Rk = this.Rk;
    this.td = Math.tan(d);
    this.K = { z: this.L.z + this.table, y: this.L.y - this.table * this.td };
    this.kc = { z: this.K.z - Rk * Math.sin(d), y: this.K.y - Rk * Math.cos(d) };          // (the knuckle's centre, under it)
    this.Kend = { z: this.kc.z + Rk * Math.sin(la), y: this.kc.y + Rk * Math.cos(la) };
    this.tl = Math.tan(la); this._bl = undefined;
    let z = this.Kend.z;
    while (z < this.Kend.z + 200 && this.Kend.y - (z - this.Kend.z) * this.tl > this.bl(z)) z += 0.25;
    this.zMeet = z; this.z1 = z + 14;
    this.knuckleH = this.K.y - this.bl(this.K.z);
    const hMax = Math.max(this.lipH, this.knuckleH) + 0.3;
    const reach = Math.max(this.hwT + this.splay, this.hwLand) + hMax / Math.min(this.sideS, this.landS) + this.shoulder + this.toe + 0.5;
    this.x0 = this.cxT - reach; this.x1 = this.cxT + reach;
  }
  dye(x, z) {
    for (const e of this.ents) if (z > e.z1 - 0.5 && z < e.z1 + 0.2) { const a = Math.abs(x - e.x); if (a > e.hw - 0.3 && a < e.hw + 0.3) return 1; }
    return 0;   // (no dye round the deck itself: none of the photos, the footage or the renderings show any, round 4 review)
  }
  /* the ramps up to the rails as the crews cut them (photos 077, 078 and the 2024 footage: a block of snow with a
     concave foot, a long low face, a flat top and cut sides, its top corners dyed): the face rising as RAMP above to a flat top
     0.5 m long that runs on 0.2 m under the rail's start, then falling away under the rail as park.js's own; its sides a
     6 cm round, then 45 deg (the physics takes a park face over about 49 as a wall). Part of the deck's own snow, so no
     rounding between two shapes. */
  entryRel(x, z) {
    let best = 0;
    for (const e of this.ents) {
      if (z < e.z0 || z > e.z1 + 1.8) continue;
      const ax = Math.abs(x - e.x), dx = ax - e.hw; if (dx > e.h + 0.2) continue;
      const pr = e.pr, zt = e.z1 - 0.5, zf = zt - pr.run, back = 0.6 + smoothstep(e.hw - 0.35, e.hw + 0.25, ax);
      let r;
      if (z <= zt) { const q = z - zf; r = q <= 0 ? 0 : q < pr.Lb ? pr.kb * q * q / 2 : q < pr.Lb + pr.Lm ? pr.hb + pr.th * (q - pr.Lb) : e.h - pr.kt * (pr.run - q) * (pr.run - q) / 2; }
      else r = z < e.z1 + 0.2 ? e.h : e.h * (1 - smoothstep(e.z1 + 0.2, e.z1 + 0.2 + back, z));
      if (dx > 0) r -= dx < 0.06 ? dx * dx / 0.12 : dx - 0.03;
      if (r > best) best = r;
    }
    return best;
  }
  // (and their grids: points at the top's edges, the sides' feet and where the top begins, so the cut edges stay sharp)
  entryGrid(e, step) {
    const g = super.entryGrid(e, Math.max(step, 0.45)), xs = [...g.xs], zs = [...g.zs], zt = e.z1 - 0.5, zf = zt - e.pr.run;   // (a block of flat faces: a coarser grid than park.js's 0.25 to 0.35 m, its edges kept)
    for (const sg of [-1, 1]) for (const d of [-0.06, 0.06, 0.3, e.h + 0.03]) xs.push(e.x + sg * (e.hw + d));
    for (let k = 0; k <= 10; k++) zs.push(zf + e.pr.run * k / 10); zs.push(zt - 0.05, zt + 0.05);
    const u = a => [...new Set(a.map(v => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
    return { xs: u(xs), zs: u(zs) };
  }
  tableY(z) {
    if (!this.kc) return super.tableY(z);                  // (park.js's own constructor asks before this one has run)
    if (z < this.K.z) return this.L.y - (z - this.L.z) * this.td;
    if (z < this.Kend.z) { const dz = z - this.kc.z; return this.kc.y + Math.sqrt(Math.max(0, this.Rk * this.Rk - dz * dz)); }
    return smax(this.Kend.y - (z - this.Kend.z) * this.tl, this.bl(z), this.blend());
  }
}
// ---- the course --------------------------------------------------------------------------------------------------------
function buildCourse(land, q) {
  const { courseY, coursePitch } = land;
  const kickers = [], rails = [], meshed = [], pipes = [];
  const base = z => courseY(z), pitch = z => coursePitch(z);
  // a deck or a jump standing on the course's grade (park.js Kicker on a base of its own)
  const K = o => { const k = new XgKicker(Object.assign({ base, pitch, group: 'Course', sideS: 1.05, landS: 0.9, shoulder: 0.35, toe: 0.2 }, o)); kickers.push(k); return k; };
  const BLACK = 0x17181b;
  // a rail or box on a deck, its height measured over that deck's snow (abs: the top line's own y)
  const onDeck = (deck, o) => {
    const under = (x, z) => deck.snowY(x, z);
    const pts = o.pts.map(([x, z, h]) => [x, z, under(x, z) + h]);
    const r = new Rail(Object.assign({ colour: BLACK, look: o.kind === 'box' ? 'box' : 'dd', legs: true }, o, { pts, abs: true, under }));
    rails.push(r); return r;
  };
  // ---- the start: a deck at the top, the start tent behind it
  const x0 = courseX(S1_FOOT - 6);
  const starts = [{ name: 'Start: the top of the course', x: x0 + 2.5, z: S1_FOOT - 10, v: 3 }];   // (between two lanes of rail section 1: let go, you roll over its deck and down its landing)

  // ---- the three rail sections ("three rail features at the top", the event's course text; the renderings show each
  // as a deck with kicker-shaped snow ramps up to the rails, the rails going off its end down a landing)
  const section = (name, zFoot, opt) => {
    const xc = courseX(zFoot + opt.inrun + opt.deck * 0.5);
    const d = new DeckKicker(Object.assign({ base, pitch, group: 'Course', name, x: xc, z0: zFoot, lip: opt.lip ?? -7, R: 30, drop: 0, table: opt.deck, Rk: 5, land: opt.land ?? 27, wT: opt.hw, wD: opt.hw + 1, wL: opt.hw + 1, sideS: 1.05, landS: 0.95, shoulder: 0.3, noCheck: true, rails: true, lod: true, toe: 0.2 }, opt.k || {}));   // (lod: in its group's far copy, main.js)
    kickers.push(d);
    return d;
  };
  // each section's foot a little past the last one's landing (placed down the real slope: their sizes, estimated from
  // the renderings and the 2023 build photos, set where they end)
  /* (2026-11-16, second pass: four rail sections, as every 2024 run in the footage hits four in the same order, the
     riders on each about 4 to 5 s apart (Tjader's own run, Hall's and Gerard's broadcast runs: scratchpad
     ski12/X/foot/FOOTAGE.md), where the event's text says three; the footage is the stronger evidence) */
  // (the upper three on the gentler ground above the old start, about 12 deg: their decks fall 3.5 deg so they stand up as
  // terraces with landings riders can come off a rail onto; at 7 deg their landings were 3 to 4 m long, third pass)
  const S1 = section('Rail section 1', S1_FOOT, { inrun: 5, deck: 15, hw: 19, lip: -3.5 });
  const S2 = section('Rail section 2', S1.zMeet + 6, { inrun: 5, deck: 13, hw: 18, lip: -3.5 });
  const S3 = section('Rail section 3', S2.zMeet + 6, { inrun: 5, deck: 13, hw: 18, lip: -3.5 });
  const S4 = section('Rail section 4', S3.zMeet + 6, { inrun: 5, deck: 13, hw: 19 });
  /* (lanes about 5 m apart, as the 2023 photos show five ramps side by side across about 22 m)
     the rails: each set off its deck's front edge (the knuckle, K), its start on the deck after a kicker-shaped snow
     ramp, then over the knuckle and down the landing, or on the deck itself (the rainbow). A rail is given as points
     [dz from the knuckle, height over the snow there, dx]: its top line goes straight between them; each straight
     piece is checked to keep at least 0.25 m over the snow under it (raised where it would not). */
  const lanes = (S, list) => {
    const zk = S.K.z;
    for (const [dx, kind, name, o = {}] of list) {
      /* (the ramp up to each rail is the deck's own snow: an entry ramp on the deck (park.js's Kicker ents, as the Jump
         Line's takeoff features have), rising over 2.8 m to 2 cm under the rail's start, flat 0.2 m under it, then easing
         away. Second pass, 2026-11-16: as shapes of their own on the deck, the park's rounding between two features that
         stand over the ground raised each ramp's edge by up to 0.34 m in one step where it began, a step that stopped
         riders at the ramps' feet and sides) */
      const x = S.x + dx, rampH = kind === 'ledge' ? 0.5 : o.rampH ?? 0.65, h0 = rampH - 0.03;   // (rails 0.62 m over the deck at their starts, a ledge 0.47: low ramps up to them, second pass)
      let spec;
      // (a down rail bends over the knuckle's end, then runs parallel to the landing: straight from the deck to its end it
      // stood 1.2 m up at its start once raised clear of the knuckle)
      if (kind === 'down') spec = [[-1.5, h0], [(S.Kend.z - zk) + 0.6, 0.72], [o.len ?? 10, 0.7]];
      else if (kind === 'flatDown') spec = [[-4.5, h0], [0.4, h0], [o.len ?? 10, 0.65]];
      else if (kind === 'dfd') spec = [[-1.5, h0], [4, 0.7], [7.5, 1.05], [o.len ?? 12, 0.65]];
      else if (kind === 'angled') { const t = (o.turn ?? 10) * RAD, L = o.len ?? 12, k1 = (S.Kend.z - zk) + 2.1; spec = [[-1.5, h0, 0], [k1, 0.74, Math.tan(t) * (k1 + 1.5)], [-1.5 + Math.cos(t) * L, 0.7, Math.sin(t) * L]]; }
      // (a rainbow ends lower than it starts, 0.45 m over the deck, as real ones do: one ending a metre up left a rider who fell
      // off its side wedged under its end)
      else if (kind === 'rainbow') { spec = []; const L = o.len ?? 10, a = -L - 0.6; for (let i = 0; i <= 12; i++) { const t = i / 12; spec.push([a + t * L, h0 - (h0 - 0.45) * t + (o.rise ?? 0.75) * Math.sin(Math.PI * t)]); } }
      else if (kind === 'aframe') spec = [[-7.5, h0], [-4, h0 + (o.rise ?? 0.6)], [-0.2, h0 + (o.rise ?? 0.6)], [o.len ?? 8, 0.7]];
      else if (kind === 'box') spec = [[-2.0, h0], [(S.Kend.z - zk) + 0.6, 0.6], [o.len ?? 9, 0.55]];
      else if (kind === 'ledge') spec = [[-5.5, h0], [-0.4, h0], [o.len ?? 6, h0 - 0.03]];
      else if (kind === 'kinkDown') spec = [[-3.5, h0], [0.2, h0], [(S.Kend.z - zk) + 1.0, 0.65], [o.len ?? 11, 0.62]];
      // the ramp up to its start, ending where the rail begins (an entry ramp on the deck)
      const z1 = zk + spec[0][0];
      const hR = Math.max(0.05, h0 - 0.02), pr = rampProfile(hR);
      S.ents.push({ x, z0: z1 - 0.5 - pr.run - 0.1, z1, h: hR, pr, hw: o.rampW ?? (kind === 'box' || kind === 'ledge' ? 1.2 : 1.0) });
      // its points on the snow (the ramp's top under the first)
      let pts = spec.map(([dz, h, ddx = 0]) => [x + ddx, zk + dz, S.snowY(x + ddx, zk + dz) + h]);
      // clearance: between points, never closer than 0.25 m to the snow
      for (let it = 0; it < 3; it++) {
        let worst = 0, wi = -1;
        for (let i = 0; i < pts.length - 1; i++) for (let t = 0.1; t < 1; t += 0.1) {
          const X = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, Z = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t, Y = pts[i][2] + (pts[i + 1][2] - pts[i][2]) * t;
          const short = 0.25 - (Y - S.snowY(X, Z)); if (short > worst) { worst = short; wi = i; }
        }
        if (wi < 0) break;
        pts[wi][2] += worst; pts[wi + 1][2] += worst;
      }
      const under = (X, Z) => S.snowY(X, Z);
      const flat = kind === 'box' || kind === 'ledge';
      const r = new Rail(Object.assign({ colour: BLACK, look: flat || o.look === 'box' ? 'box' : 'dd', legs: true, w: kind === 'ledge' ? 0.9 : flat ? 0.7 : 0.16 }, o,
        { name, kind: flat ? 'box' : kind === 'rainbow' ? 'rainbow' : /dfd|aframe|flatDown|kinkDown/.test(kind) ? 'kink' : 'rail', pts, abs: true, under, section: S.name }));
      rails.push(r);
    }
  };
  /* the lanes as the 2024 footage shows them, left to right looking down (+x is the left), each kind as seen; lane
     counts are the least seen (Tjader's POV, the broadcast runs); where a lane's kind could not be told it is marked
     estimated in the feature sheet */
  const LIME = 0xa8d421, CAMO = 0x2f68c9;
  lanes(S1, [
    [10, 'angled', 'Long angled rail', { len: 12, turn: -9 }],                // (far left, across the deck: drone frame)
    [5, 'down', 'Round down rail', { len: 10 }],                             // (Tjader's lane)
    [0, 'box', 'Down box', { len: 9 }],                                      // (black, black side panels: Hall's)
    [-5, 'flatDown', 'High flat-down rail', { len: 10, rampH: 0.85 }],       // (a high rail on a tall square post)
    [-10, 'box', 'Flat-down box', { len: 9 }],                               // (a second black box: estimated)
  ]);
  lanes(S2, [
    [7.5, 'ledge', 'Low ledge box', { len: 6, colour: LIME }],               // (low and flat-topped, green edges)
    [2.5, 'flatDown', 'Flat-down rail', { len: 10, colour: LIME }],          // (green, on posts, flat then down)
    [-2.5, 'rainbow', 'Arched box', { len: 8.5, rise: 0.6, top: 'flat', look: 'box', w: 0.7, colour: LIME }],
    [-7.5, 'down', 'Down rail', { len: 10, colour: LIME }],                  // (estimated)
  ]);
  lanes(S3, [
    [7.5, 'flatDown', 'Flat-down rail', { len: 10, skirt: true }],           // (black, red skirts: the skirt shows flat then down)
    [2.5, 'dfd', 'Down-flat-down rail', { len: 12, skirt: true }],
    [-2.5, 'kinkDown', 'Kinked rail', { len: 11, skirt: true }],
    [-7.5, 'down', 'Down rail', { len: 10, skirt: true }],                    // (estimated)
  ]);
  lanes(S4, [
    [10, 'aframe', 'A-frame rail', { len: 8, rise: 0.6 }],                   // (A-frame legs, on the left)
    [5, 'down', 'Ring rail', { len: 10, ring: true }],                       // (a plain hoop on it, in the middle)
    [0, 'flatDown', 'Long rail on zigzag legs', { len: 10 }],   // (ending on its landing: at 13 m it ran past the landing's foot and riders came off it into the slope's change, 2026-11-16)                // (Tjader's last rail)
    [-5, 'angled', 'Curved rail', { len: 11, turn: 11 }],                    // (curved, behind those: drawn as a turning rail)
    [-10, 'box', 'Wedge box', { len: 9, colour: CAMO }],                     // (blue and yellow camouflage sides: blue here)
  ]);
  starts.push({ name: 'Rail section 2', x: S2.x, z: S2.z0 - 14, v: 6 }, { name: 'Rail section 3', x: S3.x, z: S3.z0 - 14, v: 6 }, { name: 'Rail section 4', x: S4.x, z: S4.z0 - 14, v: 6 });

  /* ---- the jumps ("the remaining three booters": a 50 ft and a 60 ft higher up, the big air's "70' gap" last). Tables
     as stated (15.2, 18.3 and 21.3 m from lip to knuckle); lips, radii and landings estimated from the photos. Each one
     takeoff (the 2024 footage shows one on jump 2 too, tall and fairly narrow). Spaced as the footage times them as
     the ground allows (about 7 s lip to lip: 80 to 90 m here), the big air kept on the step down to the base, where the
     real ground steepens and its landing can stand tall over the finish. */
  /* (second pass, 2026-11-16: jump 2's table 16.5 m, not the 18.3 (60 ft) of the 2021 report: on this ground a rider who lets
     go at the top reaches it at about 15.8 m/s, and at 18.3 m landed on its knuckle every time) */
  /* (second pass: the first two with their lips a little higher over their knuckles (lip 31 deg, the knuckle 2.2 and 3.0 m under it), and the
     first's in-run longer: riders came off the last rail section at about 10 m/s and reached the first two jumps 1.5 m/s
     under the speed they were built for, landing on their knuckles. The big air 14 m further down than the first version:
     from the corral (photo 1852) the chairlift's first tower stands beside the landing's foot, 20 to 30 m up from the
     barrier, and the footage puts about 7 s between the jumps' lips, where the first version gave riders about 5) */
  const J1 = K({ name: 'Jump 1', x: courseX(S4.zMeet + 42), z0: S4.zMeet + 40, lip: 28, prog: { len: 24, straight: 2.5 }, aim: 0.4, drop: 5.0, table: 15, Rk: 8, land: 35, wT: 4.4, wD: 6.5, wL: 11 });
  const z2 = J1.zMeet + 40, J2 = K({ name: 'Jump 2', x: courseX(z2), z0: z2, lip: 29, prog: { len: 25, straight: 2.5 }, aim: 0.4, drop: 5.6, table: 17, Rk: 9, land: 35, wT: 4.0, wD: 6.5, wL: 12 });
  const z3 = Math.max(J2.zMeet + 40, -68), J3 = K({ name: 'Jump 3: the big air', x: courseX(z3), z0: z3, lip: 30, prog: { len: 27, straight: 3 }, aim: 0.4, drop: 9.0, table: 21.3, Rk: 11, land: 36, wT: 5.2, wD: 6.5, wL: 16, wTab: 14.5, tabZ: [0.5, 5], landS: 1.0, shoulder: 0.15 });   // (shoulder 0.15: the photos' squared lip and table edges)
  starts.push({ name: 'Jump 1', x: J1.x, z: J1.z0 - 30, v: 17.8 }, { name: 'Jump 2', x: courseX(z2 - 30), z: z2 - 30, v: 19.9 }, { name: 'The big air', x: J3.x, z: J3.z0 - 30, v: 17.7 });   // (the speed a rider who lets go at the top passes each with, measured)
  BOUNDS.rj = S4.zMeet + 10; BOUNDS.fin = J3.zMeet + 12;   // (the speed a rider who lets go at the top passes there with, measured: 16.0 to 16.4 m/s)

  // ---- the superpipe: two quarterpipe walls (park.js Quarter) facing each other across its line, on its floor (the
  // ground there is the floor, cut flat across: makeXg). Its walls 6.4 m transitions with 0.3 m of vert: 6.7 m, "22'";
  // the flat between them 8 m (estimated: an Olympic-size pipe's 19 to 22 m from coping to coping).
  const PP = land.pipe, F = 4.0;
  for (const dir of [1, -1]) {
    // (its edge along z: the line's x at z, the flat's half width across it; the walls rise towards dir)
    const xAt = z => { const s = (z - PP.az) / PP.dz, c = PP.ax + PP.dx * s; return c + dir * F / Math.abs(PP.dz); };
    const q = new Quarter({ name: dir > 0 ? 'Superpipe (left wall)' : 'Superpipe (right wall)', dir, R: 6.4 / Math.abs(PP.dz), vert: 0.3, deck: 4.5, entry: 14, exit: 6, backS: 0.7,
      z0: PP.az + PP.dz * (PP.len + 2), z1: PP.az - 2, xAt, group: 'Superpipe', lod: true });
    meshed.push(q); pipes.push(q);
  }
  starts.push({ name: 'Superpipe', x: PP.ax + PP.dx * (PP.len + 30), z: PP.az + PP.dz * (PP.len + 30), v: 4, yaw: Math.atan2(-PP.dx, -PP.dz) });
  const park = assemble({ kickers, rails, meshed, starts, fences: [], banner: null, pipes });
  return park;
}
