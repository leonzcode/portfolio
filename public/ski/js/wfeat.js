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
import { Kicker, Rail } from './park.js?v=33';
import { ground, height } from './terrain.js?v=33';
import { smoothstep, clamp, simplex, rng } from './noise.js?v=33';

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
/* (W, round 11) a rock band whose face height comes from the elevation measured across a real cliff (or a step the
   elevation itself has), not from a random number: Hs[] the heights at x = xs0, xs0 + dx, ... along it, eased off over
   the last metres at either end */
class DataBand extends Band {
  constructor(o) { super(o); this.x0 = this.xs0 - 4; this.x1 = this.xs0 + this.dx * (this.Hs.length - 1) + 4; }
  Hx(x) {
    const u = (x - this.xs0) / this.dx, n = this.Hs.length;
    if (u < -1.2 || u > n - 1 + 1.2) return 0;
    const i = Math.max(0, Math.min(n - 2, Math.floor(u))), t = Math.max(0, Math.min(1, u - i));
    const h = n > 1 ? this.Hs[i] * (1 - t) + this.Hs[i + 1] * t : this.Hs[0];
    const end = Math.min(smoothstep(-1.2, 0.6, u), 1 - smoothstep(n - 1.6, n - 1 + 1.2, u));
    return h * end;
  }
  fz() { return 0; }
}
/* (W, round 11) a mapped halfpipe (man_made=piste:halfpipe, or a run named one): walls of the game's superpipe's cross
   section (park.js Pipe's: a flat bottom, quarter circles to a short vert, a deck, the outside slope) along its mapped
   line, the floor a plane at a steady grade laid over the ground (snow is built up, never dug), x across, z down it */
class WPipe {
  constructor(o) {
    Object.assign(this, { F: 6.5, R: 5.4, vert: 0.4, deck: 3.5, entry: 14, exit: 10, len: 120, name: 'Halfpipe', floor0: 0, grade: 0.3 }, o);
    this.ownMesh = true; this.H = this.R + this.vert; this.out = this.R + 0.15 + this.deck;
    const half = this.F + this.out + (this.H + (this.raise || 0)) / 0.7 + 1;
    this.x0 = -half; this.x1 = half; this.z0 = -2; this.z1 = this.len + 2; this.x = 0;
  }
  wall(a) {
    const { R, vert, deck, H } = this;
    if (a <= 0) return 0;
    if (a < R * 0.995) return R - Math.sqrt(R * R - a * a);
    const r0 = R - Math.sqrt(R * R - (R * 0.995) ** 2);
    if (a < R + 0.15) { const t = (a - R * 0.995) / (R + 0.15 - R * 0.995); return r0 + t * (H - r0); }
    if (a < R + 0.15 + deck) return H;
    return Math.max(0, H - (a - R - 0.15 - deck) * 0.7);
  }
  scale(z) { return smoothstep(0, this.entry, z) * (1 - smoothstep(this.len - this.exit, this.len, z)); }
  floor(z) { return this.floor0 - this.grade * z; }
  height(x, z, g) {
    if (z < 0 || z > this.len || x < this.x0 || x > this.x1) return -Infinity;
    const s = this.scale(z); if (s <= 0.002) return -Infinity;
    // (past the deck the outside slope runs on down until it meets the ground: the floor may stand over the ground)
    const a = Math.abs(x) - this.F, f = this.floor(z), y = a > this.out ? f + this.H * s - (a - this.out) * 0.7 : f + this.wall(a) * s;
    // (the floor eases into the ground at either end)
    const e = Math.min(1, z / 14, (this.len - z) / 10);
    return g + (y - g) * Math.max(0, e);
  }
  surface(x, z) { return z > 0 && z < this.len && Math.abs(x) < this.F + this.R + this.deck; }
  rows(fine) { const r = []; for (let z = -0.5; z <= this.len + 0.5; z += fine ? 1.2 : 2.0) r.push(z); return r; }
  cols(fine) {
    const half = [], st0 = fine ? 0.3 : 0.5, flat = fine ? 1.0 : 1.6, aW = this.R + 0.3;
    let a = -this.F, prev = this.wall(a); half.push(a);
    const end = this.out + (this.H + (this.raise || 0)) / 0.7 + 1;
    while (a < end) {
      const st = a < -0.5 ? Math.min(flat, -a) : a < aW ? st0 : flat; let da = st;
      for (let k = 0; k < 6; k++) { const y = this.wall(a + da); const l = Math.hypot(da, y - prev); if (l > st * 1.05) da *= st / l; else break; }
      da = Math.max(da, 0.008); a += da; prev = this.wall(a); half.push(a);
    }
    const c = []; for (const v of half) c.push(this.F + v, -this.F - v);
    return [...new Set(c.map(v => Math.round(v * 1000) / 1000))].filter(v => v >= this.x0 && v <= this.x1).sort((p, q) => p - q);
  }
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
  /* (W, round 11, for Leon's "make features/jibs that are in actual places on the ski slope be there") What the map
     says is a park (wosm.js parse: piste:type=snow_park, a mapped halfpipe, a run named a terrain park). OpenStreetMap
     has no tags for single jumps or rails (none in any of the 17 built-in places' data, nor in taginfo), so:
     - a mapped halfpipe (man_made=piste:halfpipe, or a run or area named a halfpipe or superpipe) gets a pipe along its
       real line: real data;
     - any other park: a line of jumps and rails laid along its real line inside its real outline, our own layout
       (marked generated, and the trail map says so).
     Not a race course, a ski school's or kids' area, a boardercross or a speed course, which some maps tag as parks. */
  const L = opts.L || null, marks = [], parkList = [];
  const mark = (kind, name, x, z, yaw, src) => marks.push({ kind, name, x, z, yaw, src, generated: src === 'generated' });
  const NOT_PARK = /stade|slalom|race|racing|course|rennstrecke|gara|kids|kinder|enfant|school|ecole|esf|boarder ?cross|border ?cross|ski ?cross|vitesse|speed|family|famille|aventure|adventure|(exit|access|return|road|traverse|connector)/i;
  // the real halfpipes: the runs and areas marked as one, and the land cover's own (man_made=piste:halfpipe with no run)
  const pipes = data.pistes.filter(p => p.pipe && p.pts.length >= 2).map(p => ({ pts: p.pts, name: p.name || 'Halfpipe', area: p.area, src: p }));
  if (L) for (const q of L.pipes) {
    const c = q.pts[Math.floor(q.pts.length / 2)];
    if (!pipes.some(p => p.pts.some(r => Math.hypot(r.x - c.x, r.z - c.z) < 60))) pipes.push({ pts: q.pts, name: 'Halfpipe', area: q.area, src: null });
  }
  // (a pipe area and its line are one pipe: the line kept)
  for (let i = pipes.length - 1; i >= 0; i--) if (pipes[i].area && pipes.some((p, j) => j !== i && !p.area && p.pts.some(r => pipes[i].pts.some(s => Math.hypot(r.x - s.x, r.z - s.z) < 40)))) pipes.splice(i, 1);
  for (const Pp of pipes) {
    let hi = null, lo = null;
    for (const p of Pp.pts) { if (!inArea(p.x, p.z)) continue; const y = G(p.x, p.z); if (!hi || y > hi.y) hi = { x: p.x, z: p.z, y }; if (!lo || y < lo.y) lo = { x: p.x, z: p.z, y }; }
    if (!hi || !lo) continue;
    let Lp = Math.hypot(lo.x - hi.x, lo.z - hi.z), dx, dz;
    if (Lp < 30) {        // (a point or a stub: a pipe down the fall line from its middle)
      const f = fall(hi.x, hi.z, 10); dx = f.dx; dz = f.dz; const len0 = 90; hi = { x: (hi.x + lo.x) / 2 - dx * len0 / 2, z: (hi.z + lo.z) / 2 - dz * len0 / 2 }; Lp = len0;
    } else { dx = (lo.x - hi.x) / Lp; dz = (lo.z - hi.z) / Lp; }
    const len = Math.max(60, Math.min(170, Lp));
    // (down the fall line, as pipes are cut, where the mapped line runs within 35 degrees of it: across a slope the pipe
    // would stand metres over the snow on its low side)
    { const fm = fall(hi.x + dx * len / 2, hi.z + dz * len / 2, 25); if (fm.m > 0.05 && fm.dx * dx + fm.dz * dz > Math.cos(35 * RAD)) { const sx = hi.x + dx * len / 2 - fm.dx * len / 2, sz = hi.z + dz * len / 2 - fm.dz * len / 2; hi = { x: sx, z: sz }; dx = fm.dx; dz = fm.dz; } }
    const F = new F2(hi.x, hi.z, thOf(dx, dz)), W = 6.5 + 5.4 + 0.15 + 3.5;
    // the floor: a plane fitted down the highest snow across the pipe, lifted to clear it (snow is built up, not dug)
    const mx = [], mn = [];
    for (let z = 0; z <= len; z += 4) { let a = -Infinity, b = Infinity; for (let x = -W; x <= W; x += 2) { const y = G(F.wx(x, z), F.wz(x, z)); if (y > a) a = y; if (y < b) b = y; } mx.push([z, a]); mn.push(b); }
    let sz = 0, sy = 0, szz = 0, szy = 0; for (const [z, a] of mx) { sz += z; sy += a; szz += z * z; szy += z * a; }
    const nn = mx.length, slope = (nn * szy - sz * sy) / Math.max(1e-6, nn * szz - sz * sz), grade = clamp(-slope, 0.12, 0.45);
    let f0 = -Infinity; for (const [z, a] of mx) if (z >= 10 && z <= len - 8) f0 = Math.max(f0, a + grade * z); if (!Number.isFinite(f0)) f0 = mx[0][1]; f0 += 0.1;
    // (dropped into from above: never starting higher than the snow at its top; lower down the snow may then show through
    // its floor on the high side, which the ground's own height keeps smooth)
    f0 = Math.min(f0, G(F.wx(0, 0), F.wz(0, 0)) + 0.3);
    let raise = 0; mx.forEach(([z], i) => { raise = Math.max(raise, f0 - grade * z - mn[i]); });
    if (raise > 9) continue;              // (across a slope too steep for a pipe to stand on)
    const pp = new WPipe({ name: Pp.name, len, floor0: f0, grade, raise });
    const w = add(pp, F, Pp.name); kickers.push({ k: pp, F, w, park: 'pipe' + counts.parks });
    take(F.wx(0, len / 2), F.wz(0, len / 2), len / 2 + 14);
    counts.parks++; counts.pipes = (counts.pipes || 0) + 1;
    mark('pipe', Pp.name, F.wx(0, len / 2), F.wz(0, len / 2), F.th, 'osm');
    parkList.push({ name: Pp.name, pts: Pp.pts, area: !!Pp.area, generated: false, built: true, real: ['halfpipe (' + (Pp.src ? 'man_made=piste:halfpipe or its name' : 'man_made=piste:halfpipe') + ')'], gen: [] });
    if (Pp.src) Pp.src.pipeBuilt = true;
  }
  const parks = data.pistes.filter(p => p.park && !p.pipe && !p.pipeBuilt && p.pts.length >= 2 && !NOT_PARK.test(p.name || ''));
  const sameAs = P => parkList.find(e => e.built && e.generated && e.pts.some(r => P.pts.some(s => Math.hypot(r.x - s.x, r.z - s.z) < 25)));
  for (const P of parks) {
    const entry = { name: P.name || 'Terrain park', pts: P.pts, area: !!P.area, generated: true, real: ['its outline or line (' + (P.snowPark ? 'piste:type=snow_park' : 'a run named a park') + ')'], gen: [] };
    // (inside a park already laid out, as a park's area and its line often both are: once)
    const twin = sameAs(P);
    parkList.push(entry);
    if (twin) { entry.gen.push('none: the same park as ' + twin.name); continue; }
    // its fall line: from its highest point to its lowest
    let hi = null, lo = null;
    for (const p of P.pts) { if (!inArea(p.x, p.z)) continue; const y = G(p.x, p.z); if (!hi || y > hi.y) hi = { x: p.x, z: p.z, y }; if (!lo || y < lo.y) lo = { x: p.x, z: p.z, y }; }
    if (!hi || !lo) { entry.gen.push('none: outside the area built'); continue; }
    const L2 = Math.hypot(lo.x - hi.x, lo.z - hi.z); if (L2 < 60 || hi.y - lo.y < 6) { entry.gen.push('none: too short or flat (' + Math.round(L2) + ' m, ' + Math.round(hi.y - lo.y) + ' m down)'); continue; }
    const dx = (lo.x - hi.x) / L2, dz = (lo.z - hi.z) / L2, F = new F2(hi.x, hi.z, thOf(dx, dz));
    const base = z => G(F.wx(0, z), F.wz(0, z)), pitch = z => Math.atan((base(z - 0.5) - base(z + 0.5)) / 1.0);
    counts.parks++; entry.built = true;
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
    while (z < L2 - 40 && k < (low ? 4 : 6)) {
      const pz = (pitch(z) + pitch(z + 20) + pitch(z + 40)) / 3 / RAD;
      // a jump, sized by the slope there: a medium one where it is steep enough to feed it, a small one elsewhere
      const big = pz > 11 && L2 - z > 120;
      const o = big ? { lip: 27, R: 10, drop: 0.5, table: 9, Rk: 3.5, land: 30, wT: 2.7, wD: 4.6, wL: 7.5 } : { lip: 24, R: 7, drop: 0.35, table: 5, Rk: 3, land: 27, wT: 2.4, wD: 4, wL: 6.5 };
      if (pz < 4) { z += 20; continue; }
      const kk = new Kicker(Object.assign({ name: (P.name || 'Terrain park') + (big ? ' medium jump' : ' small jump'), x: 0, z0: z, base, pitch, group: 'World park', sideS: 0.62, landS: 0.55 }, o));
      if (kk.zMeet > L2 + 10) break;
      if (crossed(kk.z0 - 10, kk.zMeet + 4)) { z += 25; continue; }
      const w = add(kk, F, kk.name); kickers.push({ k: kk, F, w, park: counts.parks });
      take(F.wx(0, (kk.z0 + kk.zMeet) / 2), F.wz(0, (kk.z0 + kk.zMeet) / 2), (kk.zMeet - kk.z0) / 2 + 12);
      counts.parkKickers++; k++; entry.gen.push(big ? 'medium jump' : 'small jump');
      mark('jump', kk.name, F.wx(0, (kk.z0 + kk.zMeet) / 2), F.wz(0, (kk.z0 + kk.zMeet) / 2), F.th, 'generated');
      z = kk.zMeet + 22;
      // a rail row: a box and a rail side by side, each on its snow ramp
      if (z < L2 - 30 && !crossed(z - 5, z + 12)) {
        for (const [sx, kind, h, len] of [[-3.2, 'box', 0.38, 9], [3.2, 'rail', 0.55, 10]]) {
          const zs = z, ze = z + len;
          const a = [F.wx(sx, zs), F.wz(sx, zs)], b = [F.wx(sx, ze), F.wz(sx, ze)];
          rails.push(new Rail({ name: (P.name || 'Terrain park') + (kind === 'box' ? ' box' : ' rail'), kind, pts: [[a[0], a[1], h], [b[0], b[1], h * 0.9]] }));
          add(new Ramp({ h: h - 0.06, len: 3.2, hw: kind === 'box' ? 1.3 : 1.1 }), new F2(F.wx(sx, zs - 0.4), F.wz(sx, zs - 0.4), F.th), 'Ramp');
          counts.parkRails++; entry.gen.push(kind);
          mark(kind, (P.name || 'Terrain park') + ' ' + kind, F.wx(sx, zs + len / 2), F.wz(sx, zs + len / 2), F.th, 'generated');
        }
        take(F.wx(0, z + 5), F.wz(0, z + 5), 14);
        z += 34;
      }
    }
    if (!entry.gen.length) entry.gen.push('none: no stretch steep enough for a jump, or runs crossing it');
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
      take(bx, bz, 14); counts.sideHits++; mark('side hit', 'Side hit', bx, bz, thOf(jx, jz), 'generated');
      break;
    }
    // a roller where the run steepens over a knoll (the slope 25 m on steeper than 25 m back)
    if (counts.rollers < maxRoll && free(S.x, S.z, 30)) {
      const back = (G(S.x - ux * 25, S.z - uz * 25) - cy) / 25, on = (cy - G(S.x + ux * 25, S.z + uz * 25)) / 25;
      if (on - back > 0.12 && back < 0.35 && r() < 0.7) {
        add(new Lip({ h: 0.7 + r() * 0.5, up: 9, face: 7, hw: Math.max(4, S.hw - 4), soft: 4, packed: false, name: 'Roller' }), new F2(S.x, S.z, thOf(ux, uz)), 'Roller');
        take(S.x, S.z, 30); counts.rollers++; mark('roller', 'Roller', S.x, S.z, thOf(ux, uz), 'generated');
      }
    }
  }

  // ---- off the runs: wind lips where the ground's shape has them (a convex break: gentle above, steeper below)
  const E = land.ext, step = 24, cand = [];
  for (let z = E.z0 + 200; z < E.z1 - 200; z += step) for (let x = E.x0 + 200; x < E.x1 - 200; x += step) {
    const jx = x + (r() - 0.5) * step, jz = z + (r() - 0.5) * step;
    if (land.onRun(jx, jz) > 0.02) continue;
    const f = fall(jx, jz, 10); if (f.m < 0.3) continue;
    // near a run (within about 250 m): somewhere riders can get to
    let near = false; for (let k = 0; k < 8 && !near; k++) { const a = k * Math.PI / 4; for (const d of [80, 160, 250]) if (land.onRun(jx + Math.cos(a) * d, jz + Math.sin(a) * d) > 0.3) { near = true; break; } }
    if (!near) continue;
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
  const runIn = (F, from, to = -2) => {
    for (let zz = from; zz <= to; zz += 4) for (const sx of [-3, 0, 3]) {
      const x = F.wx(sx, zz), z = F.wz(sx, zz);
      if (land.cliff(x, z) || land.ny(x, z, 4) < 0.76) return false;
    }
    return true;
  };
  for (const c of cand) {
    if (counts.windLips >= maxLips) break;
    if (!inArea(c.x, c.z)) continue;
    const steepBelow = Math.atan(c.dn) / RAD;
    if (steepBelow >= 18 && steepBelow <= 34 && Math.atan(c.up) / RAD < 16 && free(c.x, c.z, 50)) {
      const F = new F2(c.x, c.z, thOf(c.f.dx, c.f.dz)), hw = 8 + r() * 12;
      let clear = true;
      for (let s = -hw; s <= hw && clear; s += 4) if (land.onRun(F.wx(s, 0), F.wz(s, 0)) > 0.05) clear = false;
      if (!clear || !landing(F, 2.5) || !runIn(F, -30)) continue;
      add(new Lip({ h: 1.2 + r() * 0.9, up: 7, face: 2.2, hw, soft: 5, packed: false, name: 'Wind lip' }), F, 'Wind lip');
      take(c.x, c.z, hw + 20); take(F.wx(0, 25), F.wz(0, 25), hw + 8); counts.windLips++;
      mark('wind lip', 'Wind lip', c.x, c.z, F.th, 'generated');
    }
  }
  /* ---- rock drops (W, round 11, for "make the rock and cliff more accurate for real ski mountains"): only where the rock
     is: along OpenStreetMap's mapped cliffs (natural=cliff), and where the elevation itself steps (steeper than about 46
     degrees over 8 m, and the drop across the step more than the slope round it gives); none from a guess. Each face is
     as tall as the elevation measured across it there: the drop over 10 m either side less what the slope over 40 m
     either side would give, eased along the face, 1.5 to 9 m (a taller cliff is left a rock wall). Never on a groomed
     run: a mapped cliff across one keeps the run smooth and its rock beside it (wland.js). */
  counts.dropsOsm = 0; counts.dropsDem = 0; counts.dropsRandom = 0; counts.cliffPieces = 0;
  const stepAcross = (x, z, nx, nz) => {
    const d10 = G(x - nx * 10, z - nz * 10) - G(x + nx * 10, z + nz * 10), d40 = G(x - nx * 40, z - nz * 40) - G(x + nx * 40, z + nz * 40);
    return Math.max(0, d10 - d40 / 80 * 20);
  };
  const onGroomed = (x, z) => land.groom(x, z) > 0.2 || land.onRun(x, z) > 0.3;
  const pieces = [];
  // the mapped cliffs, cut into straight pieces of 9 to 24 m where the elevation steps 1.5 m or more across them
  if (L) for (const l of L.cliff) {
    if (!l.some(p => land.elev.inFine(p.x, p.z, 0))) continue;
    const S = [];
    for (let i = 0; i < l.length - 1; i++) {
      const a = l[i], b = l[i + 1], len = Math.hypot(b.x - a.x, b.z - a.z); if (len < 0.5) continue;
      const tx = (b.x - a.x) / len, tz = (b.z - a.z) / len;
      for (let s = 0; s < len; s += 3) {
        const x = a.x + tx * s, z = a.z + tz * s;
        if (!inArea(x, z)) { S.push({ x, z, tx, tz, nx: 1, nz: 0, D: 0, ok: false }); continue; }
        // (the low side: OpenStreetMap draws a cliff with its face on the right; the elevation decides where it is clear)
        let nx = -tz, nz = tx; const dd = G(x - nx * 12, z - nz * 12) - G(x + nx * 12, z + nz * 12);
        if (dd < -1) { nx = -nx; nz = -nz; }
        S.push({ x, z, tx: dd < -1 ? -tx : tx, tz: dd < -1 ? -tz : tz, nx, nz, D: inArea(x, z) ? stepAcross(x, z, nx, nz) : 0, ok: inArea(x, z) && !onGroomed(x, z) && !onGroomed(x + nx * 8, z + nz * 8) && !onGroomed(x - nx * 8, z - nz * 8) });
      }
    }
    let cur = [];
    const flush = () => { if (cur.length >= 4) pieces.push({ S: cur, src: 'osm' }); cur = []; };
    for (const s of S) {
      const good = s.ok && s.D >= 1.5 && s.D <= 14;
      if (!good) { flush(); continue; }
      if (cur.length && (cur.length >= 8 || cur[0].nx * s.nx + cur[0].nz * s.nz < 0.9)) flush();
      cur.push(s);
    }
    flush();
  }
  counts.cliffPieces = pieces.length;
  // the elevation's own steps (where no cliff is mapped): from the convex breaks above
  for (const c of cand) {
    if (pieces.length > 400) break;
    if (!inArea(c.x, c.z) || onGroomed(c.x, c.z)) continue;
    const D = stepAcross(c.x, c.z, c.f.dx, c.f.dz);
    if (D < 2 || D > 14 || land.ny(c.x + c.f.dx * 8, c.z + c.f.dz * 8, 4) > 0.7) continue;
    if (land.cliffW && land.cliffW.at(c.x, c.z) > 0.1) continue;       // (a mapped cliff is there: done above)
    const tx = c.f.dz, tz = -c.f.dx, S = [];
    for (let k = -3; k <= 3; k++) { const x = c.x + tx * k * 3, z = c.z + tz * k * 3; S.push({ x, z, tx, tz, nx: c.f.dx, nz: c.f.dz, D: stepAcross(x, z, c.f.dx, c.f.dz) }); }
    pieces.push({ S, src: 'dem' }); counts.demPieces = (counts.demPieces || 0) + 1;
  }
  counts.cand = cand.length;
  // nearest the runs first (where riders can get to them)
  const nearRun = (x, z) => { for (const d of [40, 90, 160, 250]) for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; if (land.onRun(x + Math.cos(a) * d, z + Math.sin(a) * d) > 0.3) return d; } return 999; };
  for (const P of pieces) { const m = P.S[P.S.length >> 1]; P.m = m; P.near = nearRun(m.x, m.z); }
  pieces.sort((a, b) => a.near - b.near);
  const why = counts.dropWhy = { far: 0, low: 0, taken: 0, bench: 0, landing: 0, runIn: 0, run: 0 };
  for (const P of pieces) {
    if (counts.drops >= maxDrops) break;
    if (P.near > 300) { why.far++; continue; }
    const m = P.m; let nx = 0, nz = 0; for (const s of P.S) { nx += s.nx; nz += s.nz; } const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
    const F = new F2(m.x, m.z, thOf(nx, nz)), xs = P.S.map(s => F.loc(s.x, s.z).x), x0 = Math.min(...xs), x1 = Math.max(...xs);
    // (the face's heights along it, from the elevation, at 3 m steps, eased over two samples either side)
    const n = Math.max(2, Math.round((x1 - x0) / 3) + 1), Hs = [];
    for (let i = 0; i < n; i++) { const lx = x0 + (x1 - x0) * i / (n - 1); let best = P.S[0], bd = Infinity; for (const s of P.S) { const d = Math.abs(F.loc(s.x, s.z).x - lx); if (d < bd) { bd = d; best = s; } } Hs.push(best.D); }
    const Hm = Hs.map((h, i) => Math.min(9, (Hs[Math.max(0, i - 1)] + 2 * h + Hs[Math.min(n - 1, i + 1)]) / 4));
    const H = Math.max(...Hm); if (H < 1.5) { why.low++; continue; }
    const hl = (x1 - x0) / 2; if (!free(m.x, m.z, Math.max(20, hl + 8))) { why.taken++; continue; }
    // the bench above the face: long enough that the snow on it still slopes down the way (as the old drops)
    const upS = Math.max(0.05, (G(F.wx(0, -30), F.wz(0, -30)) - G(F.wx(0, -5), F.wz(0, -5))) / 25);
    // (a gentle slope above makes a long bench; past 100 m the face is kept lower, as the slope above allows)
    let bench = 1.8 * H / (upS * 0.45), Hk = 1;
    if (bench > 100) { Hk = 100 / bench; bench = 100; }
    if (H * Hk < 1.5) { why.bench++; continue; }
    // (a landing below: from 8 m on, no other rock, not too steep, not flat; a way in above)
    let ok = true, prev = G(F.wx(0, 8), F.wz(0, 8));
    for (let zz = 12; zz <= 40 && ok; zz += 4) { const x = F.wx(0, zz), z = F.wz(0, zz), y = G(x, z), drop = (prev - y) / 4; if (drop > (zz < 20 ? 1.5 : 1.0) || (zz > 16 && drop < 0.2) || (zz > 18 && land.cliff(x, z)) || land.onRun(x, z) > 0.05) ok = false; prev = y; }
    if (!ok) { why.landing++; continue; }
    // (the way in above the bench: the bench itself is built over the slope there)
    if (!runIn(F, -Math.max(10, bench) - 25, -Math.max(10, bench))) { why.runIn++; continue; }
    let clear = true;
    for (let s = x0 - 3; s <= x1 + 3 && clear; s += 4) for (const zz of [-14, 0, 12]) if (land.onRun(F.wx(s, zz), F.wz(s, zz)) > 0.05) { clear = false; break; }
    if (!clear) { why.run++; continue; }
    const b = new DataBand({ H: H * Hk, hl: Math.max(hl, 4), bench: Math.max(10, bench), xs0: x0, dx: (x1 - x0) / (n - 1), Hs: Hm.map(h => h * Hk), seed: counts.drops + 1, name: P.src === 'osm' ? 'Cliff drop' : 'Rock drop' });
    add(b, F, b.name); rocky.push({ b, F });
    take(m.x, m.z, Math.max(30, hl + 12)); take(F.wx(0, 28), F.wz(0, 28), hl + 12); counts.drops++;
    if (P.src === 'osm') counts.dropsOsm++; else counts.dropsDem++;
    mark('rock drop', b.name + ' (' + (H * Hk).toFixed(1) + ' m)', m.x, m.z, F.th, P.src);
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
  return { counts, dress, fieldHeight, out, taken, marks, parks: parkList };
}
