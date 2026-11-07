/* Freeride: the made-up big-mountain venue (2026-11-06). The land (frland.js) is the height function; this puts it in
   the game through the same hook a real mountain uses (terrain.js setMountain), with a park of its own: kickers built
   on the rock bands as Natural Selection's are (park.js Kickers on the land's own slope, their lips on the rock, the
   gap the rock band, the landing the steep apron under it), logs, a rock slab and stumps to slide (park.js Rails, drawn
   here), the start pads on the summit ridge, the trees, and the chairlift's line from the bottom to the ridge
   (lift.js planLift reads park.liftLine). The rock meshes are frrock.js's. */
import { Land, LIFT_X } from './frland.js?v=18';
import { Kicker, Rail, assemble } from './park.js?v=18';
import { setMountain } from './terrain.js?v=18';
import { simplex } from './noise.js?v=18';

const RAD = Math.PI / 180;

/* A kicker built on the rock (Natural Selection's way): a snow takeoff on the bench just above a rock band, its lip
   1.3 m short of the rock's edge; past the lip there is no table, the gap is the band's rock face, the landing the
   natural apron under it (30 to 39 degrees). Built as a park.js Kicker standing on the land's own slope (base, pitch)
   with its deck sunk under the snow, then given its own design speeds from a flight over the real snow to the landing
   it is aimed at (gap metres out from the lip). */
class RockKicker extends Kicker {
  constructor(land, o) {
    const G = land.G, x = o.x;
    const base = z => G(x, z), pitch = z => Math.atan((G(x, z - 0.3) - G(x, z + 0.3)) / 0.6);
    // the takeoff's foot placed so its lip comes out where it is wanted
    let z0 = o.lipZ - 8;
    for (let it = 0; it < 4; it++) { const p = pitch(z0), lip = o.lip * RAD; z0 = o.lipZ - o.R * (Math.sin(p) + Math.sin(lip)); }
    super(Object.assign({ base, pitch, z0, drop: 40, table: 1, land: 55, Rk: 1, wD: o.wT * 2 + 1, wL: o.wT + 2, sideS: 0.62, landS: 0.62, group: 'Freeride kickers' }, o));
    this.rock = true;
    /* the design speeds. Off a lip onto a natural steep apron the landing is soft only where the flight comes down
       nearly along the snow, so the speed off the lip is the one that lands softest (least speed into the snow) at least
       `gap` m out (the game's air drag, the real snow along the centre line); then up the ramp to it */
    const lip = this.lip * RAD, kd = 0.5 * 1.2 * 0.5 / 78, dt = 0.004;
    let best = null;
    for (let v = 10; v <= 18; v += 0.25) {
      let vz = v * Math.cos(lip), vy = v * Math.sin(lip), z = this.L.z, y = this.L.y;
      for (let t = 0; t < 6; t += dt) {
        const sp = Math.hypot(vz, vy); vz -= kd * sp * vz * dt; vy -= (9.81 + kd * sp * vy) * dt; z += vz * dt; y += vy * dt;
        const gy = G(x, z);
        if (z > this.L.z + 0.5 && y <= gy) {
          const th = Math.atan((G(x, z - 0.5) - G(x, z + 0.5)) / 1.0), vn = -vy * Math.cos(th) - vz * Math.sin(th);
          if (z - this.L.z >= this.gap && (!best || vn < best.vn - 0.05)) best = { v, vn, X: z - this.L.z, th };
          break;
        }
      }
    }
    this.vLip = best ? best.v : 12; this.landVn = best ? best.vn : 0; this.gapX = best ? best.X : this.gap;
    const target = this.L.z + this.gapX;
    const rise = this.L.y - base(this.z0);
    this.vDesign = Math.sqrt(this.vLip * this.vLip + 2 * 9.81 * rise * (1.12 + 0.02 * rise)) + 0.5;
    // the landing zone (the flags on its top edge, the filmer camera beside its foot)
    const yl = G(x, target);
    this.K = { z: target - 4, y: G(x, target - 4) }; this.Kend = { z: target, y: yl }; this.zMeet = target + 12;
    this.landDeg = Math.atan((G(x, target - 1) - G(x, target + 1)) / 2) / RAD;
  }
  // nothing past the back face of the lip: no table, no knuckle, no landing of its own (they would bridge the gap)
  rel(z, d) { return z > this.L.z + 2 ? -Infinity : super.rel(z, d); }
  // only the takeoff and its lip have snow above the ground: no rows over the sunk deck
  rows(fine) {
    const r = [], st = fine ? 0.6 : 1.0;
    for (let z = this.z0 - 0.5; z < this.L.z; z += st) r.push(z);
    for (let z = this.L.z - 0.6; z < this.L.z + 1.4; z += fine ? 0.06 : 0.1) r.push(z);
    r.push(this.L.z, this.L.z - 0.005, this.L.z - 0.2, this.L.z - 0.17, this.L.z + 0.03, this.zBack, this.L.z + 2);
    return [...new Set(r.map(v => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
  }
  // the dye line along the lip only (the knuckle is the rock's edge)
  dye(x, z) { return Math.abs(z - this.L.z + 0.08) < 0.1 && Math.abs(x - this.x) < this.wT ? 1 : 0; }
  surface(x, z) { return z > this.z0 && z < this.L.z + 0.5 && Math.abs(x - this.cxT) < this.hwT + 1.5; }
}

// the land's band by name (the kickers and logs are put on them)
const bandOf = (land, name) => land.features.find(f => f.name === name);

export function makeFreeride(q) {
  const land = new Land(), G = land.G;
  // ---- the mountain, through terrain.js's hook: no extra noise (bare), its own surfaces
  let park = null;
  const mtn = {
    bare: true, at: (x, z) => land.at(x, z), land,
    // packed snow on the built features, deep snow everywhere else
    surface: (x, z) => park && park.surface(x, z) ? 2 : 1,
  };
  setMountain(mtn);

  // ---- kickers on the rock: [band, x, lip deg, R, half width, gap m]
  const K = [];
  const onBand = (name, x, lip, R, wT, gap, label) => {
    const b = bandOf(land, name), lipZ = b.zL(x) - 1.3;
    const k = new RockKicker(land, { name: label, x, lipZ, lip, R, wT, gap });
    K.push(k); return k;
  };
  onBand('Selection rock 1', -102, 7, 9, 2.8, 12, 'Selection kicker 1');
  onBand('Selection rock 2', -71, 7, 9, 2.8, 12, 'Selection kicker 2');
  onBand('Selection rock 3', -107, 7, 9, 2.8, 12, 'Selection kicker 3');
  onBand('The Great Wall', -108, 7, 9, 2.8, 12, 'Great Wall kicker (lane A)');
  onBand('The Great Wall', -71, 7, 9, 2.8, 12, 'Great Wall kicker (lane B)');
  onBand('The Great Wall', -30, 8, 10, 3.0, 12, 'Great Wall kicker (west)');
  onBand('The Great Wall', 40, 8, 10, 3.0, 12, 'Great Wall kicker (east)');

  // ---- jibs: logs laid off the rock, a rock slab, stumps. Their top lines are what the skis ride; freeride's meshes
  // draw them (ownMesh), park.js's Rail does the riding
  const rails = [];
  const log = (name, x, za, zb, top, over, w = 0.44, topEnd = top, ramp = Math.max(0.05, top - 0.12)) => {
    // a straight log from za (its top `top` m over the snow) to zb, `over` m past the snow's line at zb's end (laid off a
    // ledge); topEnd: its top over the snow at that end, if not the same
    const ya = G(x, za) + top, yb = G(x, zb - over) + topEnd;
    const k = (yb - ya) / (zb - over - za), pts = [[x, za, ya], [x, zb, ya + k * (zb - za)]];
    rails.push(new Rail({ name, kind: 'tube', top: 'round', w, abs: true, pts, ownMesh: true, look: 'log', ramp: ramp || undefined }));
  };
  // the log ledge: a log down its bench and 2.5 m out over its 3 m rock lip
  { const b = bandOf(land, 'Log ledge'); log('Log ledge log', -73, b.zL(-73) - 11, b.zL(-73) + 2.5, 0.5, 2.6); }
  // the fan cliffs: a long log off the 8 m band's lip
  { const b = bandOf(land, 'Fan cliffs'); log('Fan cliffs log', 106, b.zL(106) - 12, b.zL(106) + 2.2, 0.5, 2.3); }
  // the Great Wall: a log out over its lip
  { const b = bandOf(land, 'The Great Wall'); log('Great Wall log', 62, b.zL(62) - 10, b.zL(62) + 2, 0.5, 2.1); }
  // in the trees on the skier's left: a fallen log lying down the slope, and one off the tree band's lip
  // (lying in the snow at its top end, so the skis ride straight up onto it; its far end 0.6 m up)
  log('Fallen log', 77, 446, 459, 0.1, 0, 0.5, 0.6, 0);
  { const b = bandOf(land, 'Tree band'); log('Tree band log', 112, b.zL(112) - 10, b.zL(112) + 2, 0.5, 2.1); }
  // a rock slab in the Selection zone: a flat-topped slab standing out of the snow, its top less steep than the slope
  {
    const x = -73, za = 398, zb = 407, ya = G(x, za) + 0.6, yb = ya - (zb - za) * Math.tan(27 * RAD);
    rails.push(new Rail({ name: 'Rock slab', kind: 'ledge', top: 'flat', w: 1.5, abs: true, pts: [[x, za, ya], [x, zb, yb]], ownMesh: true, look: 'slab', ramp: 0.45 }));
  }
  // a pair of stumps to tap, side by side below the slab
  for (const [x, z] of [[-109.5, 452], [-105, 453.5]]) {
    const y = G(x, z) + 0.75;
    rails.push(new Rail({ name: 'Stump', kind: 'box', top: 'flat', w: 0.72, abs: true, pts: [[x, z - 0.36, y + 0.05], [x, z + 0.36, y - 0.05]], ownMesh: true, look: 'stump' }));
  }

  // ---- the start pads on the summit ridge and the drop-ins further down (the pause menu's start points)
  const starts = [
    { name: 'Summit: the centre line', x: 0, z: -30, v: 3 },
    { name: 'Summit: the Couloirs', x: 100, z: -24, v: 3 },
    { name: 'Summit: the narrow chute (mandatory air)', x: 63.8, z: 4, v: 2 },
    { name: 'Summit: the Spines', x: -96, z: -24, v: 3 },
    { name: 'The Ledge: above the cliff bands', x: 8, z: 176, v: 6 },
    { name: 'The Ledge: the Big Ones', x: 30, z: 240, v: 6 },
    { name: 'The Ledge: Selection kickers', x: -102, z: 190, v: 6 },
    { name: 'Lower bench: the pillow field', x: 6, z: 352, v: 6 },
    { name: 'Lower bench: Selection kickers', x: -107, z: 352, v: 6 },
    { name: 'Above the Great Wall', x: -30, z: 440, v: 7 },
    { name: 'Finish apron', x: 0, z: 600, v: 6 },
  ];
  // the finish corral's fences (the floodlights stand along them: env.js)
  const fences = [[-46, 700, -46, 930], [46, 700, 46, 930]];
  park = assemble({ kickers: K, rails, starts, fences, banner: 'FREERIDE' });
  park.land = land; park.freeride = true;
  park.liftLine = { x: LIFT_X, top: -46, bot: 935 };
  // the terrain's fine patches sink under the rock meshes (terrain.js visualHeight, st: the patch's cell size)
  const dipK = park.visualDip.bind(park);
  park.visualDip = (x, z, st) => {
    const a = dipK(x, z);
    if (!st || st > 1.75) return a;
    const t = land.dipTarget(x, z, st);
    if (t === Infinity) return a;
    return Math.max(a, land.at(x, z) - t);
  };

  // ---- trees: the lower face's sides, round the finish and down the valley; never on the lines, the features or rock
  const keepOut = [];
  for (const f of land.features) if (f.rock || f.kind === 'pillows' || f.kind === 'spines') keepOut.push([f.x0 - 5, f.x1 + 5, f.z0 - 4, f.z1 + 4]);
  for (const k of K) keepOut.push([k.cxT - k.hwT - 7, k.cxT + k.hwT + 7, k.z0 - 50, k.zMeet + 6]);
  for (const r of rails) { const xs = r.pts.map(p => p[0]), zs = r.pts.map(p => p[1]); keepOut.push([Math.min(...xs) - 6, Math.max(...xs) + 6, Math.min(...zs) - 14, Math.max(...zs) + 14]); }
  // (the lift line, the finish corral, the runout over to the lift's bottom station, the summit ridge)
  keepOut.push([LIFT_X - 14, LIFT_X + 14, -80, 1000], [-50, 50, 680, 990], [-70, 205, 730, 1010], [-160, 230, -90, 10]);
  const trees = (max, r) => {
    const out = [];
    for (let tries = 0; out.length < max && tries < max * 14; tries++) {
      const x = -360 + r() * 760, z = 330 + r() * 1100;
      // denser down the valley and off the sides, scattered in the middle of the lower face
      const side = Math.abs(x) > 60 ? 1 : 0.18, low = z > 560 ? 1 : 0.6;
      if (r() > side * low) continue;
      if (simplex(x * 0.012, z * 0.012) < -0.25 + (Math.abs(x) < 60 ? 0.3 : 0)) continue;   // clumps and glades
      if (keepOut.some(b => x > b[0] && x < b[1] && z > b[2] && z < b[3])) continue;
      const e = 0.6, y = G(x, z), gx = (G(x + e, z) - G(x - e, z)) / (2 * e), gz = (G(x, z + e) - G(x, z - e)) / (2 * e);
      if (Math.hypot(gx, gz) > 1.0) continue;                 // not on anything steeper than 45 degrees
      out.push({ x, y: y - 0.3, z, s: 6 + r() * 11, rot: r() * 6.28 });
    }
    return out;
  };
  mtn.trees = trees;
  mtn.spot = { treeline: -330 };
  return { mtn, park, land, kickers: K, rails };
}
