/* (W, round 10, for Leon's "improve the generation to reflect more natural side hits and rock drops throughout the
   mountain and also park lines where parks are with accurate jumps/rails/ect and also accurate rock drops/cliff across
   the mountain where they appear") Any mountain's generated features, each placed by the real ground under it:
   - side hits: where the snow beside a groomed run rises into a bank, a lip on the bank's top, facing back into the run
     (ride up the bank across the run, pop off it and land in the run);
   - rollers: low wide humps across a run where it steepens over a knoll, as groomed runs roll;
   - wind lips: on a convex break off the runs (a gentle crest above a steep face), a long lip with a steep lee face;
   - rock drops: where the real slope steepens hard off the runs (its slope and curvature from the elevation), a rock
     band across the fall line, a bench above it, a face of 2 to 8 m and the natural apron below as the landing; each
     face is marked as rock for the physics (park.cliff) and for the snow's look (the rock field);
   - the terrain parks OpenStreetMap marks (piste:type=snow_park, or a run named a park): a line down the park's own
     fall line of jumps (park.js Kickers sized to the slope) and rail rows (park.js Rails: a box and a rail side by side,
     on snow ramps), as parks are laid out.
   Features on a slope that runs any way are worked out in a frame of their own: x across, +z down their way (Framed).
   The lips, humps, bands and ramps are drawn by the terrain's own patches (no mesh of their own); the parks' kickers have
   meshes of their own (dress), all of them in one draw call. */
import * as THREE from 'three';
import { Kicker, Rail } from './park.js?v=26';
import { ground, height } from './terrain.js?v=26';
import { smoothstep, clamp, simplex, rng } from './noise.js?v=26';

const RAD = Math.PI / 180;
const _l = { x: 0, z: 0 };
// a frame: local (x across, z along `th`'s way) <-> world, moved to (ox, oz)
class F2 {
  constructor(ox, oz, th) { this.ox = ox; this.oz = oz; this.th = th; this.c = Math.cos(th); this.s = Math.sin(th); }
  wx(x, z) { return this.ox + this.c * x + this.s * z; }
  wz(x, z) { return this.oz - this.s * x + this.c * z; }
  loc(x, z) { const dx = x - this.ox, dz = z - this.oz; _l.x = this.c * dx - this.s * dz; _l.z = this.s * dx + this.c * dz; return _l; }
}
// the way (a unit vector dx, dz) as a frame's turn: local +z along it
const thOf = (dx, dz) => Math.atan2(dx, dz);

/* a local feature asked about in the world: f answers height(x, z, g), surface(x, z) in its frame; the world box round
   its local box (x0..x1, z0..z1) for the park's lookup grid */
class Framed {
  constructor(f, F, name) {
    this.f = f; this.F = F; this.name = name || f.name; this.ownMesh = !!f.ownMesh;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const lz0 = f.zs ?? f.z0, lz1 = f.z1;
    for (const [a, b] of [[f.x0, lz0], [f.x1, lz0], [f.x0, lz1], [f.x1, lz1]]) { const x = F.wx(a, b), z = F.wz(a, b); x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    x0 -= 1; x1 += 1; z0 -= 1; z1 += 1;     // (a metre round it: a kicker's own box starts half a metre above its z0)
    this.x0 = x0; this.x1 = x1; this.z0 = z0; this.z1 = z1;
  }
  height(x, z, g) { if (x < this.x0 || x > this.x1 || z < this.z0 || z > this.z1) return -Infinity; const l = this.F.loc(x, z); return this.f.height(l.x, l.z, g); }
  surface(x, z) { if (x < this.x0 || x > this.x1 || z < this.z0 || z > this.z1) return false; const l = this.F.loc(x, z); return this.f.surface ? this.f.surface(l.x, l.z) : false; }
}

/* ---- the local shapes ------------------------------------------------------------------------------------------------- */
// a lip across the way: its top at z 0, up `up` m of concave ramp to h, a face falling over `face` m; full across hw,
// easing off over `soft` (packed: surface 2, so a rider's tracks and the snow's look are the packed snow's)
class Lip {
  constructor(o) {
    Object.assign(this, { h: 1.2, up: 6, face: 3, hw: 3, soft: 3, packed: true, name: 'Side hit' }, o);
    this.x0 = -this.hw - this.soft; this.x1 = this.hw + this.soft; this.z0 = -this.up; this.z1 = this.face;
  }
  rel(x, z) {
    if (z < -this.up || z > this.face) return 0;
    const ax = Math.abs(x); if (ax > this.hw + this.soft) return 0;
    const across = ax <= this.hw ? 1 : 1 - smoothstep(this.hw, this.hw + this.soft, ax);
    const t = z <= 0 ? Math.pow((z + this.up) / this.up, 1.7) : 1 - smoothstep(0, this.face, z);
    return this.h * t * across;
  }
  height(x, z, g) { const r = this.rel(x, z); return r > 0.01 ? g + r : -Infinity; }
  surface(x, z) { return this.packed && this.rel(x, z) > 0.15; }
}
// a rock band across the way: a bench raised H(x) over `bench` m above it, its face from z 0 to `faceW` (rock), the
// natural slope below; ragged along its length, tapering at its ends
class Band {
  constructor(o) {
    Object.assign(this, { H: 4, hl: 16, bench: 14, seed: 1, name: 'Rock band' }, o);
    this.x0 = -this.hl - 4; this.x1 = this.hl + 4; this.z0 = -this.bench - 2; this.z1 = this.H * 0.35 + 2;
  }
  Hx(x) {
    const ax = Math.abs(x); if (ax > this.hl + 3) return 0;
    const end = 1 - smoothstep(this.hl - 6, this.hl + 3, ax);
    return this.H * end * (0.8 + 0.35 * simplex(x * 0.09 + this.seed * 7.3, this.seed));
  }
  // the face's foot along x (ragged a little)
  fz(x) { return 0.6 * simplex(x * 0.13 - this.seed, this.seed * 3.1); }
  rel(x, z) {
    const H = this.Hx(x); if (H <= 0.05) return 0;
    const z0 = this.fz(x), fw = 0.22 * H + 0.3;
    if (z < z0 - this.bench || z > z0 + fw) return 0;
    if (z <= z0) return H * smoothstep(z0 - this.bench, z0 - this.bench * 0.45, z);
    return H * (1 - (z - z0) / fw);
  }
  height(x, z, g) { const r = this.rel(x, z); return r > 0.01 ? g + r : -Infinity; }
  // the rock face: its own face and the bench's lip
  rock(x, z) { const H = this.Hx(x); if (H < 0.8) return false; const z0 = this.fz(x); return z > z0 - 0.8 && z < z0 + 0.22 * H + 0.8; }
  surface() { return false; }
}
// a snow ramp up to a rail's start (its start at z 0, rising over len m to h, then falling off fast past the start)
class Ramp {
  constructor(o) { Object.assign(this, { h: 0.4, len: 3.5, hw: 1.3, name: 'Ramp' }, o); this.x0 = -this.hw - 2; this.x1 = this.hw + 2; this.z0 = -this.len; this.z1 = 1.2; }
  rel(x, z) {
    if (z < -this.len || z > 1.2) return 0;
    let r = z <= 0 ? this.h * Math.pow((z + this.len) / this.len, 1.3) : this.h - z * (this.h / 1.2);
    r -= Math.max(0, Math.abs(x) - this.hw) * 0.9;
    return r;
  }
  height(x, z, g) { const r = this.rel(x, z); return r > 0.01 ? g + r : -Infinity; }
  surface(x, z) { return this.rel(x, z) > 0.05 && Math.abs(x) < this.hw; }
}

/* ---- placing them ------------------------------------------------------------------------------------------------------- */
const G = (x, z) => ground(x, z);
// the ground's fall line at a place: the unit way down (dx, dz) and its slope (rise over run)
function fall(x, z, s = 8) {
  const gx = (G(x + s, z) - G(x - s, z)) / (2 * s), gz = (G(x, z + s) - G(x, z - s)) / (2 * s), m = Math.hypot(gx, gz);
  return m < 1e-5 ? { dx: 0, dz: 1, m: 0 } : { dx: -gx / m, dz: -gz / m, m };
}

export function addFeatures(park, land, data, opts = {}) {
  const low = !!opts.low, r = rng(1234567), out = [], rocky = [], kickers = [], rails = [];
  const counts = { sideHits: 0, rollers: 0, windLips: 0, drops: 0, parks: 0, parkKickers: 0, parkRails: 0 };
  const inArea = (x, z) => land.elev.inFine(x, z, 80);
  const busy = [];                      // (places taken: [x, z, r])
  const free = (x, z, rad) => !busy.some(b => (b[0] - x) ** 2 + (b[1] - z) ** 2 < (b[2] + rad) ** 2);
  const take = (x, z, rad) => busy.push([x, z, rad]);
  const add = (f, F, name) => { const w = new Framed(f, F, name); out.push(w); return w; };

  // ---- the terrain parks first (they claim their ground)
  // (not a race course or a ski school's area, which some maps tag as parks: no jumps there)
  const parks = data.pistes.filter(p => p.park && p.pts.length >= 2 && !/stade|slalom|race|racing|course|rennstrecke|gara|kids|enfant|school|ecole|esf/i.test(p.name || ''));
  for (const P of parks) {
    // its fall line: from its highest point to its lowest
    let hi = null, lo = null;
    for (const p of P.pts) { if (!inArea(p.x, p.z)) continue; const y = G(p.x, p.z); if (!hi || y > hi.y) hi = { x: p.x, z: p.z, y }; if (!lo || y < lo.y) lo = { x: p.x, z: p.z, y }; }
    if (!hi || !lo) continue;
    const L = Math.hypot(lo.x - hi.x, lo.z - hi.z); if (L < 60 || hi.y - lo.y < 6) continue;
    const dx = (lo.x - hi.x) / L, dz = (lo.z - hi.z) / L, F = new F2(hi.x, hi.z, thOf(dx, dz));
    const base = z => G(F.wx(0, z), F.wz(0, z)), pitch = z => Math.atan((base(z - 0.5) - base(z + 0.5)) / 1.0);
    counts.parks++;
    // (a run that is not the park crossing its line: nothing built where it passes within 9 m)
    const others = data.pistes.filter(q => q !== P && !q.park && !q.area);
    const crossed = (za, zb) => {
      for (let zz = za; zz <= zb; zz += 3) for (const sx of [-4, 0, 4]) {
        const x = F.wx(sx, zz), z = F.wz(sx, zz);
        for (const q of others) for (let i = 0; i < q.pts.length - 1; i++) {
          const a = q.pts[i], b = q.pts[i + 1], m = Math.max(9, q.w / 2 + 4); if (Math.max(a.x, b.x) < x - m || Math.min(a.x, b.x) > x + m || Math.max(a.z, b.z) < z - m || Math.min(a.z, b.z) > z + m) continue;
          const ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez || 1; let t = ((x - a.x) * ex + (z - a.z) * ez) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
          if (Math.hypot(x - a.x - ex * t, z - a.z - ez * t) < Math.max(9, q.w / 2 + 4)) return true;   // (its own width and 4 m)
        }
      }
      return false;
    };
    let z = 18, k = 0;
    while (z < L - 40 && k < (low ? 4 : 6)) {
      const pz = (pitch(z) + pitch(z + 20) + pitch(z + 40)) / 3 / RAD;
      // a jump, sized by the slope there: a medium one where it is steep enough to feed it, a small one elsewhere
      const big = pz > 11 && L - z > 120;
      const o = big ? { lip: 27, R: 10, drop: 0.5, table: 9, Rk: 3.5, land: 30, wT: 2.7, wD: 4.6, wL: 7.5 } : { lip: 24, R: 7, drop: 0.35, table: 5, Rk: 3, land: 27, wT: 2.4, wD: 4, wL: 6.5 };
      if (pz < 4) { z += 20; continue; }
      const kk = new Kicker(Object.assign({ name: (P.name || 'Terrain park') + (big ? ' medium jump' : ' small jump'), x: 0, z0: z, base, pitch, group: 'World park', sideS: 0.62, landS: 0.55 }, o));
      if (kk.zMeet > L + 10) break;
      if (crossed(kk.z0 - 10, kk.zMeet + 4)) { z += 25; continue; }
      const w = add(kk, F, kk.name); kickers.push({ k: kk, F, w, park: counts.parks });
      take(F.wx(0, (kk.z0 + kk.zMeet) / 2), F.wz(0, (kk.z0 + kk.zMeet) / 2), (kk.zMeet - kk.z0) / 2 + 12);
      counts.parkKickers++; k++;
      z = kk.zMeet + 22;
      // a rail row: a box and a rail side by side, each on its snow ramp
      if (z < L - 30 && !crossed(z - 5, z + 12)) {
        for (const [sx, kind, h, len] of [[-3.2, 'box', 0.38, 9], [3.2, 'rail', 0.55, 10]]) {
          const zs = z, ze = z + len;
          const a = [F.wx(sx, zs), F.wz(sx, zs)], b = [F.wx(sx, ze), F.wz(sx, ze)];
          rails.push(new Rail({ name: (P.name || 'Terrain park') + (kind === 'box' ? ' box' : ' rail'), kind, pts: [[a[0], a[1], h], [b[0], b[1], h * 0.9]] }));
          add(new Ramp({ h: h - 0.06, len: 3.2, hw: kind === 'box' ? 1.3 : 1.1 }), new F2(F.wx(sx, zs - 0.4), F.wz(sx, zs - 0.4), F.th), 'Ramp');
          counts.parkRails++;
        }
        take(F.wx(0, z + 5), F.wz(0, z + 5), 14);
        z += 34;
      }
    }
  }

  // ---- side hits and rollers along the groomed runs
  const segs = [];
  for (const p of data.pistes) if (!p.park && !p.area && p.groom && p.pts.length >= 2) {
    let acc = 0;
    for (let i = 0; i < p.pts.length - 1; i++) {
      const a = p.pts[i], b = p.pts[i + 1], l = Math.hypot(b.x - a.x, b.z - a.z); if (l < 1) continue;
      for (let s = acc > 0 ? 0 : 30; s < l; s += 45) segs.push({ x: a.x + (b.x - a.x) * s / l, z: a.z + (b.z - a.z) * s / l, ux: (b.x - a.x) / l, uz: (b.z - a.z) / l, hw: p.w / 2, p });
      acc += l;
    }
  }
  // (a fair share of each run, in a random order, so the counts cap evenly)
  for (let i = segs.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = segs[i]; segs[i] = segs[j]; segs[j] = t; }
  const maxSide = low ? 40 : 80, maxRoll = low ? 16 : 30;
  for (const S of segs) {
    if (counts.sideHits >= maxSide && counts.rollers >= maxRoll) break;
    if (!inArea(S.x, S.z)) continue;
    const cy = G(S.x, S.z);
    // which way is down along the run here (the run's points may go either way)
    const fl = fall(S.x, S.z); let ux = S.ux, uz = S.uz; if (ux * fl.dx + uz * fl.dz < 0) { ux = -ux; uz = -uz; }
    const nx = -uz, nz = ux;      // across the run
    if (counts.sideHits < maxSide) for (const side of r() < 0.5 ? [-1, 1] : [1, -1]) {
      // the bank: the snow just past the run's edge, higher than the run's middle
      const e = S.hw + 3, bx = S.x + nx * side * e, bz = S.z + nz * side * e;
      const rise = G(bx, bz) - cy, rise2 = G(S.x + nx * side * (e + 6), S.z + nz * side * (e + 6)) - cy;
      if (rise < 1.2 || rise2 < rise + 0.3 || land.onRun(bx, bz) > 0.6 && land.groom(bx, bz) > 0.9) continue;
      if (!free(bx, bz, 14) || land.cliff(bx, bz)) continue;
      // facing back into the run and down it, at a diagonal
      let jx = -nx * side * 0.7 + ux * 0.75, jz = -nz * side * 0.7 + uz * 0.75; const jl = Math.hypot(jx, jz); jx /= jl; jz /= jl;
      const h = 0.9 + r() * 0.7;
      add(new Lip({ h, up: 5 + h * 2, face: 2.4 + h, hw: 2.5 + r() * 1.5, soft: 2.5, name: 'Side hit' }), new F2(bx, bz, thOf(jx, jz)), 'Side hit');
      take(bx, bz, 14); counts.sideHits++;
      break;
    }
    // a roller where the run steepens over a knoll (the slope 25 m on steeper than 25 m back)
    if (counts.rollers < maxRoll && free(S.x, S.z, 30)) {
      const back = (G(S.x - ux * 25, S.z - uz * 25) - cy) / 25, on = (cy - G(S.x + ux * 25, S.z + uz * 25)) / 25;
      if (on - back > 0.12 && back < 0.35 && r() < 0.7) {
        add(new Lip({ h: 0.7 + r() * 0.5, up: 9, face: 7, hw: Math.max(4, S.hw - 4), soft: 4, packed: false, name: 'Roller' }), new F2(S.x, S.z, thOf(ux, uz)), 'Roller');
        take(S.x, S.z, 30); counts.rollers++;
      }
    }
  }

  // ---- off the runs: rock drops and wind lips where the ground's shape has them
  const E = land.ext, step = 24, cand = [];
  for (let z = E.z0 + 200; z < E.z1 - 200; z += step) for (let x = E.x0 + 200; x < E.x1 - 200; x += step) {
    const jx = x + (r() - 0.5) * step, jz = z + (r() - 0.5) * step;
    if (land.onRun(jx, jz) > 0.02) continue;
    const f = fall(jx, jz, 10); if (f.m < 0.3) continue;
    // near a run (within about 250 m): somewhere riders can get to
    let near = false; for (let k = 0; k < 8 && !near; k++) { const a = k * Math.PI / 4; for (const d of [80, 160, 250]) if (land.onRun(jx + Math.cos(a) * d, jz + Math.sin(a) * d) > 0.3) { near = true; break; } }
    if (!near) continue;
    // its shape down the fall line: gentle above, steep below (a convex break)
    const y0 = G(jx, jz), up = (G(jx - f.dx * 18, jz - f.dz * 18) - y0) / 18, dn = (y0 - G(jx + f.dx * 18, jz + f.dz * 18)) / 18;
    const conv = Math.atan(dn) - Math.atan(up);
    if (conv < 8 * RAD) continue;
    cand.push({ x: jx, z: jz, f, up, dn, conv });
  }
  cand.sort((a, b) => b.conv - a.conv);
  const maxDrops = low ? 22 : 40, maxLips = low ? 12 : 22;
  /* the landing below a lip or a face: the snow from 8 to 48 m below along the way, no rock in it, no step steeper than
     about 42 degrees between samples and no flat (a landing is a slope of 20 to 42 degrees all the way down) */
  const landing = (F, z0) => {
    let prev = G(F.wx(0, z0), F.wz(0, z0));
    for (let zz = z0 + 4; zz <= z0 + 48; zz += 4) {
      const x = F.wx(0, zz), z = F.wz(0, zz), y = G(x, z), drop = (prev - y) / 4;
      if (drop > 0.9 || (zz > z0 + 8 && drop < 0.32) || land.cliff(x, z) || land.onRun(x, z) > 0.05) return false;
      prev = y;
    }
    return true;
  };
  // the way in: from `from` m up the way to the lip, no rock and nothing steeper than about 40 degrees (a run-in a rider
  // can ride; a drop above a cliff left riders sliding down the cliff)
  const runIn = (F, from) => {
    for (let zz = from; zz <= -2; zz += 4) for (const sx of [-3, 0, 3]) {
      const x = F.wx(sx, zz), z = F.wz(sx, zz);
      if (land.cliff(x, z) || land.ny(x, z, 4) < 0.76) return false;
    }
    return true;
  };
  for (const c of cand) {
    if (counts.drops >= maxDrops && counts.windLips >= maxLips) break;
    if (!inArea(c.x, c.z)) continue;
    const steepBelow = Math.atan(c.dn) / RAD;
    // a rock drop where it falls away steeply below (28 to 48 degrees), a wind lip on a gentler roll off a crest
    if (steepBelow > 27 && steepBelow < 48 && c.up > 0.3 && counts.drops < maxDrops && free(c.x, c.z, 60)) {
      let H = clamp(2 + (steepBelow - 27) / 21 * 6 + (r() - 0.5) * 1.5, 2, 8);
      const hl = clamp(10 + r() * 22, 10, 32), F = new F2(c.x, c.z, thOf(c.f.dx, c.f.dz));
      /* the bench above the face: long enough that the snow on it still slopes down the way (the raise over the bench is
         at most 0.45 of the slope above it, in its steepest part), else the face lower; a bench that would be uphill
         stopped riders on it */
      const upS = Math.max(0.05, c.up);
      let bench = 1.8 * H / (upS * 0.45);
      if (bench > 55) { H = Math.max(2, 55 * upS * 0.45 / 1.8); bench = 1.8 * H / (upS * 0.45); }
      if (bench > 60 || !landing(F, 0.5) || !runIn(F, -bench - 25)) continue;
      // (never across a run, nor right above one)
      let clear = true;
      for (let s = -hl; s <= hl && clear; s += 4) for (const zz of [-14, 0, 12]) if (land.onRun(F.wx(s, zz), F.wz(s, zz)) > 0.05) { clear = false; break; }
      if (!clear) continue;
      const b = new Band({ H, hl, bench: Math.max(10, bench), seed: counts.drops + 1 });
      const w = add(b, F, 'Rock drop'); rocky.push({ b, F });
      take(c.x, c.z, Math.max(30, hl + 12)); take(F.wx(0, 28), F.wz(0, 28), hl + 12); counts.drops++;   // (and its landing: no trees there)
    } else if (steepBelow >= 18 && steepBelow <= 34 && Math.atan(c.up) / RAD < 16 && counts.windLips < maxLips && free(c.x, c.z, 50)) {
      const F = new F2(c.x, c.z, thOf(c.f.dx, c.f.dz)), hw = 8 + r() * 12;
      let clear = true;
      for (let s = -hw; s <= hw && clear; s += 4) if (land.onRun(F.wx(s, 0), F.wz(s, 0)) > 0.05) clear = false;
      if (!clear || !landing(F, 2.5) || !runIn(F, -30)) continue;
      add(new Lip({ h: 1.2 + r() * 0.9, up: 7, face: 2.2, hw, soft: 5, packed: false, name: 'Wind lip' }), F, 'Wind lip');
      take(c.x, c.z, hw + 20); take(F.wx(0, 25), F.wz(0, 25), hw + 8); counts.windLips++;
    }
  }

  // ---- into the park: features, rails; rock faces marked on the rock raster (the physics' walls, the snow's rock)
  park.add(out);
  for (const k of rails) park.rails.push(k);
  if (land.cliffR) {
    const C = land.cliffR, a = C.a, n = C.n;
    for (const { b, F } of rocky) {
      for (let s = -b.hl - 2; s <= b.hl + 2; s += 1) for (let zz = -2; zz <= b.H * 0.3 + 2; zz += 0.5) {
        if (!b.rock(s, zz)) continue;
        const x = F.wx(s, zz), z = F.wz(s, zz), i = Math.floor((x - C.x0) * C.inv), j = Math.floor((z - C.z0) * C.inv);
        if (i >= 0 && j >= 0 && i < n && j < n) a[j * n + i] = 255;
      }
    }
  }
  counts.features = out.length;
  /* the parks' kickers' meshes: each a grid on its own rows and columns (park.js's), thinned (rows at least 0.35 m apart,
     0.6 on the low tier, columns 1.4 times that: as park.js's far copies), worked out in its frame, every point put in the
     world; a park's kickers merged into one mesh (a draw call a park, each left out when out of view) */
  const thinOut = (a, st) => { if (a.length < 3) return a; const o = [a[0]]; for (let i = 1; i < a.length - 1; i++) if (a[i] - o[o.length - 1] >= st) o.push(a[i]); o.push(a[a.length - 1]); return o; };
  const dress = (scene, mats, q) => {
    if (!kickers.length) return;
    const geos = new Map(), th = q.tier === 'low' ? 0.6 : q.tier === 'medium' ? 0.35 : 0.2;
    counts.kickerTris = 0;
    for (const { k, F, park: pk } of kickers) {
      const rows = thinOut(k.rows(!!q.fine), th), cols = thinOut(k.cols(!!q.fine), th * 1.4), nx = cols.length, nz = rows.length;
      const pos = new Float32Array(nx * nz * 3), keep = new Uint8Array(nx * nz), dye = new Float32Array(nx * nz), grm = new Float32Array(nx * nz).fill(0.65);
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const lx = cols[i], lz = rows[j], x = F.wx(lx, lz), z = F.wz(lx, lz), g = ground(x, z), v = j * nx + i;
        pos[v * 3] = x; pos[v * 3 + 1] = height(x, z); pos[v * 3 + 2] = z;
        const fy = k.height(lx, lz, g); keep[v] = fy > g + 0.003 && fy >= pos[v * 3 + 1] - 0.45 ? 1 : 0;
        dye[v] = k.dye ? k.dye(lx, lz) : 0;
      }
      const idx = [];
      for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        if (!(keep[a] | keep[b] | keep[c] | keep[d])) continue;
        idx.push(a, c, b, b, c, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aGroom', new THREE.BufferAttribute(grm, 1)); g.setAttribute('aDye', new THREE.BufferAttribute(dye, 1));
      g.setIndex(idx); g.computeVertexNormals();
      // (the winding: a frame turned any way keeps the grid's own; faces up whatever the turn)
      if (!geos.has(pk)) geos.set(pk, []); geos.get(pk).push(g);
    }
    import('three/addons/utils/BufferGeometryUtils.js').then(({ mergeGeometries }) => {
      for (const list of geos.values()) {
        const g = list.length > 1 ? mergeGeometries(list, false) : list[0];
        if (!g) continue;
        g.computeBoundingSphere();
        const m = new THREE.Mesh(g, mats.snow); m.name = 'World park kickers';
        m.receiveShadow = true; m.castShadow = false; m.matrixAutoUpdate = false; m.updateMatrixWorld();
        scene.add(m);
        counts.kickerTris += g.index.count / 3;
      }
    });
  };
  /* the rock field's heights: the ground with the features drawn by the terrain (the drops' faces, the lips), not the
     kickers (they have their own normals) */
  const fieldHeight = (x, z) => { const g = land.at(x, z), f = park.heightTerrainOnly(x, z, g); return f > g ? f : g; };
  // (a place a feature has taken: its run-in, itself and its landing; no trees there: wmap.js)
  const taken = (x, z) => !free(x, z, 2);
  return { counts, dress, fieldHeight, out, taken };
}
