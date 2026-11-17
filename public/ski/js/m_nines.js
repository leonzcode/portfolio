/* (N, round 12) The Nines map: a real slopestyle course built for the Nines snow event, recreated feature for feature
   from the organisers' published renders and numbers, drone and ground photographs, and the venue's real ground from
   open elevation data. On screen it is named by its place and year only (no event or sponsor name, logo or mark: the
   banners and structures carry the right colours and shapes with plain words of our own).
   Sources, the feature sheet (every number and how it was had) and the comparison sheets are in the round's notes
   (scratchpad ski12/N/NOTES.md); the ground is AWS Terrain Tiles (open data), baked by tools there into data/<id>/.
   main.js: makeNines(q, say) before the terrain is built (it puts the ground in through terrain.js's mountain hook and
   returns the park); then dress(scene, mats, q) for the structures and the skyline. */
import * as THREE from 'three';
import { setMountain } from './terrain.js?v=32';
import { assemble, Rail } from './park.js?v=32';
import { setRockSource, freerideLook } from './materials.js?v=32';
import { smoothstep, fbm } from './noise.js?v=32';
import { loadLand } from './m_nines_land.js?v=32';
import { Prof, Ext, Round, Fn } from './m_nines_shapes.js?v=32';
import { Kit, makeSkyline, dressMats, tent, domeTent, snowcat, excavator, banner, fence } from './m_nines_dress.js?v=32';
import { setSunPath } from './env.js?v=32';

export const NINES_ID = 'schilthorn23';
export const NINES_NAME = 'Schilthorn 2023';

export async function makeNines(q, say = () => Promise.resolve()) {
  await say('Reading the mountain', 0.3);
  const land = await loadLand(new URL('../data/' + NINES_ID + '/', import.meta.url).href);
  // (the Birg station's rock and the summit, to their mapped heights: the elevation model is about 70 and 35 m short)
  // (the summit's sharper: a pyramid, round 1 of the comparisons)
  for (const [P, r, k] of [[BIRG, 70, 1.6], [SUMMIT, 160, 2.6]]) { const h = P.y - land.y0 - land.nat(P.x, P.z) - 4; if (h > 0) land.bumps.push({ x: P.x, z: P.z, r, h, k }); }
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
  let park = null, trackD = null;
  const mtn = {
    bare: true, land, at: G,
    surface: (x, z) => park && park.surface(x, z) ? 2 : 0,
    // (groomed over the venue only: the course, the cat tracks either side and the riders' village (004, 017); the slopes
    // round it are off-piste, so the terrain's rock can show on the ridges and the summit, which grooming hides)
    groom: (x, z) => { const u = x - FRAME.X0, s = z - FRAME.Z0, v = smoothstep(-82, -64, u) * (1 - smoothstep(96, 116, u)) * smoothstep(-120, -96, s) * (1 - smoothstep(262, 290, s)); if (!v) return 0;
      // (fully groomed on the course's corridor and the cat tracks, less in between, so the tracks show as bands: 004, 017)
      const c = Math.max(1 - smoothstep(28, 40, Math.abs(u - 2)), trackD ? 1 - smoothstep(3.6, 5.5, trackD(u, s)) : 0);
      return v * (0.3 + 0.7 * c); },   // (second pass: more contrast, the loop could not be read from above)
    spot: { treeline: land.meta.treeline - land.y0 },
  };
  if (q && q.tier === 'low') mtn.lodK = 0.85;
  setMountain(mtn);
  await say('Building the course', 0.34);
  trackD = catTracks(land);
  const C = buildCourse(land, G, q);
  /* the venue's surface lift: on the riders' right of the course, about 140 m off its middle, from below the last
     feature to above the start (tbar.js planTbar puts its up line 6.5 m outside the highest fence x it is given, so it
     is given one fence there; the course's own fences are C.fences, drawn here) */
  park = assemble({ kickers: C.kickers, rails: C.rails, starts: C.starts, meshed: C.meshed, pipes: C.pipes, fences: [[C.liftX - 6.5, -1e4, C.liftX - 6.5, 1e4]], banner: null });
  park.nines = true; park.ninesLift = true;
  park.lightTowers = [{ x0: 0, z0: 0, dx: 0, dz: 1, n: 0, ax: 1, az: 0 }];   // (no floodlights at this venue)
  park.course = C; park.inruns = C.inruns;   // (skier.js reads park.inruns: the decks' speed check)
  /* bare rock where the photos show it on the Schilthorn's summit pyramid and the Birg's crag (002, 003): the snow
     there is blown off the ridges and bands of the faces, not only off the steepest; broken into bands by noise */
  setRockSource(G, [C.mid.x, C.mid.z], (x, z, ny) => {
    let f = 0;
    for (const [P, r0, r1] of [[SUMMIT, 520, 140], [BIRG, 260, 60]]) { const d = Math.hypot(x - P.x, z - P.z); if (d < r0) f = Math.max(f, smoothstep(r0, r1, d)); }
    if (!f) return Math.min(1, ny + 0.05);   // (fewer rock patches elsewhere: round 2 of the comparisons)
    const b = fbm(x * 0.012 + 7.3, z * 0.012 - 2.1, 2), band = smoothstep(0.42, 0.62, b);
    return ny - f * (0.06 + 0.3 * band);
  });
  return { mtn, park, land, course: C, dress: (scene, mats, q2) => dress(scene, mats, q2, land, C) };
}

/* the venue's cat tracks (004, 017, 003; FEATURES.md section 5): a groomed band with a snow bank either side, about
   0.7 m, the outer one the bigger (021 shows a 1 m bank on the outer side of the tow's track). The loop up the riders'
   left from the bottom past the village to the start [measured to (142, 98), estimated above it], the track down the
   riders' right at u -36 [measured] and the one at u -55 the lift follows [measured, s 0 to 160]. Course (s, u). */
const TRACKS = [
  { pts: [[250, 28], [242, 32], [201, 63], [171, 83], [142, 98], [100, 106], [50, 100], [0, 96], [-40, 76], [-70, 40]], out: -1 },   // (out: the outer side's sign, + on the track's left as it is drawn)
  { pts: [[-70, -36], [0, -36], [120, -36], [255, -36]], out: -1 },
  { pts: [[-10, -55], [160, -55]], out: -1 },
];
function catTracks(land) {
  const { X0, Z0 } = FRAME, segs = [];
  for (const T of TRACKS) for (let i = 0; i < T.pts.length - 1; i++) {
    const [sa, ua] = T.pts[i], [sb, ub] = T.pts[i + 1], L = Math.hypot(sb - sa, ub - ua);
    segs.push({ sa, ua, ds: (sb - sa) / L, du: (ub - ua) / L, L, out: T.out, s0: Math.min(sa, sb) - 7, s1: Math.max(sa, sb) + 7, u0: Math.min(ua, ub) - 7, u1: Math.max(ua, ub) + 7 });
  }
  land.mods.push((x, z, y) => {
    const u = x - X0, s = z - Z0; let add = 0;
    for (const g of segs) {
      if (s < g.s0 || s > g.s1 || u < g.u0 || u > g.u1) continue;
      const t = Math.max(0, Math.min(g.L, (s - g.sa) * g.ds + (u - g.ua) * g.du)), cs = s - g.sa - g.ds * t, cu = u - g.ua - g.du * t;
      const d = Math.hypot(cs, cu), side = Math.sign(cs * -g.du + cu * g.ds) || 1;     // (which side: + on the track's left)
      const h = side === g.out ? 1.0 : 0.55, b = (d - 3.4) / 0.9;   // (021 shows about 1 m on the outer side)
      add = Math.max(add, h * Math.exp(-b * b));
    }
    return y + add;
  });
  // (how far a point is from the nearest track's middle: the groomed bands)
  return (u, s) => { let d = 1e9; for (const g of segs) { if (s < g.s0 - 20 || s > g.s1 + 20 || u < g.u0 - 20 || u > g.u1 + 20) continue; const t = Math.max(0, Math.min(g.L, (s - g.sa) * g.ds + (u - g.ua) * g.du)); d = Math.min(d, Math.hypot(s - g.sa - g.ds * t, u - g.ua - g.du * t)); } return d; };
}

/* ---- the course -------------------------------------------------------------------------------------------------------
   In the course's own frame: u across (to the rider's left), s down the course from the Formation Jump's lips; the map's
   frame has the same axes (its +z is the course's axis), so a course point is map (X0 + u, Z0 + s). The numbers are the
   feature sheet's (scratchpad ski12/N/measure/FEATURES.md and NOTES.md), each marked there stated, measured or estimated. */
export const FRAME = { X0: 0, Z0: -197 };
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
  const D = Math.PI / 180;

  /* ---- the Formation Jump (feature sheet section 2): three raised in-run decks with upright sides, each ending in its
     own main lip on one line (s = 0); four lower channels beside and between them, each ending in a lower kicker's
     rounded nose just in front of the lips; under the lips the block's lower tier and table out to the knuckle, then the
     landing down into the slope. Deck centres and widths [measured]; heights, lip angle and landing pitch [estimated]. */
  const FJ = parts.formation = {
    decks: [{ u: 8.2, wLip: 5.0, wUp: 3.3, name: 'left' }, { u: 0, wLip: 7.6, wUp: 6.1, name: 'middle' }, { u: -8.1, wLip: 4.6, wUp: 3.2, name: 'right' }],
    chans: [{ u: 11.35, wLip: 1.3, wUp: 2.8 }, { u: 4.75, wLip: 1.9, wUp: 2.8 }, { u: -4.8, wLip: 2.0, wUp: 2.8 }, { u: -11.55, wLip: 2.3, wUp: 2.8 }],
    // (Leon, after the second pass: "less kicky": the lips from 30 to 25 degrees, the transition's radius from 9 to 16 m [the
    // photos fix neither: 30 and 9 were estimates])
    end: -33, flare: [-14, -11], lipH: 5.2, lip: 25, R: 16, tableDrop: 5.4, knuckle: 11, land: 30, lowerS: 0.2, lowerDrop: 2.4, lowerLip: 6, front: 17.1, startS: -62,
  };
  const yL = at(0, 0) + FJ.lipH;
  FJ.yL = yL;
  const wAt = (wUp, wLip) => s => (wUp + (wLip - wUp) * smoothstep(FJ.flare[0], FJ.flare[1], s)) / 2;
  // a deck: straight from where its sides die out into the slope (end) down to an arc that rises to its lip at FJ.lip
  for (const d of FJ.decks) {
    const g0 = at(d.u, FJ.end), r = FJ.R, aL = FJ.lip;
    const sA = -r * Math.sin(aL * D), yA = yL - r * (1 - Math.cos(aL * D));             // (the arc's foot, where it is level)
    const p = Math.atan((g0 - yA) / (sA - FJ.end)) / D;                                  // (the deck's own pitch down to it)
    const pr = takeoff(FJ.end, yL, aL, -p, r);
    d.prof = pr.done(); d.pitch = p;
    put(new Ext({ name: `Formation Jump ${d.name} deck`, group: 'Formation Jump', x: X0 + d.u, z: Z0, prof: d.prof, w: d.wLip / 2, wMax: d.wLip / 2, wMin: d.wUp / 2, wAt: wAt(d.wUp, d.wLip), side: 15, shoulder: 0.05, dyeBands: [[-0.34, -0.1]] }));   // (the dye on the top just short of the lip's edge: dyed to the edge, the face under it took the colour too)
  }
  // the lower channels: their floors on the slope, then a gentle rise onto the block's second tier at the lip line, 2.4 m
  // under the lips (second pass, review round 4: the tier runs on 5 m to the pillows, which the channels' riders leave
  // from, as 005 shows: the channels' U openings end on the tier and the pillows stand out of its face below them)
  const yLow = yL - FJ.lowerDrop;
  for (const c of FJ.chans) {
    const gs = s => at(c.u, s), p = Math.atan((gs(-12) - gs(0)) / 12) / D;
    const pr = kick(FJ.lowerS, gs, Math.max(0.6, yLow - 0.12 - gs(FJ.lowerS)), FJ.lowerLip, p);
    // (from the decks' upper end down to the kicker's foot along the snow)
    const pts = new Prof(FJ.end - 1, gs(FJ.end - 1), -p);
    for (let s = FJ.end; s < pr.pts[0][0]; s += 1) pts.dropTo(s, gs(s));
    for (const [t, y] of pr.pts) if (t > pts.t + 0.01) pts.dropTo(t, y);
    // (level with the tier for a metre, then easing under it: ended in a steep drop where it met the tier, the features'
    // rounded join made a short steep face there that stopped riders)
    pts.dropTo(pts.t + 1.0, pts.y).dropTo(pts.t + 2.5, pts.y - 1.2);
    put(new Ext({ name: `Formation Jump lower kicker (u ${c.u})`, group: 'Formation Jump', x: X0 + c.u, z: Z0, prof: pts.done(), w: c.wLip / 2, wMax: c.wUp / 2, wMin: c.wLip / 2, wAt: wAt(c.wUp, c.wLip), side: 1.7, shoulder: 0.5 }));   // (rounded pillow noses each about a channel wide, as in 005 and 009: rounds 1 and 2 of the comparisons)
  }
  /* the wings: snow fill outside the outer channels, an upright wall on each channel's outer edge (as the decks' walls)
     and a slope falling off outward from it to the snow (rounds 1 to 3 of the comparisons). One height function, so the
     slope goes only outward: as two symmetric extrusions its inner side had filled the outer channels (a rider in the
     riders' right channel took off 6 m short of its lip) */
  {
    const edge = c => Math.abs(c.u) + c.wUp / 2;
    const eL = edge(FJ.chans[0]), eR = edge(FJ.chans[FJ.chans.length - 1]);
    const top = s => s <= -1 ? yL - 0.6 - (-1 - s) * 0.25 : yL - 0.6 + (s + 1) / 1.5 * (FJ.tableDrop - 0.6) * -1;
    const yw = (u, s) => {
      const e = u > 0 ? eL : eR, d = Math.abs(u) - e;
      if (d < 0) return -Infinity;
      return top(s) - Math.max(0, d - 1.2) * 0.45;
    };
    put(new Fn({ name: 'Formation Jump wings', group: 'Formation Jump', x: X0, z: Z0, y: yw, u0: -eR - 16, u1: eL + 16, s0: FJ.end, s1: 0.5, step: 0.4, stepLow: 0.7,
      breaksU: [eL, -eR, eL + 1.2, -eR - 1.2], breaksS: [-1] }));
  }
  /* the block's front under the lips (005, 009; second pass, after review rounds 3 and 4): one continuous second tier in
     front of the top tier's faces, 5 m deep, its top at the channels' ends, with rounded shoulders at its ends; two big
     pillows standing out of its face under the inner channels' openings, about 0.55 of the middle lip's width, upright
     sides, rounded in section, which the channels' riders leave from; a low sign step out in front of the middle; the
     angled sign boxes at the tier's front corners are drawn (dress). Plan sizes from 005 and 008 against the block's
     width; heights estimated. One height function, its edges along u or s on the mesh's own lines. */
  {
    const yT = yL - FJ.tableDrop, yLo = yL - FJ.lowerDrop, F = FJ.front, tierS = 5.0, yTier = yLo - 0.12, sh = 2.2;
    const inChan = u => FJ.chans.some(c => Math.abs(u - c.u) < c.wLip / 2 + 0.15);
    const inner = FJ.chans.filter(c => Math.abs(c.u) < 8);
    FJ.block = { tierS, yTier, pillow: { hw: 2.1, d: 1.9 }, step: { hw: 6.0, s1: tierS + 3.2, h: 1.0 } };
    const B = FJ.block;
    const yb = (u, s) => {
      let y = -Infinity; const au = Math.abs(u);
      // the second tier (where a channel runs, from its end at the lip line on), its ends rounded down over 2.2 m
      if (s < tierS && au < F && s > (inChan(u) ? FJ.lowerS : -0.4)) {
        const e = au - (F - sh); y = e <= 0 ? yTier : yTier - sh * (1 - Math.sqrt(Math.max(0, 1 - (e / sh) ** 2)));
      }
      // the pillows: super-elliptic in plan (upright sides), rounded down at the front, level with the tier on top
      for (const c of inner) {
        const a = (u - c.u) / B.pillow.hw, b = (s - (tierS - 0.3)) / B.pillow.d;
        if (b >= 0 && b < 1) { const q = a ** 8 + b ** 4; if (q < 1) y = Math.max(y, yT + (yTier - yT) * Math.sqrt(1 - q)); }
      }
      // the sign step
      if (au < B.step.hw && s > tierS - 0.3 && s < B.step.s1) y = Math.max(y, yT + B.step.h);
      return y;
    };
    put(new Fn({ name: 'Formation Jump block front', group: 'Formation Jump', x: X0, z: Z0, y: yb, u0: -F - 1, u1: F + 1, s0: -0.6, s1: B.step.s1 + 0.6, step: 0.3, stepLow: 0.5,
      breaksU: [...FJ.chans.flatMap(c => [c.u - c.wLip / 2 - 0.15, c.u + c.wLip / 2 + 0.15]), ...[1, -1].flatMap(g => [g * B.step.hw, g * (F - sh)])],
      breaksS: [-0.4, FJ.lowerS, tierS, tierS - 0.3, B.step.s1] }));
  }
  /* the block's foot under the lips out to the knuckle, 10 m in front of them (the photos: a block about 10 m deep, the
     landing dropping away below it), then the landing at FJ.land cut into the slope (land.mods: the ground there is
     lowered to it, its snow having gone into the block), rounded into a run-out at 7 degrees that meets the slope again
     [shape estimated: the photos show the landing falling away well below the block; its depth is not measurable] */
  {
    const yT = yL - FJ.tableDrop, pr = new Prof(-0.3, yT, -1).lineTo(FJ.knuckle).arcTo(-FJ.land, 8).lineTo(32).arcTo(-11, 28);   // (the 30 degree part to s 32: a hard push lands about s 37)
    // (the run-out: a little gentler than the slope until it meets it, never under 4 degrees)
    let s = pr.t, y = pr.y; const t4 = Math.tan(4 * D);
    while (s < 110 && y < at(0, s) - 0.02) { const ns = at(0, s) - at(0, s + 0.5), dp = at(0, s) - y; y -= Math.max(t4 * 0.5, ns - Math.min(0.045, 0.06 * dp)); s += 0.5; pr.dropTo(s, y); }   // (closing in on the slope more slowly as it nears it: it meets it at its own pitch, no lip)
    pr.dropTo(s + 4, y - 4 * t4);
    const T = pr.done(), S = T.S, Tat = t => { const k = (t - S.t0) / S.dt, i = Math.max(0, Math.min(S.n - 2, Math.floor(k))), f = Math.min(1, Math.max(0, k - i)); return S.Y[i] + (S.Y[i + 1] - S.Y[i]) * f; };
    // (from just in front of the lips: the block's foot levelled across, so the lips' faces stand their full height on the
    // riders' left too, where the slope rises; and downhill the landing opens out in a fan with soft banks, as in 004 and
    // 017: about 34 m across at the knuckle to about 58 m where it meets the slope, banks 8 to 16 m wide)
    const s0 = -0.6, s1 = S.t1, hw0 = FJ.front;
    land.mods.push((x, z, gy) => {
      const u = x - X0, sl = z - Z0;
      if (sl < s0 || sl > s1 || Math.abs(u) > hw0 + 30) return gy;
      const t = Tat(sl); if (t >= gy) return gy;
      const k = Math.max(0, Math.min(1, (sl - FJ.knuckle) / 40)), hw = hw0 + 12 * k, bank = 8 + 8 * k;
      // (and faded out over its last 25 m: off the axis, where the slope across is higher, the run-out still lies under it)
      return gy + (t - gy) * smoothstep(hw + bank, hw + 0.5, Math.abs(u)) * smoothstep(s0, s0 + 1.2, sl) * (1 - smoothstep(s1 - 25, s1, sl));
    });
    put(new Ext({ name: 'Formation Jump table and landing', group: 'Formation Jump', x: X0 - 0.1, z: Z0, prof: T, w: FJ.front, side: 0.35, shoulder: 6, dyeBands: [] }));   // (no rounding into the slope at its end: the run-out meets it at nearly its own pitch; soft sides, the cut's banks take over)
    FJ.landEnd = s1;
  }
  const fjStart = (u, nm) => ({ name: nm, x: X0 + u, z: Z0 + FJ.startS, v: 2 });
  starts.push(Object.assign(fjStart(0, 'Start: the Formation Jump'), { here: false }));
  for (const d of FJ.decks) lines.push({ name: `Formation Jump ${d.name} deck`, start: fjStart(d.u), path: [[Z0 + FJ.startS, X0 + d.u], [Z0 + 70, X0 + d.u]], until: Z0 + 70 });
  for (const c of FJ.chans) lines.push({ name: `Formation Jump lower kicker u ${c.u}`, start: fjStart(c.u), path: [[Z0 + FJ.startS, X0 + c.u], [Z0 + 70, X0 + c.u]], until: Z0 + 70 });

  /* ---- the Love Bump (section 3): two kickers set on either side of the axis, each turned 33 degrees in towards it, a
     low pad with an up rail on the axis between them, climbing the back of one big rounded landing mound downhill */
  const LB = parts.love = {
    kickers: [{ s: 116.7, u: 6.5, yaw: -33, name: 'left' }, { s: 116.95, u: -7.35, yaw: 33, name: 'right' }],
    // (Leon: bigger jumps towards the end, less kicky: lips 3.0 to 4.0 m over the snow, 27 to 25 degrees, which takes the
    // transition's radius from about 18.5 to 28 m; the landing mound 12 to 15 m round, 3.5 to 4.5 m high, its top 1 m further on [all
    // beyond the photo estimates, by request])
    lipH: 4.0, lip: 25, wLip: 7.0, len: 8, pad: { s0: 112.3, s1: 115.9, u0: -2.8, u1: 1.4, h: 0.4 },
    // (the rail's h0 over the pad: 0.12 so riders slide onto it from the pad; at 0.45 its end stopped them [estimated])
    rail: { a: [114.9, -0.5], b: [120.6, -0.7], h0: 0.12, h1: 2.4 }, mound: { s: 127, u: -0.7, r: 15, h: 4.5 },   // (r 9.5 measured on 004 at its crest; round 1 of the comparisons: broader in 003, so it is let out to 12 with a gentler fall [estimated])
  };
  for (const k of LB.kickers) {
    const yaw = k.yaw * D, gs = t => G(X0 + k.u + Math.sin(yaw) * t, Z0 + k.s + Math.cos(yaw) * t);
    const p = Math.atan((gs(-12) - gs(0)) / 12) / D, pr = kick(0, gs, LB.lipH, LB.lip, p);
    pr.dropTo(0.8, pr.y - 3.4);       // (its back face nearly upright, about as tall as the lip: 003 and review round 4; the mound takes over below)
    put(new Ext({ name: `Love Bump ${k.name} kicker`, group: 'Love Bump', x: X0 + k.u, z: Z0 + k.s, yaw, prof: pr.done(), w: LB.wLip / 2, side: 1.5, shoulder: 0.4, dyeBands: [[-0.34, -0.1]] }));   // (steep built sides: at 4 m their slopes would have closed the 8 m between the lips' inner corners, where the pad and the rail are)
  }
  {
    const P = LB.pad, um = (P.u0 + P.u1) / 2, y = at(um, P.s0) + P.h;
    put(new Ext({ name: 'Love Bump pad', group: 'Love Bump', x: X0 + um, z: Z0 + P.s0, prof: new Prof(-3.0, at(um, P.s0 - 3.0), 0).dropTo(0, y).flat(P.s1 - P.s0).dropTo(P.s1 - P.s0 + 1.2, at(um, P.s1 + 1.2)).done(), w: (P.u1 - P.u0) / 2, side: 0.5, shoulder: 0.3 }));
    const M = LB.mound, ym = at(M.u, M.s), pm = new Prof(0, ym + M.h, 0);
    for (let i = 1; i <= 36; i++) { const r = M.r * i / 36; pm.dropTo(r, ym + M.h * (0.5 + 0.5 * Math.cos(Math.PI * i / 36)) - 0.25 * i / 36); }
    put(new Round({ name: 'Love Bump landing mound', group: 'Love Bump', x: X0 + M.u, z: Z0 + M.s, prof: pm.done(), RR: 6 }));
    const R0 = LB.rail, ya = y + R0.h0, yb = at(R0.b[1], R0.b[0]) + R0.h1;
    rails.push(new Rail({ name: 'Love Bump up rail', kind: 'rail', group: 'Love Bump', abs: true, pts: [[X0 + R0.a[1], Z0 + R0.a[0], ya], [X0 + R0.b[1], Z0 + R0.b[0], yb]], colour: 0x1d1f23, legs: true }));
  }
  starts.push({ name: 'The Love Bump', x: X0, z: Z0 + 78, v: 7 });
  for (const k of LB.kickers) {
    // (riders come to it off the Formation Jump's run-out at about 15.5 m/s (the top-to-bottom bot's speed there): started
    // at 14.5 m/s, 18 m back along its line)
    const yaw = k.yaw * D, sx = X0 + k.u - Math.sin(yaw) * 18, sz = Z0 + k.s - Math.cos(yaw) * 18;
    lines.push({ name: `Love Bump ${k.name} kicker`, start: { x: sx, z: sz, v: 14.5, yaw }, path: [[sz, sx], [Z0 + k.s, X0 + k.u], [Z0 + k.s + 20, X0 + k.u + Math.sin(yaw) * 20]], until: Z0 + 150 });
  }
  lines.push({ name: 'Love Bump up rail', start: { x: X0 - 0.5, z: Z0 + LB.rail.a[0] - 22, v: 7 }, path: [[Z0 + 80, X0 - 0.5], [Z0 + 150, X0 - 0.6]], until: Z0 + 150 });

  /* ---- the Skate Complex (section 4): a raised platform with a wooden skate pool sunk into its top, a round bowl and a
     dome on its uphill corners (a tunnel into the bowl's floor), a hump with a sign downhill of the pool, rails round it,
     and two cones with rails at the bottom of the course */
  const SC = parts.skate = {
    c: [197.3, -1.5], plat: { s0: 183, s1: 208, u0: -20, u1: 17, h: 3.0, r: 3 },   // (corners rounded 3 m: the bowl's tunnel opens in the uphill wall near the corner, 014)
    pool: { hx: 3.15, hz: 2.6, rc: 1.3, depth: 1.5, R: 1.9, deck: 0.4, step: { s: 3.0, w: 3.3, d: 1.2, h: 0.8 } },
    // (the bowl's ring and the dome's plinth stand with upright outer walls: 1.2 and 0.9 m over the deck [estimated from 011
    // and 015, round 2 of the comparisons; the sheet's 0.45 and 0.3 were from the straight-down photo, which hides height])
    bowl: { s: 193.2, u: 9.1, rIn: 2.3, rOut: 3.4, ring: 1.2, floor: 3.0 },
    dome: { s: 192.9, u: -11.6, r: 2.6, h: 2.7, ringR: 3.8, ring: 0.9 },
    // (the tunnels: the one into the bowl [measured on 014], and one under the dome's uphill side [estimated from 014 and
    // 015: its arched opening in the platform's uphill wall below the dome])
    tunnels: [{ from: [183.2, 16.2], to: [192.2, 9.6], w: 1.8, h: 2.5 }, { from: [182.6, -10.4], to: [189.4, -11.2], w: 1.8, h: 2.5 }],
    // (the hump: 8 m past the pool's middle as review round 5 reads 004, and by Leon's request larger and gentler: r 4.6 to
    // 6.0, 2.7 to 3.2 m high; its steepest 43 to 33 degrees) [beyond the photo estimate, by request]
    hump: { s: 205.3, u: -1.7, r: 6.0, h: 3.2 },
    // (Leon: larger: 2.9 to 3.6 m round, 3.4 to 3.9 m high [beyond the photo estimate, by request]; and a rounded top in
    // place of the point, which threw riders up at about 49 degrees)
    cones: [{ s: 233.3, u: 9.1 }, { s: 233.6, u: -11.3 }], coneR: 3.6, coneH: 3.9,   // (steeper than the sheet's estimate: 019 and 020 show them about 0.6 as tall as wide, review round 4)
  };
  // (a cone's height over its foot at k of its radius: a bell, rounded on top, its flanks steep and flaring at the foot)
  const coneProf = k => SC.coneH * Math.pow(Math.max(0, 1 - k * k), 1.6);
  {
    const [cs, cu] = SC.c, P = SC.plat, yP = at(cu, cs) + P.h, B = SC.bowl, Dm = SC.dome, H = SC.hump, Pl = SC.pool;
    SC.yP = yP;
    const um = (P.u0 + P.u1) / 2, sm = (P.s0 + P.s1) / 2, hx = (P.u1 - P.u0) / 2, hz = (P.s1 - P.s0) / 2;
    const rr = (qx, qz, r) => { const ax = Math.abs(qx) - (hx - r), az = Math.abs(qz) - (hz - r); return Math.hypot(Math.max(ax, 0), Math.max(az, 0)) + Math.min(Math.max(ax, az), 0) - r; };
    const sdP = (u, s) => { const ax = Math.abs(u) - (Pl.hx - Pl.rc), az = Math.abs(s) - (Pl.hz - Pl.rc); return Math.hypot(Math.max(ax, 0), Math.max(az, 0)) + Math.min(Math.max(ax, az), 0) - Pl.rc; };
    const bu = B.u - cu, bs = B.s - cs, du = Dm.u - cu, ds = Dm.s - cs, hu = H.u - cu, hs = H.s - cs;
    // (the tunnels' lines: the platform's wall stands upright round their mouths)
    const TN = SC.tunnels.map(T => { const ta = [T.from[1] - cu, T.from[0] - cs], tb = [T.to[1] - cu, T.to[0] - cs], tL0 = Math.hypot(tb[0] - ta[0], tb[1] - ta[1]); return { T, ta, tb, tL: tL0 }; });
    const yBF = yP - B.floor;
    const y = (u, s) => {
      // the platform: flat on top, its uphill face a gentle ramp (riders ride up onto it), the others steeper
      const qs = s - (sm - cs), qu = u - (um - cu), d = rr(qu, qs, P.r);
      // (its faces steep, the uphill one a fluted wall at about 45 degrees: 015 and round 2 of the comparisons; riders still
      // get up it at speed)
      // (the middle of the uphill side, where the front up rail is, a ramp riders come up onto the deck by, as in 015)
      const uw = u + cu, mid = smoothstep(-9, -5, uw) * (1 - smoothstep(9, 13, uw));
      const slope = qs < -hz + P.r ? (1.0 + 0.12 * Math.cos(u * 5.2)) * (1 - mid) + 0.42 * mid : 1.15;
      // (round each tunnel's mouth the face is a smooth sloped buttress, no flutes, the arch drawn in it: review round 4,
      // 016 and 011 show the arches cut into sloped snow under the bowl's ring and the dome's collar, not an upright wall)
      let sl = slope;
      for (const { T, ta, tb, tL } of TN) { const tx = (u - ta[0]) * (tb[0] - ta[0]) / tL + (s - ta[1]) * (tb[1] - ta[1]) / tL, ty = Math.abs(-(u - ta[0]) * (tb[1] - ta[1]) / tL + (s - ta[1]) * (tb[0] - ta[0]) / tL); if (tx < 1 && ty < T.w / 2 + 2.2) { const k = 1 - smoothstep(T.w / 2 + 0.8, T.w / 2 + 2.2, ty); sl = sl * (1 - k) + 1.15 * k; } }
      // (rounded into the deck over 0.6 m, and over 2.5 m on the ramp, which threw riders up as they reached the deck)
      const r0 = qs < -hz + P.r ? 0.6 + 1.9 * mid : 0.6;
      let h = d <= 0 ? yP : yP - (d < r0 ? sl * d * d / (2 * r0) : sl * (d - r0 / 2));
      // the pool sunk into it (floor, transitions, coping), and its wooden step at the downhill end
      const dp = sdP(u, s);
      // (its walls an arc of radius R from the floor, R more than the depth so they stop short of upright at the coping,
      // 78 degrees: an upright top drew as slivers on any grid and showed the snow through the wood)
      if (dp < 0) { const t = -dp, R = Pl.R, w = Math.sqrt(R * R - (R - Pl.depth) ** 2); h = t >= w ? yP - Pl.depth : yP - Pl.depth + R - Math.sqrt(Math.max(0, R * R - (w - t) * (w - t))); }
      if (Math.abs(u) < Pl.step.w / 2 && s > Pl.step.s && s < Pl.step.s + Pl.step.d) h = Math.max(h, yP + Pl.step.h);
      // the round bowl: a ring standing over the deck, the bowl inside it down to its floor
      const rb = Math.hypot(u - bu, s - bs);
      if (rb < B.rOut + 0.6) {
        if (rb < B.rIn) { const t = rb / B.rIn; h = yBF + (yP + B.ring - yBF) * Math.pow(t, 2.2); }
        else if (rb < B.rOut) h = Math.max(h, yP + B.ring);
        else h = Math.max(h, yP + B.ring - (rb - B.rOut) * 3);   // (a crisp drum: round 3 of the comparisons)
      }
      // the dome on its ring
      const rd = Math.hypot(u - du, s - ds);
      if (rd < Dm.ringR + 0.6) {
        const yr = yP + Dm.ring, Rs = (Dm.r * Dm.r + Dm.h * Dm.h) / (2 * Dm.h);
        if (rd < Dm.r) h = Math.max(h, yr + Dm.h - (Rs - Math.sqrt(Math.max(0, Rs * Rs - rd * rd))));
        else if (rd < Dm.ringR) h = Math.max(h, yr);
        else h = Math.max(h, yr - (rd - Dm.ringR) * 3);
      }
      // the hump downhill of the pool
      const rh = Math.hypot((u - hu) * 0.85, s - hs);
      if (rh < H.r) h = Math.max(h, yP + H.h * (0.5 + 0.5 * Math.cos(Math.PI * rh / H.r)));
      // (its uphill face scooped into a shallow dish where the sign sits, 015 and 014: second pass) [size estimated]
      const rsc = Math.hypot(u - hu, s - (hs - 2.0));
      if (rsc < 2.6 && h > yP + 0.2) h = Math.min(h, yP + 0.6 + 1.7 * (rsc / 2.6) ** 2);
      // the tunnel into the bowl: a channel at the bowl floor's height from the platform's uphill corner (its roof is
      // drawn over it, dress below: the ground here is one height, so the tunnel is open to the sky for the physics)
      // (the tunnels themselves are drawn on the wall, dress below: the heightfield cannot have a roof, and a trench cut
      // for one read as a plank across the deck in rounds 2 and 3 of the comparisons)
      return h;
    };
    SC.sdP = sdP; SC.y = y;
    /* the snow in front of the platform's uphill wall dug down (a moat 1.5 m wide at the wall's foot, then rising back up
       the slope at 17 degrees), so the wall stands about 3 m as in 015 and 016 and the tunnels' arches fit in it: the
       slope rises uphill, so on the plain snow the wall was only 0.8 to 1.7 m [depth estimated from 015] */
    { const sw = P.s0, base = yP - 3.0;
      land.mods.push((x, z, gy) => {
        const u = x - X0, sl = z - Z0;
        if (sl > sw + 2.5 || sl < sw - 14 || u < P.u0 - 6 || u > P.u1 + 6) return gy;
        const t = base + Math.max(0, sw - 1.5 - sl) * 0.3; if (t >= gy) return gy;
        // (only round the tunnels: the middle, with its ramp, stays on the snow so riders can get onto the deck)
        let wt = 0; for (const T of SC.tunnels) wt = Math.max(wt, smoothstep(8, 4.5, Math.abs(u - T.from[1])));
        return gy + (t - gy) * wt * smoothstep(P.u0 - 6, P.u0 - 1, u) * (1 - smoothstep(P.u1 + 1, P.u1 + 6, u)) * (1 - smoothstep(sw + 0.3, sw + 2.5, sl));
      }); }
    /* (second pass, review round 3: the pool's walls showed snow through its wood and the bowl's and dome's rims were
       sawtooth on the platform's 0.35 m grid: the grid is 0.1 m in bands across the pool, the bowl and the dome) */
    const bandsU = [[-Pl.hx - 0.5, Pl.hx + 0.5, 0.1], [bu - B.rOut - 0.7, bu + B.rOut + 0.7, 0.11], [du - Dm.ringR - 0.7, du + Dm.ringR + 0.7, 0.11]];
    const bandsS = [[-Pl.hz - 0.5, Pl.step.s + Pl.step.d + 0.3, 0.1], [bs - B.rOut - 0.7, bs + B.rOut + 0.7, 0.11], [ds - Dm.ringR - 0.7, ds + Dm.ringR + 0.7, 0.11]];
    const pad = 9, f = put(new Fn({ name: 'Skate Complex', group: 'Skate Complex', x: X0 + cu, z: Z0 + cs, y, u0: P.u0 - cu - pad, u1: P.u1 - cu + pad, s0: P.s0 - cs - pad, s1: P.s1 - cs + pad, step: 0.35, stepLow: 0.55,
      breaksU: [-Pl.hx, Pl.hx, -Pl.step.w / 2, Pl.step.w / 2], breaksS: [-Pl.hz, Pl.hz, Pl.step.s, Pl.step.s + Pl.step.d], denseU: bandsU, denseS: bandsS }));
    // (the pool's, the bowl's and the dome's steep walls are transitions to ride, not walls: as the superpipe's)
    pipes.push({ surface: (x, z) => { const u = x - X0 - cu, s = z - Z0 - cs; return sdP(u, s) < 0.3 || Math.hypot(u - bu, s - bs) < B.rOut || Math.hypot(u - du, s - ds) < Dm.ringR; }, x: X0 + cu, z0: Z0 + P.s0, z1: Z0 + P.s1, x0: X0 + P.u0, x1: X0 + P.u1 });
    // the rails round it (black, round), their ends from the sheet; heights over the snow [estimated]
    // (their heights over the snow under them, the complex's own surface included: abs; a snow ramp up to each one that
    // stands on the plain snow, as park rails have)
    // (the cones' own surface too: their rails lie along their flanks)
    const coneY = (s0, u0) => { let y = -Infinity; for (const c of SC.cones) { const k = Math.hypot(s0 - c.s, u0 - c.u) / SC.coneR; if (k < 1) y = Math.max(y, at(c.u, c.s) + coneProf(k) - 0.05); } return y; };
    const sy = (s0, u0) => Math.max(G(X0 + u0, Z0 + s0), Math.abs(u0 - cu) < 28 && Math.abs(s0 - cs) < 22 ? y(u0 - cu, s0 - cs) : -Infinity, coneY(s0, u0));
    const R = (name, a, b, h0, h1, ramp) => {
      rails.push(new Rail({ name, kind: 'rail', group: 'Skate Complex', abs: true, pts: [[X0 + a[1], Z0 + a[0], sy(a[0], a[1]) + h0], [X0 + b[1], Z0 + b[0], sy(b[0], b[1]) + h1]], colour: 0x1d1f23, legs: true }));
      if (!ramp) return;
      // its snow ramp along its own line, the park's own shape (park.js Wedge: rising as the 1.3 power over 3.5 m to 12 cm
      // under the rail's start, 0.7 m short of it, then falling away over 1.2 m; second pass: the old ramp's kink at its
      // foot threw riders over the rail) [heights estimated]
      // (Leon: "less kicky", rail ramps low and gentle: 5.5 m long, rising as smootherstep (level at its foot and at its top,
      // steepest 13 degrees in the middle), to 8 cm under the rail, 0.4 m short of it, so riders slide on with no pop)
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ds = (b[0] - a[0]) / L, du = (b[1] - a[1]) / L, hR = h0 - 0.08, Lw = typeof ramp === 'number' ? ramp : 5.5, gap = 0.4;
      const g = t => sy(a[0] + ds * t, a[1] + du * t);
      // (from half a metre under the snow: started level with a feature's top (the skate deck), the features' rounded
      // join made an 8 cm step at its very edge, an upright face that stopped riders dead)
      const t0 = -gap - Lw, pr = new Prof(t0 - 0.8, g(t0 - 0.8) - 0.5).dropTo(t0, g(t0) - 0.02);
      for (let t = t0 + 0.25; t <= -gap + 1e-6; t += 0.25) { const x = (t - t0) / Lw; pr.dropTo(t, g(t) - 0.02 + (hR + 0.02) * x * x * (3 - 2 * x)); }
      for (let t = -gap + 0.25; t <= 0.6 + 1e-6; t += 0.2) pr.dropTo(t, g(t) + Math.max(-0.05, hR - (t + gap) * hR / 1.0));
      put(new Ext({ name: name + ' ramp', group: 'Skate Complex', x: X0 + a[1], z: Z0 + a[0], yaw: Math.atan2(du, ds), prof: pr.done(), w: 1.2, side: 1.1, shoulder: 0.1 }));
    };
    R('Skate Complex front up rail', [188.1, 2.95], [192.1, 4.0], 0.12, 0.6);   // (an up rail starting just over the platform's ramped face, so riders slide onto it from the face: second pass; it stood 0.5 m over it and only an ollie got on)
    R('Skate Complex rail on the right', [198.7, -17.2], [204.1, -20.4], 0.9, 0.9, 2.4);   // (a shorter ramp: a longer one ran into the dome's plinth)
    R('Down rail on the left', [219.1, 22.7], [224.4, 19.1], 1.0, 0.6, true);
    R('Down rail on the right', [220.0, -22.2], [222.9, -27.3], 1.0, 0.6, true);
    rails.push(new Rail({ name: 'Pool rail', kind: 'box', group: 'Skate Complex', abs: true, w: 0.12, pts: [[X0 + cu - 1.5, Z0 + cs - Pl.hz + 1.3, yP - Pl.depth + 0.35], [X0 + cu + 1.5, Z0 + cs - Pl.hz + 1.3, yP - Pl.depth + 0.35]], colour: 0x1d1f23, legs: true }));
    /* the two cones: bells with a rounded top and a curved fin, a rail along each one's base flank. (The rails' plan lines
       from the sheet (014) ran within 0.8 m of the cones' middles, over their tops, where riders met the rails' raised
       starts on the climb and no rider got on; review round 5 reads them starting at the foot, so each line is moved
       sideways, kept parallel, to run along its cone's foot on the same side [moved up to 2.7 m from the sheet's line].) */
    for (const c of SC.cones) {
      const [ra, rb] = c.u > 0 ? [[232.3, 7.9], [237.4, 9.8]] : [[232.3, -10.7], [238.6, -13.1]];
      const rl = Math.hypot(rb[0] - ra[0], rb[1] - ra[1]), dS = (rb[0] - ra[0]) / rl, dU = (rb[1] - ra[1]) / rl, nS = -dU, nU = dS;
      const dc = (c.s - ra[0]) * nS + (c.u - ra[1]) * nU, D = (SC.coneR - 0.45) * Math.sign(dc || 1), sh = dc - D;
      c.rail = [[ra[0] + nS * sh, ra[1] + nU * sh], [rb[0] + nS * sh, rb[1] + nU * sh]];
    }
    for (const c of SC.cones) {
      const yc = at(c.u, c.s), pr = new Prof(0, yc + SC.coneH, 0);
      for (let i = 1; i <= 24; i++) { const r = SC.coneR * i / 24, k = i / 24; pr.dropTo(r, yc + coneProf(k) - 0.05); }
      put(new Round({ name: `Cone (${c.u > 0 ? 'left' : 'right'})`, group: 'Skate Complex', x: X0 + c.u, z: Z0 + c.s, prof: pr.done(), RR: 2 }));
      /* its fin (019, 020): a thin upright slab with a rounded top on the far side of the peak from the cone's rail and
         along it (019: the rail low on the near flank, the fin behind the peak), about 2.3 m long and 0.45 m thick, its top
         0.75 m over the peak [sizes estimated from 019 and 020; second pass: across the course it stood on the rail's line] */
      const [ra, rb] = c.rail;
      const rl = Math.hypot(rb[0] - ra[0], rb[1] - ra[1]), dS = (rb[0] - ra[0]) / rl, dU = (rb[1] - ra[1]) / rl;
      let nU = dS, nS = -dU; if ((c.u - ra[1]) * nU + (c.s - ra[0]) * nS < 0) { nU = -nU; nS = -nS; }   // (away from the rail)
      const fx = X0 + c.u + nU * 0.65, fz = Z0 + c.s + nS * 0.65;
      const fy = (u, s) => {
        const a = u / 1.15, b = s / 0.22; if (Math.abs(a) >= 1 || Math.abs(b) >= 1) return -Infinity;
        const top = yc + SC.coneH + 0.9 * Math.sqrt(1 - a * a) - 0.15;
        return yc + (top - yc) * Math.sqrt(1 - b * b * b * b);
      };
      put(new Fn({ name: `Cone fin (${c.u > 0 ? 'left' : 'right'})`, group: 'Skate Complex', x: fx, z: fz, yaw: Math.atan2(nU, nS), y: fy, u0: -1.2, u1: 1.2, s0: -0.25, s1: 0.25, step: 0.05, stepLow: 0.1 }));
    }
    // (low along the flank, from high on the cone down past its foot: ridden off the cone's top [heights estimated])
    R('Cone rail on the left', SC.cones[0].rail[0], SC.cones[0].rail[1], 0.5, 0.5, true);
    R('Cone rail on the right', SC.cones[1].rail[0], SC.cones[1].rail[1], 0.5, 0.5, true);
  }
  starts.push({ name: 'The Skate Complex', x: X0 - 1.5, z: Z0 + 160, v: 6 });
  // (the pool ridden across from the deck: dropped into on one side, up the transition on the other, as skaters ride it)
  lines.push({ name: 'Skate Complex pool line', start: { x: X0 - 8, z: Z0 + 197.3, v: 6.5, yaw: Math.PI / 2 }, path: [[Z0 + 197.3, X0 - 8], [Z0 + 197.3, X0 + 7]], maxT: 3 });
  // (each rail ridden along its own line: 14 m back from its start, on through its end)
  const along = (name, a, b, v = 7, back = 14, nosteer = false) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ds = (b[0] - a[0]) / L, du = (b[1] - a[1]) / L, z0 = Z0 + a[0] - ds * back, x0 = X0 + a[1] - du * back;
    lines.push({ name, nosteer, start: { x: x0, z: z0, v, yaw: Math.atan2(du, ds) }, path: [[z0, x0], [Z0 + b[0] + ds * 12, X0 + b[1] + du * 12]], until: Z0 + b[0] + ds * 12 }); };
  // (straight along its line from 10 m back: up the platform's ramped face onto it)
  along('Skate Complex front up rail', [188.1, 2.95], [192.1, 4.0], 9, 10);
  along('Cone rail (left)', SC.cones[0].rail[0], SC.cones[0].rail[1], 7, 9);
  along('Cone rail (right)', SC.cones[1].rail[0], SC.cones[1].rail[1], 7, 9);
  along('Down rail on the left', [219.1, 22.7], [224.4, 19.1]);
  // (these two run across the hill: ridden straight on from a short way back along their line, as riders come at them)
  along('Down rail on the right', [220.0, -22.2], [222.9, -27.3], 6.5, 5, true);
  along('Skate Complex rail on the right', [198.7, -17.2], [204.1, -20.4], 6.5, 3.4, true);
  // the whole course top to bottom down the middle deck
  lines.push({ name: 'Top to bottom (middle deck, Love Bump rail, over the skate platform past the pool, right cone rail)', start: fjStart(0), path: [[Z0 + FJ.startS, X0], [Z0 + 60, X0], [Z0 + 100, X0 - 0.5], [Z0 + 160, X0 - 1], [Z0 + 186, X0 - 5.5], [Z0 + 200, X0 - 6.3], [Z0 + 212, X0 - 7], ...(() => { const [ra, rb] = SC.cones[1].rail; return [[Z0 + ra[0] - 6, X0 + ra[1] + 1.5], [Z0 + ra[0], X0 + ra[1]], [Z0 + rb[0], X0 + rb[1]], [Z0 + 255, X0 + rb[1] - 1]]; })()], until: Z0 + 255, maxT: 60 });   // (onto the right cone's rail where it now runs, along the cone's foot)

  /* the Formation Jump's in-run speed check (skier.js park.inruns, second pass): on each deck and lower channel, from 10 m
     above the start to its lip, the speed a rider with no input has at that height (the lips leave at 12.4 m/s, the lower
     kickers at 13.5), plus 1 m/s; tucking buys 0.8 more. A rider tucking from the start reached 28 m/s at the lips and
     landed past the landing [the design speeds are what the course's landings take, not a measured number] */
  const inruns = [...FJ.decks.map(d => ({ u: d.u, hw: d.wLip / 2 + 0.6, yLip: yL, vLip: 12.4 })), ...FJ.chans.map(c => ({ u: c.u, hw: c.wUp / 2 + 0.4, yLip: yL - FJ.lowerDrop, vLip: 13.5 }))]
    .map(k => ({ want: p => {
      const s = p.z - Z0; if (s < FJ.startS - 10 || s > -0.3 || Math.abs(p.x - X0 - k.u) > k.hw) return null;
      // (half the drop's gain: on the flat decks the snow and the air take about half; so a rider with no input stays under it)
      return Math.max(5, Math.sqrt(Math.max(0, k.vLip * k.vLip - 2 * 9.81 * (p.y - k.yLip) * 0.5))) + 1;
    } }));
  return { kickers: [], rails, meshed, pipes, fences: [], starts, lines, parts, inruns, mid: { x: X0, z: Z0 + 100 }, liftX: X0 - 55 };   // (on the riders' right, on the groomed track 004 shows at u -55 with people along it (review round 4: on the left it stood on the open strip between the course and the village); the real 2023 way up was a snowcat tow round the riders' left)
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
    // [s, u, size, colour] (FEATURES.md section 5, measured on 004): a dark grey twin-peaked tent, a larger one with white
    // roof panels and dark blue sides, a grey tarp
    tents: [[35.6, 56.8, 11.5, 'grey'], [48.2, 64.5, 13, 'blue']],
    tarp: [20, 71, 8],
    ring: [45, 52, 1.5],
    cats: [[-15.7, 60.7, 2.4], [-12.8, 63.7, 2.4], [-6.3, 53.7, 2.1], [10.8, 85.7, 0.6], [5.0, 92.0, 1.6], [238, -32, 0.2]],   // [s, u, heading]
    diggers: [[1.4, 80.1, 1.2], [-0.1, 83.1, 1.0], [8.0, 76.0, 2.0]],
  };
  for (const [s, u, w, c] of V.tents) { const [x, z] = W(u, s); tent(kit, c === 'blue' ? 'blue' : 'grey', x, G(u, s) - 0.1, z, w, 2.6, 2.4, 0); if (c === 'blue') tent(kit, 'white', x, G(u, s) + 2.62, z, w * 0.98, 0.02, 2.4, 0); }
  { const [s, u, w] = V.tarp, [x, z] = W(u, s); kit.box('grey', x, G(u, s) - 0.1, z, w, 1.4, w, 0); }
  { const [s, u, r] = V.ring, [x, z] = W(u, s); kit.cyl('white', x, G(u, s) - 0.2, z, r, 0.6, 16); }
  for (const [s, u, h] of V.cats) { const [x, z] = W(u, s); snowcat(kit, x, G(u, s) - 0.05, z, h); }
  for (const [s, u, h] of V.diggers) { const [x, z] = W(u, s); excavator(kit, x, G(u, s) - 0.05, z, h); }
  // the skate pool's plywood (floor, walls, the deck ring round it, its raised step), laid 2 cm over the snow the skis ride
  const SC = C.parts.skate;
  if (SC) poolWood(group, SC, X0, Z0);
  // the tunnels' roofs (the physics has them open to the sky: one height a point): a slab flush with the platform's top
  // over each and an arched ceiling under it, from just inside the uphill wall to the far end
  if (SC) for (const T of SC.tunnels) tunnelMouth(kit, SC, T, X0, Z0, G);
  // the banner across the Formation Jump block's front (white, plain words), facing down the course
  const FJ = C.parts.formation;
  // (on the sign step's face, out in front of the block's middle, as the photos have their sign: plain words of our own)
  // (standing on the sign step's top at its back, as in 005: plain words of our own)
  if (FJ && FJ.block) { const B = FJ.block, [x, z] = W(0, B.tierS + 0.2); banner(group, 'SCHILTHORN 2023', x, FJ.yL - FJ.tableDrop + B.step.h, z, 9, 0.8, 0); }
  // the angled sign boxes at the second tier's front corners (009, 008): plain white panels turned 45 degrees outward
  if (FJ && FJ.block) for (const g of [1, -1]) { const B = FJ.block, [x, z] = W(g * (FJ.front - 0.9), B.tierS + 0.7); kit.box('white', x, FJ.yL - FJ.tableDrop - 0.05, z, 3.2, 2.0, 0.55, g * Math.PI / 4); }
  // the recess under the middle lip (a rounded panel in the face's shade: the heightfield cannot be hollowed sideways)
  if (FJ) { const [x, z] = W(0, 0.04); const sh = new THREE.Shape(), w = 1.25, h = 0.45, r = 0.4;
    sh.moveTo(-w + r, -h); sh.lineTo(w - r, -h); sh.absarc(w - r, -h + r, r, -Math.PI / 2, 0, false); sh.lineTo(w, h - r); sh.absarc(w - r, h - r, r, 0, Math.PI / 2, false); sh.lineTo(-w + r, h); sh.absarc(-w + r, h - r, r, Math.PI / 2, Math.PI, false); sh.lineTo(-w, -h + r); sh.absarc(-w + r, -h + r, r, Math.PI, Math.PI * 1.5, false);
    const g = new THREE.ShapeGeometry(sh, 6); g.translate(x, FJ.yL - 1.35, z); kit.add('shade', g, 0, 0, 0); }
}

/* a tunnel's arched mouth in the platform's upright uphill wall (015, 016, 011): dark, in the wall's own lean, 4 cm in
   front of it, as tall as the wall allows up to the tunnel's 2.5 m; the arch's width the tunnel's */
function tunnelMouth(kit, SC, T, X0, Z0, G) {
  const [cs, cu] = SC.c, y = (s, u) => SC.y(u - cu, s - cs), g = (s, u) => G(u, s);
  const L = Math.hypot(T.to[0] - T.from[0], T.to[1] - T.from[1]), s = T.from[0], u = T.from[1];
  // (outward: down the wall's slope, found from the surface a metre out from the mouth, back along the tunnel)
  const ps = s - (T.to[0] - s) / L, pu = u - (T.to[1] - u) / L;
  const e = 0.3, gs = (y(ps + e, pu) - y(ps - e, pu)) / (2 * e), gu = (y(ps, pu + e) - y(ps, pu - e)) / (2 * e), gl = Math.hypot(gs, gu) || 1, os = -gs / gl, ou = -gu / gl;
  let ts = s, tu = u; for (let i = 0; i < 40 && y(ts, tu) < SC.yP - 0.05; i++) { ts -= os * 0.1; tu -= ou * 0.1; }        // (the wall's top)
  let fs = ts, fu = tu; for (let i = 0; i < 80 && y(fs, fu) - g(fs, fu) > 0.05; i++) { fs += os * 0.1; fu += ou * 0.1; }   // (its foot)
  const F = new THREE.Vector3(X0 + fu, g(fs, fu), Z0 + fs), Tp = new THREE.Vector3(X0 + tu, SC.yP, Z0 + ts);
  const Hh = Tp.y - F.y; if (Hh < 1) return;
  const ha = Math.min(T.h, Hh - 0.8), r = T.w / 2,   // (clear of the wall's rounded top, which leans out over the plane)
    Y = new THREE.Vector3().subVectors(Tp, F).normalize(), X = new THREE.Vector3(ou, 0, os).cross(new THREE.Vector3(0, 1, 0)).normalize(), Z = new THREE.Vector3().crossVectors(X, Y).normalize();
  if (Z.x * ou + Z.z * os < 0) { X.negate(); Z.negate(); }      // (its face outward, off the wall)
  const k = 1 / Math.max(0.3, Y.y), sh = new THREE.Shape();
  sh.moveTo(-r, 0); sh.lineTo(r, 0); sh.lineTo(r, (ha - r) * k); sh.absarc(0, (ha - r) * k, r, 0, Math.PI, false); sh.lineTo(-r, 0);
  const geo = new THREE.ShapeGeometry(sh, 10);
  geo.applyMatrix4(new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(F.clone().addScaledVector(Z, 0.12)));
  kit.add('tunnel', geo, 0, 0, 0);   // (the inside in shade, snow lit by the bowl's open floor beyond: not black, review round 4)
}

/* the skate pool's wood: a grid over the pool and its deck ring following the complex's own surface (2 cm over it), a
   plywood picture of our own (warm light ply, thin dark contour lines from a noise field: the real floor's printed
   pattern is a topographic one; no wordmark), and the raised step at its downhill end as a box */
function poolWood(group, SC, X0, Z0) {
  const [cs, cu] = SC.c, P = SC.pool, n = 88, ext = [P.hx + 0.42, P.hz + 0.42];
  // (256 px, two octaves: the 512 px three-octave picture took most of a long task at load on a slow machine)
  const N = 256, cv = document.createElement('canvas'); cv.width = cv.height = N; const g = cv.getContext('2d');
  g.fillStyle = '#d9b689'; g.fillRect(0, 0, N, N);
  for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(${150 + (i * 37) % 60},${100 + (i * 13) % 40},60,0.05)`; g.fillRect((i * 97) % N, (i * 61) % N, 2 + (i % 20), 1); }   // (grain)
  const img = g.getImageData(0, 0, N, N), D = img.data;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const v = fbm(x * 0.012 + 3.1, y * 0.012 - 1.7, 2) * 9, f = v - Math.floor(v);
    if (f < 0.09) { const k = (y * N + x) * 4; D[k] *= 0.45; D[k + 1] *= 0.42; D[k + 2] *= 0.4; }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const u = -ext[0] + 2 * ext[0] * i / n, s = -ext[1] + 2 * ext[1] * j / n;
    // (lifted off the snow along the wall's slant too: on the near-upright walls 2 cm straight up left snow showing through)
    const e = 0.05, gu = (SC.y(u + e, s) - SC.y(u - e, s)) / (2 * e), gs = (SC.y(u, s + e) - SC.y(u, s - e)) / (2 * e), k = 0.05 / Math.sqrt(1 + gu * gu + gs * gs);
    pos.push(X0 + cu + u - gu * k, SC.y(u, s) + k, Z0 + cs + s - gs * k); uv.push(i / n, j / n);
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
    const u = -ext[0] + 2 * ext[0] * (i + 0.5) / n, s = -ext[1] + 2 * ext[1] * (j + 0.5) / n;
    if (SC.sdP(u, s) > 0.42) continue;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
  // (drawn a little in front of the snow under it: on the steep walls the snow's own grid could stand a few cm proud)
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })); m.name = 'pool wood'; m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix(); group.add(m);
  const st = P.step, yb = SC.yP;
  const box = new THREE.Mesh(new THREE.BoxGeometry(st.w + 0.06, st.h + 0.03, st.d + 0.06)   /* (3 cm over the snow's own step on every side: the same faces fought) */, new THREE.MeshStandardMaterial({ color: 0xc9a274, roughness: 0.8 }));
  box.position.set(X0 + cu, yb + st.h / 2 + 0.01, Z0 + cs + st.s + st.d / 2); box.castShadow = true; box.receiveShadow = true; box.updateMatrix(); box.matrixAutoUpdate = false; box.name = 'pool step'; group.add(box);
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
  kit.box('dark', cx, yc, cz, 3.2, 3.2, 6.4, ry); kit.box('white', cx, yc + 0.35, cz, 3.25, 0.35, 6.45, ry); kit.box('glass', cx, yc + 1.1, cz, 3.3, 1.4, 6.5, ry);   // (dark grey with a light band, as in 006)
  kit.pole('steel', new THREE.Vector3(cx, yc + 3.2, cz), new THREE.Vector3(cx, yc + 6.6, cz), 0.12);
}
