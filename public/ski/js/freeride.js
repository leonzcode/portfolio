/* Freeride: the made-up big-mountain venue (2026-11-06). The land (frland.js) is the height function; this puts it in
   the game through the same hook a real mountain uses (terrain.js setMountain), with a park of its own: kickers built
   on the rock bands as Natural Selection's are (park.js Kickers on the land's own slope, their lips on the rock, the
   gap the rock band, the landing the steep apron under it), logs, a rock slab and stumps to slide (park.js Rails, drawn
   here), the starts at the summit's brink and down the face, the trees, the chairlift's line from the bottom to the ridge
   (lift.js planLift reads park.liftLine). The rock meshes are frrock.js's.
   (2026-11-10, for Leon's "just have 1 chairlift that goes from bottom to top") one chairlift (park.liftLines), the
   Summit Chair from the finish corral by the arch straight up the main face, over the shoulder and up the Peak to the
   true summit; the first start at its top; where its towers may stand (park.towerOk), and where the physics meets a
   rock face (park.cliff). */
import { Land, LIFT_XS, fallLines, LINES } from './frland.js?v=26';
import { Kicker, Rail, assemble } from './park.js?v=26';
import { setMountain } from './terrain.js?v=26';
import { simplex, fbm, smoothstep } from './noise.js?v=26';
import { setRockSource, rockFieldWorker, freerideLook, setFieldTrees } from './materials.js?v=26';

const RAD = Math.PI / 180;
export const FIELD_MID = [10, 225];     // (the rock field's middle: frfield.js is sent its windows round it; 1280 m of fine
                                         // field from the Peak, z -415, to the lifts' bottoms, z 865)

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
    super(Object.assign({ base, pitch, z0, drop: 40, table: 1, land: 55, Rk: 1, wD: o.wT * 2 + 1, wL: o.wT + 2, sideS: 0.62, landS: 0.62, group: 'Freeride kickers' }, o,
      o.planned ? { vLip: o.planned[0] } : {}));   // (planned: park.js's own first guess at vLip, set again below, is not worked out)
    this.rock = true;
    /* the design speeds. Off a lip onto a natural steep apron the landing is soft only where the flight comes down
       nearly along the snow, so the speed off the lip is the one that lands softest (least speed into the snow) at least
       `gap` m out (the game's air drag, the real snow along the centre line); then up the ramp to it */
    const lip = this.lip * RAD, kd = 0.5 * 1.2 * 0.5 / 78, dt = 0.004;
    let best = null;
    // (2026-11-12, for "improving loading time": a kicker from Freeride's plan (makeFreeride) is given what this search
    // found before, the same numbers: o.planned [v, vn, X], or null for none; the search was about 0.4 s of the start)
    if (o.planned !== undefined) best = o.planned && { v: o.planned[0], vn: o.planned[1], X: o.planned[2] };
    else for (let v = 10; v <= 18; v += 0.25) {
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
    this.planned = best ? [best.v, best.vn, best.X] : null;
    const target = this.L.z + this.gapX;
    const rise = this.L.y - base(this.z0);
    this.vDesign = Math.sqrt(this.vLip * this.vLip + 2 * 9.81 * rise * (1.12 + 0.02 * rise)) + 0.5;
    // the landing zone (the flags on its top edge, the filmer camera beside its foot)
    const yl = G(x, target);
    this.K = { z: target - 4, y: G(x, target - 4) }; this.Kend = { z: target, y: yl }; this.zMeet = target + 12;
    this.landDeg = Math.atan((G(x, target - 1) - G(x, target + 1)) / 2) / RAD;
  }
  /* nothing past the lip: no back face, no table, no knuckle, no landing of its own (they would bridge the gap). The
     lip stands straight up from the rock's bench, as a natural kicker's does (2026-11-08: its back face ran 2 m on,
     over the band's own lip where that curved in, and its mesh drew snow up to 4 m above the rock that was there) */
  rel(z, d) { return z > this.L.z + 0.02 ? -Infinity : super.rel(z, d); }
  // only the takeoff and its lip have snow above the ground: no rows over the sunk deck
  rows(fine) {
    const r = [], st = fine ? 0.6 : 1.0;
    for (let z = this.z0 - 0.5; z < this.L.z; z += st) r.push(z);
    for (let z = this.L.z - 0.6; z < this.L.z; z += fine ? 0.06 : 0.1) r.push(z);
    r.push(this.L.z, this.L.z - 0.005, this.L.z - 0.2, this.L.z - 0.17, this.L.z + 0.02, this.L.z + 0.06);
    return [...new Set(r.map(v => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
  }
  // the dye line along the lip only (the knuckle is the rock's edge)
  dye(x, z) { return Math.abs(z - this.L.z + 0.08) < 0.1 && Math.abs(x - this.x) < this.wT ? 1 : 0; }
  surface(x, z) { return z > this.z0 && z < this.L.z + 0.5 && Math.abs(x - this.cxT) < this.hwT + 1.5; }
}

// the land's band by name (the kickers and logs are put on them)
const bandOf = (land, name) => land.features.find(f => f.name === name);

/* (2026-11-12) plan: the rock kickers' searches from a last start ({ kicker name: [v, vn, X] or null }, returned as
   fr.plan), kept by main.js with a fingerprint of this file, frland.js, park.js, terrain.js and noise.js */
export function makeFreeride(q, plan = null) {
  const land = new Land(), G = land.G;
  freerideLook();     // (2026-11-11: Freeride's own snow and rock pictures, materials.js)
  // ---- the mountain, through terrain.js's hook: no extra noise (bare), its own surfaces
  let park = null;
  const mtn = {
    bare: true, at: (x, z) => land.at(x, z), land,
    // packed snow on the built features, deep snow everywhere else
    surface: (x, z) => park && park.surface(x, z) ? 2 : 1,
  };
  /* (on the low tier the terrain's patches split a little later here: looking down a steep face fills the view with
     near ground, about 56 patches from the summit against the Jump Line's 43, a draw call each) */
  if (q && q.tier === 'low') mtn.lodK = 0.7;
  setMountain(mtn);
  /* the snow shader's rock field: from the snow without the rock faces (they draw their own), the ribs' crests rocky.
     Worked out in a worker (frfield.js), so it is ready before a run starts and never takes a frame's time: baked on
     the page in idle moments it was still going ten seconds into a run on a slow machine */
  // (2026-11-11: and the mountain's own light in the same texels, the sky each place sees and the sun's shadows: frfield.js)
  rockFieldWorker(new URL('./frfield.js?v=26', import.meta.url), FIELD_MID, () => setRockSource((x, z) => land.snowAt(x, z), FIELD_MID, (x, z, ny) => land.rockNy(x, z, ny)), true);

  // ---- kickers on the rock: [band, x, lip deg, R, half width, gap m]
  const K = [];
  const onBand = (name, x, lip, R, wT, gap, label) => {
    const b = bandOf(land, name), lipZ = b.zL(x) - 1.3;
    const k = new RockKicker(land, Object.assign({ name: label, x, lipZ, lip, R, wT, gap }, plan && label in plan ? { planned: plan[label] } : {}));
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
  // (beside the Great Wall's lane A kicker's in-run, not in it)
  // (2026-11-08: and in the side bowls, below)
  /* (2026-11-08, second pass: its uphill end level with the snow a quarter metre above it, the snow banked against it
     as it is on a real stump, and at least 0.3 m over its foot: it stood 0.45 m over the snow at its uphill end, and a
     sled, scooter or bike, whose feet reach less far along than skis, met it already too far under its top and slid
     past it) */
  const stump = (x, z) => {
    const y = Math.max(G(x, z - 0.6) + 0.03, G(x, z) + 0.3);
    rails.push(new Rail({ name: 'Stump', kind: 'box', top: 'flat', w: 0.72, abs: true, pts: [[x, z - 0.36, y], [x, z + 0.36, y - 0.1]], ownMesh: true, look: 'stump' }));
  };
  for (const [x, z] of [[-118, 452], [-113.5, 453.5]]) stump(x, z);
  // ---- the side bowls' natural jibs (2026-11-08): in the West Glades a fallen log down the slope by the pillows, a rock
  // rail (a long narrow slab of rock standing out of the snow) and a pair of stumps; on the Spine Wall a log off the big
  // band's lip and a fallen log
  log('Glade log', -338, 452, 466, 0.1, 0, 0.5, 0.6, 0);
  {
    const x = -372, za = 398, zb = 410, ya = G(x, za) + 0.55, yb = ya - (zb - za) * Math.tan(25 * RAD);
    rails.push(new Rail({ name: 'Rock rail', kind: 'ledge', top: 'flat', w: 0.6, abs: true, pts: [[x, za, ya], [x, zb, yb]], ownMesh: true, look: 'slab', ramp: 0.4 }));
  }
  for (const [x, z] of [[-360, 486], [-355.5, 487.5]]) stump(x, z);
  { const b = bandOf(land, 'East big band'); log('East band log', 384, b.zL(384) - 11, b.zL(384) + 2.2, 0.5, 2.3); }
  log('Fallen log', 410, 470, 484, 0.1, 0, 0.5, 0.6, 0);

  /* ---- the starts: on the summit ridge's brink, a few metres down the face, so the chase camera sits on the brink
     and the face is in view below as a run starts (from the start pad behind it, a camera 4 m back and 2.5 m up only
     sees the far valley over the brink: the face's 32 degrees overall are steeper than its line of sight), and the
     drop-ins further down (the pause menu's start points) */
  /* (2026-11-08, for Leon's "spawn at the top of the lift, not beside it") the first start is the top of the chairlift,
     on the ramp just off its unloading platform: where the lift leaves you. (yaw: the way the start faces, radians from
     +z; main.js reads it)
     (2026-11-10: one chairlift, from the finish corral by the arch to the true summit, 1100 m and 540 m up; the three
     others are gone, and every run comes back down to its bottom: frland.js runout) */
  /* (2026-11-12, for Leon's "remove top lift ... stop it at the shoulder") the chair ends at the top of the main face, on
     the shoulder; the Peak's lines start from the pause menu's start points */
  const lifts = [{ name: 'Summit Chair', x: LIFT_XS[0], top: -46, bot: 760 }];
  // (8 m to the side of the top station and 10 m down from its end, on the ramp off the unloading platform, where a rider
  // is a second after getting off: the chase camera behind is clear of the station there)
  const liftTop = (L, yaw) => ({ name: 'Top of the ' + L.name, x: L.x - 8, z: L.top + 10, v: 2, yaw });
  const starts = [
    liftTop(lifts[0], -0.25),   // (on the shoulder, turned a little away from the line's towers below)
    { name: 'Summit: the centre line', x: 0, z: -7, v: 2.5 },
    { name: 'Summit: the Couloirs (the dog-leg)', x: 90, z: 3, v: 2.5 },
    { name: 'Summit: the narrow chute (mandatory air)', x: 63.8, z: 4, v: 2 },
    { name: 'Summit: the Spines', x: -96, z: 5, v: 2.5 },
    // (2026-11-13, flow: a start for each named line, frland.js LINES)
    { name: 'Summit: the step-downs', x: -38, z: -9, v: 2.5 },
    { name: 'Summit: the wide chute', x: 125, z: 2, v: 2 },
    { name: 'Mid-face: above Tier A', x: 8, z: 176, v: 6 },
    { name: 'Mid-face: the Big Ones', x: 34, z: 240, v: 6 },          // (6 m clear of the Face Chair's line at x 28)
    { name: 'Selection: the rock kickers', x: -102, z: 190, v: 6 },
    { name: 'Lower face: the pillows', x: -40, z: 362, v: 6 },          // (2026-11-13: above the pillow line, which is lower now)
    { name: 'Lower face: Selection kickers', x: -107, z: 352, v: 6 },
    { name: 'Above the Great Wall', x: -30, z: 460, v: 7 },
    { name: 'Finish apron', x: 0, z: 600, v: 6 },
    { name: 'West Glades: the cornice', x: -366, z: -4, v: 2.5 },
    { name: 'West Glades: the natural halfpipe', x: -318, z: 30, v: 4 },
    { name: 'West Glades: the step-down', x: -406, z: 270, v: 5 },
    { name: 'Spine Wall: the spines', x: 306, z: 0, v: 2.5 },          // (6 m above the cornice: at z 6 it stood on its lip)
    { name: 'Spine Wall: the couloir', x: 367, z: 2, v: 2 },
    { name: 'Spine Wall: the big band', x: 330, z: 310, v: 5 },
    // (2026-11-10: the Peak's lines, west to east, each start just above its top, a flag and its sign there: frrock.js)
    // (just past the crest, which is further down the face out at the sides than in the middle)
    { name: 'Peak: the Wave', x: -380, z: -322, v: 2.5 },
    { name: 'Peak: the Boulder Garden', x: -286, z: -322, v: 2.5 },
    { name: 'Peak: the Staircase', x: -230, z: -322, v: 2.5 },
    { name: 'Peak: the cliffs', x: -118, z: -318, v: 3 },
    { name: 'Peak: the couloir', x: 89, z: -336, v: 2 },
    { name: 'Peak: the Fin', x: 214, z: -322, v: 2.5 },
    { name: 'Peak: the Pillow Stack', x: 283, z: -324, v: 2.5 },
    { name: 'Peak: the Gate', x: 382, z: -322, v: 2.5 },
  ];
  // the finish corral's fences (the floodlights stand along them: env.js), round the chairlift's bottom station
  // (from z 735, not 700: the side bowls' riders come into the corral from either side above them)
  const fences = [[-46, 735, -46, 820], [46, 735, 46, 820]];
  park = assemble({ kickers: K, rails, starts, fences, banner: 'FREERIDE' });
  park.land = land; park.freeride = true;
  // (2026-11-13) the named lines, start to finish (frland.js LINES: each one's start is one of the starts above)
  park.lines = LINES.filter(l => starts.some(st => st.name === l.start));
  // (2026-11-08, with P) on a rock face: the physics' wall; everywhere else on Freeride is snow to ride (frland.js cliff)
  park.cliff = (x, z) => land.cliff(x, z);
  /* (2026-11-10) the one chairlift, its bottom where the run flattens by the finish arch, straight up the main face
     (riders on it look down on the cliffs, drops and rocks under it), over the shoulder and up the Peak (lift.js) */
  park.liftLines = lifts;
  /* where a lift's tower may stand (lift.js): not on or by rock (no cliff within 5 m), not on anything steeper than about
     46 degrees or lumpy (a pillow, a roll's knee: the snow within 2.5 m more than 0.7 m off a plane), not in a
     kicker's or a jib's lane */
  const lanesT = [];
  for (const k of K) lanesT.push([k.cxT ?? k.x, k.hwT + 5, k.z0 - 20, k.zMeet + 4]);
  for (const r of rails) { const xs = r.pts.map(p => p[0]), zs = r.pts.map(p => p[1]); lanesT.push([(Math.min(...xs) + Math.max(...xs)) / 2, (Math.max(...xs) - Math.min(...xs)) / 2 + 3, Math.min(...zs) - 8, Math.max(...zs) + 8]); }
  /* (2026-11-08, second pass) a gap through a band, where riders funnel through (rock within 20 m either side): from
     10 m above its lip to 40 m below it, across the gap and 3 m either side. The Face Chair's tower stood in Tier A's
     break, 3.5 m from its rock. */
  // (but for a lift's own line in the 30 m below its top station: riders leave the platform to the sides, and the Peak
  // Chair's top stands in the Peak cornice's break)
  const inGap = (x, z) => !lifts.some(L => Math.abs(x - L.x) < 3 && z > L.top && z < L.top + 30) && land.features.some(f => {
    if (f.kind !== 'band' || x < f.xa - 3 || x > f.xb + 3) return false;
    const zl = f.zL(Math.min(f.xb, Math.max(f.xa, x))); if (z < zl - 10 || z > zl + 40) return false;
    let low = false, l = false, r = false;
    for (let d = -3; d <= 3; d += 1.5) { const xx = x + d; if (xx > f.xa && xx < f.xb && f.H(xx) < 1) low = true; }
    for (let d = 3; d <= 20 && low && !(l && r); d += 1) { if (!l && x - d > f.xa && f.H(x - d) > 2) l = true; if (!r && x + d < f.xb && f.H(x + d) > 2) r = true; }
    return low && l && r;
  });
  park.towerOk = (x, z, strict = true) => {
    const y0 = G(x, z), gx = (G(x + 5, z) - G(x - 5, z)) / 10, gz = (G(x, z + 5) - G(x, z - 5)) / 10;
    if (gx * gx + gz * gz > 1.04 * 1.04 || inGap(x, z)) return false;
    // (the looser rule, where the strict one leaves nowhere within a span: only off rock, 3 m round)
    if (!strict) { for (const dx of [-3, -1.5, 0, 1.5, 3]) for (const dz of [-3, -1.5, 0, 1.5, 3]) if (land.cliff(x + dx, z + dz)) return false; return true; }
    // (and not right in a drop's landing or its run-up: no rock face within 16 m up the hill of it or 10 m below, 2 m
    // either side)
    for (let dz = 6; dz <= 16; dz += 2) for (const dx of [-2, 0, 2]) if (land.cliff(x + dx, z - dz) || (dz <= 10 && land.cliff(x + dx, z + dz))) return false;
    for (const dx of [-5, -2.5, 0, 2.5, 5]) for (const dz of [-5, -2.5, 0, 2.5, 5]) {
      if (land.cliff(x + dx, z + dz)) return false;
      if (Math.abs(dx) < 3 && Math.abs(dz) < 3 && Math.abs(G(x + dx, z + dz) - (y0 + gx * dx + gz * dz)) > 0.7) return false;
    }
    return !lanesT.some(([lx, hw, z0, z1]) => Math.abs(x - lx) < hw && z > z0 && z < z1);
  };
  // the terrain's fine patches sink under the rock meshes (terrain.js visualHeight, st: the patch's cell size)
  const dipK = park.visualDip.bind(park);
  park.visualDip = (x, z, st) => {
    const a = dipK(x, z);
    if (!st || st > 1.75) return a;
    const t = land.dipTarget(x, z, st);
    if (t === Infinity) return a;
    return Math.max(a, land.at(x, z) - t);
  };

  /* ---- trees (2026-11-07: in clumps and glades as a real treeline grows, not in blocks): none above a treeline that
     wanders and is lower in the middle of the face than on the arms' lower slopes, thinning as it nears it (the top
     ones smaller); more on the ribs, few in the gullies (avalanche paths, the couloirs' fan above all); in clumps with
     glades between; never on a rock face, a feature or its bench and apron, a kicker's lane, a rail, the lift's line, the
     finish corral or the runout's floor, and none on anything steeper than about 40 degrees */
  const lanes = [];
  for (const k of K) lanes.push([k.cxT ?? k.x, k.hwT + 6, k.z0 - 50, k.zMeet + 8]);
  for (const r of rails) { const xs = r.pts.map(p => p[0]), zs = r.pts.map(p => p[1]); lanes.push([(Math.min(...xs) + Math.max(...xs)) / 2, (Math.max(...xs) - Math.min(...xs)) / 2 + 5, Math.min(...zs) - 14, Math.max(...zs) + 28]); }
  // (2026-11-08: and the natural halfpipe, rim to rim and a little more)
  for (const f of land.features) if (f.kind === 'hpipe') lanes.push([f.x, (f.x1 - f.x0) / 2 + 4, f.z0 - 10, f.z1 + 20]);
  const trees = (max, r) => {
    const out = [];
    for (let tries = 0; out.length < max && tries < max * 16; tries++) {
      const x = -480 + r() * 960, z = 130 + r() * 1320;
      /* (2026-11-08: over the side bowls too: the West Glades wooded from about 150 m down the face, glades and
         clumps; the Spine Wall bare but for its lowest slopes, as Alaska is) */
      const ax = Math.abs(x), side = ax > 230 ? (x < 0 ? -1 : 1) : 0;
      const line = side < 0 ? 150 + 40 * fbm(x * 0.01 + 4, 1.5, 2) : side > 0 ? 430 + 40 * fbm(x * 0.01 - 4, 2.5, 2) :
        360 + 45 * fbm(x * 0.007 + 2, 0.5, 2) - 120 * smoothstep(120, 190, ax) + 40 * smoothstep(-40, 40, -x) * smoothstep(60, 140, ax);
      const up = smoothstep(line, line + 70, z);
      if (up <= 0) continue;
      // (the gullies' avalanche paths and the couloirs' fan stay open; the ribs carry the trees)
      const fl = fallLines(x, z), path = x > 66 && x < 128 && z < 640 ? 0.12 : 1;
      let d = up * path * (fl < 0 ? Math.max(0.1, 1 + fl * 0.22) : 1 + fl * 0.06);
      d *= smoothstep(-0.18, 0.28, fbm(x * 0.021, z * 0.021, 3));               // clumps
      d *= smoothstep(-0.3, 0.12, fbm(x * 0.0065 + 5, z * 0.0065 - 3, 2));     // glades
      if (ax < 34 && z < 640) d *= z < 440 ? 0.15 : 0.45;                      // (the centre line stays open, but for a glade low down)
      d *= 0.7;
      // (the West Glades: glades, not a forest, open lanes down its features and between its clumps)
      if (side < 0) d *= 0.55 * smoothstep(-0.05, 0.3, fbm(x * 0.018 - 9, z * 0.012 + 4, 2));
      // (the Spine Wall's lowest slopes: woods, not a forest, 2026-11-08 second pass: at 4 to 5 trees in every 30 m
      // square, twice the others, they were most of the bot sweep's crashes there)
      if (side > 0) d *= 0.6;
      // (the valley's floor below the face is an open meadow, a clump and a single tree here and there, the woods
      // thick only up its sides; the finish corral stands in the open, not in a cut through trees)
      // (and the valley floor between z 660 and 780 is open right across, 2026-11-10: the side bowls' riders cross it
      // to the one chairlift's bottom)
      if (z > 600) d *= 0.08 + 0.92 * smoothstep(90, 190, Math.abs(x - 50 * smoothstep(620, 940, z))) * (1 - smoothstep(620, 660, z) * (1 - smoothstep(780, 840, z)));
      if (r() > d) continue;
      // (not in the finish corral, whose edge wanders a little, nor under the lift)
      const jit = 4 * simplex(x * 0.08, z * 0.08);
      if (Math.abs(x) < 80 + jit * 3 && z > 670 + jit && z < 950) continue;
      if (lifts.some(L => (Math.abs(x - L.x) < 13 && z > L.top - 20 && z < L.bot + 45) || (Math.abs(x - L.x) < 40 && z > L.bot - 20 && z < L.bot + 45))) continue;
      if (lanes.some(([lx, hw, z0, z1]) => Math.abs(x - lx) < hw + jit && z > z0 && z < z1)) continue;
      // (2026-11-13: and none within about 6 m of a named line's way down, frland.js LINES: through the woods each line is
      // a clear lane you can read from above)
      if (land.lineNear(x, z) < 6 + jit * 0.5) continue;
      // (on a feature, its bench or its apron: the land there is not the bare slope)
      if (Math.abs(land.at(x, z) - land.base(x, z)) > 0.25 || Math.abs(land.at(x + 2.5, z) - land.base(x + 2.5, z)) > 0.4 || Math.abs(land.at(x - 2.5, z) - land.base(x - 2.5, z)) > 0.4) continue;
      const e = 0.6, y = G(x, z), gx = (G(x + e, z) - G(x - e, z)) / (2 * e), gz = (G(x, z + e) - G(x, z - e)) / (2 * e);
      if (Math.hypot(gx, gz) > 0.84) continue;                 // not on anything steeper than about 40 degrees
      out.push({ x, y: y - 0.3, z, s: (6 + r() * 11) * (0.55 + 0.45 * up), rot: r() * 6.28 });
    }
    return out;
  };
  // (2026-11-11: and the forest, once planted, to the light field: the shade under and beside the trees, frfield.js)
  mtn.trees = (max, r) => { const out = trees(max, r); setFieldTrees(out); return out; };
  mtn.spot = { treeline: -330 };
  land.jibs = rails;     // (frrock.js draws the rock slab with the rock faces)
  return { mtn, park, land, kickers: K, rails, plan: Object.fromEntries(K.map(k => [k.name, k.planned])) };
}
