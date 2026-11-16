/* (N, round 12) The Nines map: a real slopestyle course built for the Nines snow event, recreated feature for feature
   from the organisers' published renders and numbers, drone and ground photographs, and the venue's real ground from
   open elevation data. On screen it is named by its place and year only (no event or sponsor name, logo or mark: the
   banners and structures carry the right colours and shapes with plain words of our own).
   Sources, the feature sheet (every number and how it was had) and the comparison sheets are in the round's notes
   (scratchpad ski12/N/NOTES.md); the ground is AWS Terrain Tiles (open data), baked by tools there into data/<id>/.
   main.js: makeNines(q, say) before the terrain is built (it puts the ground in through terrain.js's mountain hook and
   returns the park); then dress(scene, mats, q) for the structures and the skyline. */
import * as THREE from 'three';
import { setMountain } from './terrain.js?v=29';
import { assemble, Rail } from './park.js?v=29';
import { setRockSource, freerideLook } from './materials.js?v=29';
import { smoothstep, fbm } from './noise.js?v=29';
import { loadLand } from './m_nines_land.js?v=29';
import { Prof, Ext, Round, Fn } from './m_nines_shapes.js?v=29';
import { Kit, makeSkyline, dressMats, tent, domeTent, snowcat, excavator, banner, fence } from './m_nines_dress.js?v=29';
import { setSunPath } from './env.js?v=29';

export const NINES_ID = 'schilthorn23';
export const NINES_NAME = 'Schilthorn 2023';

export async function makeNines(q, say = () => Promise.resolve()) {
  await say('Reading the mountain', 0.3);
  const land = await loadLand(new URL('../data/' + NINES_ID + '/', import.meta.url).href);
  // (the Birg station's rock and the summit, to their mapped heights: the elevation model is about 70 and 35 m short)
  for (const [P, r, k] of [[BIRG, 70, 1.6], [SUMMIT, 110, 1.2]]) { const h = P.y - land.y0 - land.nat(P.x, P.z) - 4; if (h > 0) land.bumps.push({ x: P.x, z: P.z, r, h, k }); }
  const G = (x, z) => land.at(x, z);
  freerideLook();
  /* the sun where it really is over the venue in mid April (latitude 46.56 degrees, declination about +10): up in the
     east (azimuth about 75 degrees), 53 degrees high in the south at the middle of the day, down in the west (about 285);
     the game's 6:30 to 18:30 day stretched over that path, turned into the map's frame (its +z is azimuth land.meta.az) */
  { const a0 = land.meta.az * Math.PI / 180, ca = Math.cos(a0), sa = Math.sin(a0);
    setSunPath((t, out) => {
      const f = (t - 6.5) / 12, el = 53 * Math.sin(Math.PI * f), A = (75 + f * 210) * Math.PI / 180, E = Math.sin(A), Nn = Math.cos(A), ce = Math.cos(el * Math.PI / 180);
      out.set((-E * ca + Nn * sa) * ce, Math.sin(el * Math.PI / 180), (E * sa + Nn * ca) * ce).normalize();
      return { el, dir: out };
    }); }
  let park = null;
  const mtn = {
    bare: true, land, at: G,
    surface: (x, z) => park && park.surface(x, z) ? 2 : 0,
    groom: () => 1,
    spot: { treeline: land.meta.treeline - land.y0 },
  };
  if (q && q.tier === 'low') mtn.lodK = 0.85;
  setMountain(mtn);
  await say('Building the course', 0.34);
  const C = buildCourse(land, G, q);
  /* the venue's surface lift: on the riders' right of the course, about 140 m off its middle, from below the last
     feature to above the start (tbar.js planTbar puts its up line 6.5 m outside the highest fence x it is given, so it
     is given one fence there; the course's own fences are C.fences, drawn here) */
  park = assemble({ kickers: C.kickers, rails: C.rails, starts: C.starts, meshed: C.meshed, pipes: C.pipes, fences: [[C.liftX - 6.5, -1e4, C.liftX - 6.5, 1e4]], banner: null });
  park.nines = true; park.ninesLift = true;
  park.lightTowers = [{ x0: 0, z0: 0, dx: 0, dz: 1, n: 0, ax: 1, az: 0 }];   // (no floodlights at this venue)
  park.course = C;
  setRockSource(G, [C.mid.x, C.mid.z]);
  return { mtn, park, land, course: C, dress: (scene, mats, q2) => dress(scene, mats, q2, land, C) };
}

/* ---- the course -------------------------------------------------------------------------------------------------------
   In the course's own frame: u across (to the rider's left), s down the course from the Formation Jump's lips; the map's
   frame has the same axes (its +z is the course's axis), so a course point is map (X0 + u, Z0 + s). The numbers are the
   feature sheet's (scratchpad ski12/N/measure/FEATURES.md and NOTES.md), each marked there stated, measured or estimated. */
export const FRAME = { X0: 0, Z0: -168 };
// a takeoff's centre line ending at its lip (0, yL) at aL degrees, out of a straight in-run at aI (negative: down) through
// an arc of radius R, from s0: a Prof
export function takeoff(s0, yL, aL, aI, R) {
  const r = Math.PI / 180, sA = Math.sin(aL * r) + Math.sin(-aI * r), s1 = -R * sA;
  const y1 = yL - R * (1 - Math.cos(aL * r)) + R * (1 - Math.cos(aI * r));
  const y0 = y1 + (s1 - s0) * Math.tan(-aI * r);
  return new Prof(s0, y0, aI).lineTo(s1).arcTo(aL, R);
}
/* a kicker standing on the snow: its arc from the slope (pitch p degrees down, at its foot) up to its lip at aL degrees,
   the lip H over the snow at sLip (gs(s): the snow's height along its line); 2 m of the slope's own pitch before its foot */
export function kick(sLip, gs, H, aL, p) {
  // (the arc rises R(cos p - cos aL) from its foot, and the slope falls ext tan p under it by the lip)
  const r = Math.PI / 180, R = H / Math.max(0.05, Math.cos(p * r) - Math.cos(aL * r) + (Math.sin(aL * r) + Math.sin(p * r)) * Math.tan(p * r));
  const ext = R * (Math.sin(aL * r) + Math.sin(p * r)), sA = sLip - ext, yA = gs(sA);
  return new Prof(sA - 2, yA + 2 * Math.tan(p * r), -p).lineTo(sA).arcTo(aL, R);
}
function buildCourse(land, G, q) {
  const { X0, Z0 } = FRAME, at = (u, s) => G(X0 + u, Z0 + s);
  const meshed = [], rails = [], pipes = [], starts = [], lines = [], parts = {};
  const put = f => { f.ground = G; meshed.push(f); return f; };

  /* ---- the Formation Jump: three in-run lanes between snow walls, each rising to its own lip on the block's front edge,
     the block's deck between the lips, and the big landing below the block's front face */
  const FJ = parts.formation = { lanes: [-8.4, 0, 8.4], laneHW: 3.1, lip: 26, inrun: -20, R: 13, Lin: 48, lipH: 5.5, deckL: 11, wallUp: 1.8, innerW: 2.2, outerW: 5.0, land: 33 };
  const g0 = at(0, 0), yL = g0 + FJ.lipH;
  const laneProf = takeoff(-FJ.Lin, yL, FJ.lip, FJ.inrun, FJ.R).done();
  const floorAt = s => laneProf.at(Math.max(-FJ.Lin, Math.min(0, s)));
  FJ.yL = yL; FJ.yTop = laneProf.at(-FJ.Lin);
  FJ.lanes.forEach((u, i) => put(new Ext({ name: `Formation Jump ${['right', 'middle', 'left'][i]} lane`, group: 'Formation Jump', x: X0 + u, z: Z0, prof: laneProf, w: FJ.laneHW, side: 3.5, shoulder: 0.15, dyeBands: [[-0.25, 0]] })));
  // the walls between and beside the lanes: their tops 1.8 m over the lane floors along the in-run, the deck's height
  // over the block (its last deckL metres), faces near upright
  const yDeck = yL + 0.25;
  const wallTop = s => Math.max(floorAt(s) + FJ.wallUp, yDeck - Math.max(0, -FJ.deckL - s) * 0.9);
  const wallAt = (u, w, name) => {
    const pr = new Prof(-w / 2 - 0.55, -2.4, 0).dropTo(-w / 2, 0).line(w).dropTo(w / 2 + 0.55, -2.4).done();
    return put(new Ext({ name, group: 'Formation Jump', ext: 'u', x: X0 + u, z: Z0 - FJ.Lin / 2, prof: pr, w: FJ.Lin / 2, ends: 'cut', along: sl => wallTop(sl - FJ.Lin / 2) }));   // (sl: along the wall from its middle)
  };
  const hw = FJ.laneHW, step = FJ.lanes[1] - FJ.lanes[0];
  wallAt(FJ.lanes[0] + step / 2, step - 2 * hw, 'Formation Jump wall (right of the middle lane)');
  wallAt(FJ.lanes[1] + step / 2, step - 2 * hw, 'Formation Jump wall (left of the middle lane)');
  wallAt(FJ.lanes[0] - hw - FJ.outerW / 2, FJ.outerW, 'Formation Jump block (right shoulder)');
  wallAt(FJ.lanes[2] + hw + FJ.outerW / 2, FJ.outerW, 'Formation Jump block (left shoulder)');
  // the landing: from just under the lips, a knuckle, a straight face at FJ.land degrees, a run-out into the slope
  {
    const s0 = 0.35, y0 = yL - 1.1, pr = new Prof(s0, y0, 0).arcTo(-FJ.land, 8);
    // (the face straight on until it is 2.5 m under the snow: the snow takes over there, rounded into it over 7 m, blendG)
    let s = pr.t, y = pr.y; const tl = Math.tan(FJ.land * Math.PI / 180);
    while (s < 140 && y > at(0, s) - 2.5) { s += 0.5; y -= 0.5 * tl; }
    pr.lineTo(s);
    put(new Ext({ name: 'Formation Jump landing', group: 'Formation Jump', x: X0, z: Z0, prof: pr.done(), w: 16, side: 0.55, shoulder: 3, blendG: 7 }));
    FJ.landEnd = pr.t;
  }
  FJ.lanes.forEach((u, i) => starts.push({ name: `Formation Jump, the ${['right', 'middle', 'left'][i]} lane`, x: X0 + u, z: Z0 - FJ.Lin + 1.5, v: 1 }));
  FJ.lanes.forEach((u, i) => lines.push({ name: `Formation Jump ${['right', 'middle', 'left'][i]} lane`, start: { x: X0 + u, z: Z0 - FJ.Lin + 1.5, v: 1 }, path: [[Z0 - FJ.Lin, X0 + u], [Z0 + 60, X0 + u]], until: Z0 + FJ.landEnd }));

  /* ---- the Love Bump: two takeoffs turned in towards each other, an up rail between them, and the huge rounded landing
     they both throw you onto */
  const LB = parts.love = { s: 112, lips: [[9.5, -32], [-6.5, 32]], lipH: 2.4, lip: 30, R: 7, Lin: 12, bump: { s: 136, u: 1.5, r: 15, h: 3.2 }, rail: { u: 0.8, s0: 104, s1: 110, h0: 0.45, h1: 1.35 } };
  for (const [u, deg] of LB.lips) {
    const yaw = deg * Math.PI / 180, gs = t => G(X0 + u + Math.sin(yaw) * t, Z0 + LB.s + Math.cos(yaw) * t);
    const p = Math.atan((gs(-12) - gs(0)) / 12) * 180 / Math.PI, pr = kick(0, gs, LB.lipH, LB.lip, p);
    put(new Ext({ name: `Love Bump ${u > 0 ? 'left' : 'right'} takeoff`, group: 'Love Bump', x: X0 + u, z: Z0 + LB.s, yaw, prof: pr.done(), w: 2.6, side: 0.8, shoulder: 0.6, dyeBands: [[-0.25, 0]] }));
  }
  {
    const B = LB.bump, yb = at(B.u, B.s), pr = new Prof(0, yb + B.h, 0);
    // (a rounded top, then its sides curving down into the snow: a cosine bell)
    for (let i = 1; i <= 40; i++) { const r = B.r * i / 40; pr.dropTo(r, yb + B.h * (0.5 + 0.5 * Math.cos(Math.PI * i / 40)) - 0.15 * i / 40); }
    put(new Round({ name: 'Love Bump landing', group: 'Love Bump', x: X0 + B.u, z: Z0 + B.s, prof: pr.done(), RR: 6 }));
  }
  { const R0 = LB.rail; rails.push(new Rail({ name: 'Love Bump up rail', kind: 'rail', group: 'Love Bump', pts: [[X0 + R0.u, Z0 + R0.s0, R0.h0], [X0 + R0.u, Z0 + R0.s1, R0.h1]], ramp: R0.h0 - 0.08, colour: 0x1d1f23, legs: true })); }
  starts.push({ name: 'Love Bump', x: X0, z: Z0 + 70, v: 6 });
  for (const [u, deg] of LB.lips) { const yaw = deg * Math.PI / 180, sx = X0 + u - Math.sin(yaw) * 30, sz = Z0 + LB.s - Math.cos(yaw) * 30; lines.push({ name: `Love Bump ${u > 0 ? 'left' : 'right'} takeoff`, start: { x: sx, z: sz, v: 9, yaw }, path: [[sz, sx], [Z0 + LB.s, X0 + u], [Z0 + LB.s + 30, X0 + u + Math.sin(yaw) * 30]], until: Z0 + 160 }); }
  lines.push({ name: 'Love Bump up rail', start: { x: X0 + LB.rail.u, z: Z0 + LB.rail.s0 - 25, v: 7 }, path: [[Z0 + 70, X0 + LB.rail.u], [Z0 + 160, X0 + LB.rail.u]], until: Z0 + 150 });

  return { kickers: [], rails, meshed, pipes, fences: [], starts, lines, parts, mid: { x: X0, z: Z0 + 90 }, liftX: -140 };
}

function dress(scene, mats, q, land, C) {
  makeSkyline(scene, q, land);
  const group = new THREE.Group(); group.name = 'nines dress';
  const M = dressMats(), kit = new Kit();
  landmarks(kit, group, M, land);
  venue(kit, group, M, land, C);
  kit.build(group, M, q.tier !== 'low');
  scene.add(group); group.updateMatrixWorld(true);
}

/* the event's own things round the course, from the straight-down photo (refs 004: the riders' village up the riders'
   left of the Formation Jump, the snowcats and excavators parked by it) and the oblique ones (banners, the start).
   Course coordinates (u, s) as the course's (FRAME). */
function venue(kit, group, M, land, C) {
  const { X0, Z0 } = FRAME, G = (u, s) => land.at(X0 + u, Z0 + s), W = (u, s) => [X0 + u, Z0 + s];
  const V = C.parts.village = {
    tents: [[24.2, 58.4, 6, 'grey'], [35.4, 67.9, 5, 'black']],     // [s, u, size, colour] (measured on 004 at 0.118 m a pixel)
    dome: [38.5, 64.8, 4.2],
    cats: [[-27.1, 62.0, 2.4], [-24.2, 65.0, 2.4], [-17.7, 55.0, 2.1], [-0.6, 87.0, 0.6]],   // [s, u, heading]
    diggers: [[-10.0, 81.4, 1.2], [-11.5, 84.4, 1.0]],
  };
  for (const [s, u, w, c] of V.tents) { const [x, z] = W(u, s); tent(kit, c, x, G(u, s) - 0.1, z, w, 2.4, 1.6, 0.3); }
  { const [s, u, r] = V.dome, [x, z] = W(u, s); domeTent(kit, 'white', x, G(u, s) - 0.2, z, r); }
  for (const [s, u, h] of V.cats) { const [x, z] = W(u, s); snowcat(kit, x, G(u, s) - 0.05, z, h); }
  for (const [s, u, h] of V.diggers) { const [x, z] = W(u, s); excavator(kit, x, G(u, s) - 0.05, z, h); }
  // the banner across the Formation Jump block's front (white, plain words), facing down the course
  const FJ = C.parts.formation;
  if (FJ) { const [x, z] = W(0, 0.6); banner(group, 'SCHILTHORN 2023', x, FJ.yL - 2.9, z, 8, 1.1, 0); }
}

/* the Schilthorn's summit (the revolving restaurant's round building and the top station under it) and the Birg station
   on its rock, as plain masses; and the Birg to Schilthorn cableway (two track ropes and a cabin) across the sky over the
   venue. Places from OpenStreetMap, put into the map's frame by the bake tools (scratchpad ski12/N/tools/geo.py). */
const SUMMIT = { x: -692, z: -710, y: 2970 }, BIRG = { x: 683, z: 537, y: 2677 };
const CABLE = { a: { x: 646, z: 496, y: 2690 }, b: { x: -669, z: -657, y: 2955 } };
function landmarks(kit, group, M, land) {
  const Y = a => a - land.y0;
  // the summit: a round building of two storeys, its glass band, a flat roof, and the station block under it
  const s = SUMMIT, ys = Y(s.y) - 3;
  kit.cyl('concrete', s.x, ys - 6, s.z, 17, 6, 24); kit.cyl('glass', s.x, ys, s.z, 16.6, 4.2, 24); kit.cyl('concrete', s.x, ys + 4.2, s.z, 17.5, 1.2, 24);
  kit.box('concrete', s.x + 20, ys - 14, s.z + 8, 18, 12, 14, 0.5);
  kit.pole('steel', new THREE.Vector3(s.x, ys + 5.4, s.z), new THREE.Vector3(s.x, ys + 13, s.z), 0.25);
  // Birg: the station block on its rock, its glass front to the valley, the platform round it
  const b = BIRG, yb = Y(b.y) - 4;
  kit.box('concrete', b.x, yb - 10, b.z, 22, 14, 16, 0.9); kit.box('glass', b.x - 2, yb - 2, b.z + 7.6, 18, 4, 1, 0.9); kit.box('concrete', b.x, yb + 4, b.z, 23, 0.8, 17, 0.9);
  // the cableway's two track ropes (a catenary between the stations), and a cabin a third of the way along
  const pts = [], a = CABLE.a, c = CABLE.b, L = Math.hypot(c.x - a.x, c.z - a.z);
  for (const off of [-3, 3]) {
    const nx = -(c.z - a.z) / L * off, nz = (c.x - a.x) / L * off;
    let prev = null;
    for (let i = 0; i <= 64; i++) {
      const t = i / 64, y = Y(a.y + (c.y - a.y) * t) - 0.12 * L * 4 * t * (1 - t) * 0.5;
      const p = new THREE.Vector3(a.x + (c.x - a.x) * t + nx, y, a.z + (c.z - a.z) * t + nz);
      if (prev) pts.push(prev, p); prev = p;
    }
  }
  const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), M.rope); lines.name = 'nines cableway'; lines.frustumCulled = false; group.add(lines);
  const t = 0.36, yc = Y(a.y + (c.y - a.y) * t) - 0.12 * L * 4 * t * (1 - t) * 0.5 - 7, cx = a.x + (c.x - a.x) * t, cz = a.z + (c.z - a.z) * t, ry = Math.atan2(c.x - a.x, c.z - a.z);
  kit.box('red', cx, yc, cz, 3.2, 3.2, 6.4, ry); kit.box('glass', cx, yc + 1.1, cz, 3.3, 1.4, 6.5, ry);
  kit.pole('steel', new THREE.Vector3(cx, yc + 3.2, cz), new THREE.Vector3(cx, yc + 6.6, cz), 0.12);
}
