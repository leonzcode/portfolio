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
   Third pass (2026-11-08, for "expand the mountain make it bigger add more ski lifts" and "every kind of feature a
   Freeride World Tour venue has"): two more bowls over the arms, the West Glades and the Spine Wall (SIDES, sideLayout),
   rocks and drops under the Face Chair, and a natural halfpipe (HalfPipe). Where a rock face is (cliff) is the
   physics' wall; all else is snow to ride, kept under about 55 degrees. What is drawn is what is ridden: a band's face
   bulges in the land itself (Band.h), not only in the drawn rock.
   Everything is a height function over x (across, + skier's left looking down) and z (down the fall line), y up,
   with y = 0 at the main start. The physics reads it directly (terrain.js ground through setMountain); rock faces are
   steeper than skier.js's walls (about 53 degrees), so they are walls to ride into and drops to ride off.
   This module is plain JS (no three.js) so it can be checked in Node. */
import { simplex, fbm, ridged, smoothstep, clamp, smax } from './noise.js?v=26';

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
   higher than the middle (the rim a horseshoe), up to 16 m forward at 150 m out (and no more past it). Past 150 m the
   arms: side ridges that rise A(z) over the bowl's edge on steep rocky walls, with crests from 195 m out, and their
   outer sides falling away into the side bowls (sideY); low on the face they sink into the valley. */
const zs = x => { const a = Math.min(150, Math.abs(x)); return 0.0007 * a * a; };
/* (each arm's wall foot, crest and height along the face tabulated every metre of z: a few noises a sample before) */
const AZ0 = -600, AN = 2200;
/* (2026-11-08, second pass: the ridges between the bowls read as ridges, not straight lines) a col in each arm, a low
   place where its ridge dips to a few metres over the bowls either side, mid-face: ridden through, a rider crosses from
   one bowl to the next (towards the side bowls it is downhill). The east one between the wall buttresses at z 260 and
   380, the west one between those at 190 and 320. And the arms are gone by z 640 (they were by 720), so the runouts
   join in one valley you can cross anywhere. */
export const COLS = [{ z: 256, w: 52 }, { z: 322, w: 52 }];
const colDip = (e, z) => { const c = COLS[e], u = (z - c.z) / c.w; return 0.8 * Math.exp(-u * u); };
const armFade = z => smoothstep(-70, 60, z) * (1 - smoothstep(430, 640, z));
const ARM = [0, 1].map(e => {
  const foot = new Float32Array(AN), crest = new Float32Array(AN), A = new Float32Array(AN), fl = new Float32Array(AN);
  for (let i = 0; i < AN; i++) {
    const z = AZ0 + i;
    foot[i] = 146 + 11 * Math.sin(z * 0.013 + (e ? 0.7 : 2.9)) + 6 * simplex(z * 0.025, e ? 3.3 : -3.3);
    // (the east crest wanders as the west one does now: it was held at 202 m out for the old chairlift, a ruler-straight
    // line the whole length of the mountain)
    // (and never under 58 m from the wall's foot, or the wall is steeper than snow should be: over 55 degrees with the face's)
    crest[i] = foot[i] + Math.max(58, (e ? 60 : 58) + (e ? 8 : 12) * Math.sin(z * 0.009 + (e ? 4.1 : 1.3)) + (e ? 4 : 6) * simplex(z * 0.02 + 7, e ? -1.7 : 1.1));
    // (above the shoulder, on the Peak, none, 2026-11-10: the arms ran on up the Peak as spurs 10 to 14 m high, higher
    // than its summit, which the chairlift's top could not reach)
    A[i] = ((e ? 28 : 34) * (1 + 0.18 * simplex(z * 0.011, e ? 5 : -5)) * armFade(z) + (e ? 8 : 14) * (1 - smoothstep(-40, 60, z)) * smoothstep(-270, -190, z)) * (1 - colDip(e, z));
    // (where the outer side starts to fall away: wandering gently along the face, never as fast as the crest, which made
    // 63 degree creases down the fall line when the flank followed it)
    fl[i] = (e ? 216 : 222) + 9 * Math.sin(z * 0.012 + (e ? 1.7 : 4.4)) + 4 * simplex(z * 0.02, e ? 6 : -6);
  }
  return { foot, crest, A, fl };
});
function arms(x, z) {
  const a = Math.abs(x);
  if (a < 128) return 0;
  /* the inner wall's foot wanders in and out along the face (bays and spurs), and so do both arms' crests (2026-11-08,
     second pass: the east one stayed 202 m out, where the old chairlift ran up it). Their height along the face: low at
     the summit ridge's ends, highest over the middle of the face, dipping at each arm's col, gone by the apron */
  const T = ARM[x > 0 ? 1 : 0], q = clamp(z - AZ0, 0, AN - 1.001), i = q | 0, t = q - i;
  const foot = T.foot[i] + (T.foot[i + 1] - T.foot[i]) * t;
  if (a < foot - 1) return 0;
  const crest = T.crest[i] + (T.crest[i + 1] - T.crest[i]) * t, A = T.A[i] + (T.A[i + 1] - T.A[i]) * t, fl = T.fl[i] + (T.fl[i + 1] - T.fl[i]) * t;
  const u = clamp((a - foot) / (crest - foot), 0, 1), up = u * u * (2.2 - 1.2 * u);       // (concave at its foot, rounding over at the top)
  // (over the crest, falling away outside into the side bowl beyond (sideY), steeply up high, gently where the arms fade
  // out low down, so the three runouts join in one valley)
  // (from its own line, fl, wandering gently: see ARM)
  // (none in the valley below z 680, where the arms have gone: there it left a crease down the runout)
  // (rounding over into a steady fall over 20 m: the old ramp, (a - fl) x smoothstep, overshot to 1.7 times its slope
  // half way, 50 degrees across a ridge's flank)
  // (2026-11-10: but far out, past the side bowls' middles, it goes on down the valley: eased away there too, the main
  // surface came back up over the side valleys in a step and left a level bench across them at z 660 to 680)
  const fo = (0.25 + 0.4 * armFade(z)) * (1 - smoothstep(560, 680, z) * (1 - smoothstep(250, 320, a))) * smoothstep(-270, -190, z), dO = a - fl, out = dO <= 0 ? 0 : dO < 20 ? fo * dO * dO / 40 : fo * (dO - 10);
  return A * up - out + 1.8 * simplex(x * 0.03 + 9, z * 0.02) * smoothstep(foot, foot + 25, a);
}
/* (2026-11-10) the Peak a summit, not a level crest: from the chairlift's top (x 28) its crest falls away east and west,
   about 9% past 50 m out, so a rider off the chair rides down to the lines across its face (it was level, and its face's
   sides stood 3 to 10 m over the middle where the chair arrives: 400 m of climbing to the far lines). Faded out down the
   face to nothing at the shoulder (z -185). */
function peakFall(x, z) {
  if (z > -185) return 0;
  const d = Math.abs(x - 28), s = d < 50 ? 0 : d < 110 ? (d - 50) * (d - 50) / 120 : d - 80;
  return -0.09 * s * smoothstep(-185, -300, z);
}
/* the runout: one valley under all three bowls, a shallow channel down to each chairlift's bottom station (2026-11-08:
   it swung east to the old lift's bottom, 200 m out on the east arm) */
/* (2026-11-10: one chairlift, x 28. Out of the corral's channel the valley floor drains home, so a rider let go anywhere
   down there slides back to the chair's bottom or past z 799, where the game ends a run and puts them on it: past 100 m
   out it rises 6% outwards to 350 m out (from z 540, eased in over 160 m), then back down by 500 m out (far out, where
   the valley's own fall takes them home, its rise along the valley left them stopped). Snow holds a ski still under about 8% and a sled under about 10%: at 4.5%
   across, riders out of the side bowls stopped there, 0.1 to 2 m/s, and had to skate home. And the whole valley floor
   falls 5% more from z 600 to 840 (eased in and out over 40 m), as the valley's own fall is about 10% there, too little
   for a sled. The faces above z 540 are as they were) */
export const LIFT_XS = [28];
function runout(x, z) {
  if (z <= 540) return 0;
  const d = Math.abs(x - LIFT_XS[0]), k = smoothstep(620, 820, z);
  const R = z < 600 ? 0 : z < 640 ? (z - 600) * (z - 600) / 80 : z < 800 ? z - 620 : z < 840 ? 200 - (840 - z) * (840 - z) / 80 : 200;
  // (the corral's own channel, 1.3 m deep at 130 m out: to 190 m out, as it was, its depth growing down the valley held
  // the floor out there near level)
  return k * 0.00008 * Math.min(d, 130) ** 2 + 0.06 * Math.min(Math.max(0, d - 100), 250) * smoothstep(540, 700, z) * (1 - smoothstep(350, 500, d)) - 0.05 * R;
}
// the far mountains: grow from about 540 m out, past the side bowls' outer ridges (2026-11-08: from 300 m, which put
// rough peaks where the side bowls are now)
function far(x, z) {
  // (2026-11-10: beside the valley, from z 440 to 1100, they start 460 m further out, past 1000 m: riders drifting out of
  // the side bowls stopped in the hollows of their foothills, a long skate from home)
  const vb = smoothstep(440, 560, z) * (1 - smoothstep(950, 1100, z));
  const dx = Math.max(0, Math.abs(x) - 540 - 460 * vb), dz = Math.max(0, -500 - z, z - 1150), d = Math.hypot(dx, dz);
  if (d < 1) return 0;
  // (lower than they were, 2026-11-08 second pass: their ridged creases stood 70 to 77 degree faces in view from the
  // side bowls, bright streaked walls on the skyline)
  const k = smoothstep(0, 700, d);
  return k * (190 * ridged(x * 0.0011 + 7.7, z * 0.0011 - 2.3, 4) - 40);
}
/* ---- the side bowls (2026-11-08, for Leon's "for freeride expand the mountain make it bigger add more ski lifts as
   well"): over each arm another bowl down the same long profile (the summit's shoulder, the brink, the face easing all the
   way down, the apron), between the main bowl's arm and an outer ridge of its own, each with its own chairlift and its
   own kind of riding: the West Glades (skier's right: rollers, a natural halfpipe, hips, pillows, step-downs, gaps,
   logs, glades of trees low down) and the Spine Wall (skier's left: Alaska spines, a couloir, big cliffs and cornices).
   Its floor hw m either side of xc, its walls wall m wide rising A m (as the arms do: highest over the face, gone by the
   apron), and past its ridges falling away, so the arm's own surface (or the far mountains) takes over there. */
export const SIDES = [
  { name: 'West Glades', xc: -352, hw: 84, wall: 62, A: 34, seed: 5 },
  { name: 'Spine Wall', xc: 352, hw: 80, wall: 62, A: 38, seed: 9 },
];
// (each side's wall height along the face tabulated every metre, as the arms' are)
/* (2026-11-08, second pass) each wall its own height along the face (the inner one, towards the main bowl, with the
   arm's col in it) and its own foot, wandering in and out as the main bowl's do, so the ridges between the bowls and
   the outer ones are not straight lines down the whole mountain */
SIDES.forEach((S, k) => {
  const e = S.xc > 0 ? 1 : 0;
  S.tA = new Float32Array(AN); S.tAi = new Float32Array(AN); S.tHw = new Float32Array(AN); S.tHi = new Float32Array(AN);
  for (let i = 0; i < AN; i++) {
    const z = AZ0 + i, A0 = S.A * (1 + 0.15 * simplex(z * 0.011, S.seed)), top = 12 * (1 - smoothstep(-40, 60, z)) * smoothstep(-270, -190, z), A = A0 * armFade(z) + top;
    /* (the outer wall stands on to the lift's bottom, fading from z 600 to 800, 2026-11-08 second pass: gone by 640 as
       the inner one is, a rider drifting out of the West Glades low down crossed a 15 m ridge into the side valley and
       came out on the valley floor 400 m from the chairlift) */
    S.tA[i] = A0 * smoothstep(-70, 60, z) * (1 - smoothstep(600, 800, z)) + top; S.tAi[i] = A * (1 - colDip(e, z));
    S.tHw[i] = S.hw + 9 * Math.sin(z * 0.011 + S.seed) + 5 * simplex(z * 0.022, S.seed + 2);           // (the outer foot)
    // (the inner foot wanders in only, towards the side bowl's middle: further out, its ridge and the fall past it stood
    // into the main bowl's wall beyond the arm and steepened it to 55 to 58 degrees)
    S.tHi[i] = S.hw - 6 + 6 * Math.sin(z * 0.012 + S.seed * 2.3) + 4 * simplex(z * 0.024, S.seed - 2);     // (the inner foot)
  }
});
function sideY(S, x, z) {
  const s = Math.abs(x - S.xc), inner = (x - S.xc) * S.xc < 0;
  let y = baseZ(z - 0.0006 * Math.min(s, 120) ** 2);
  const q = clamp(z - AZ0, 0, AN - 1.001), i = q | 0, f = q - i, H = inner ? S.tHi : S.tHw, hw = H[i] + (H[i + 1] - H[i]) * f;
  if (s > hw) {
    // (the outer wall 10 m wider than the inner: with its foot wandering, at the inner one's width it stood at 55 to 56
    // degrees in places, a few more than when its foot was a straight line)
    const T = inner ? S.tAi : S.tA, A = T[i] + (T[i + 1] - T[i]) * f, wall = inner ? S.wall : S.wall + 10;
    const u = Math.min(1, (s - hw) / wall), up = u * u * (2.2 - 1.2 * u);
    y += A * up + 1.6 * simplex(x * 0.03 + S.seed, z * 0.02) * smoothstep(hw, hw + 25, s);
    // (past its ridge falling away: fast towards the main bowl, where the arm's own surface takes over; gently on the
    // outside, towards the far mountains)
    // (rounding over into the fall across 16 m: its slope stepping straight to the fall made a ripple where the two
    // bowls' surfaces met, a crease down the valley)
    /* (the outside, 2026-11-08 second pass: down 30 m at most, a side valley along the bowl that joins the runout. It
       fell on and on, 300 m by 1100 m out, a long face leading riders off the mountain, and where it was eased back up
       to the runout's level it stood a 230 m wall across the valley at z 600) */
    // (the inner side's rounding starts 8 m sooner, so past it the fall is where it was before it was rounded)
    const past = s - hw - wall - (inner ? -2 : 6);
    // (2026-11-10: and on down the valley, a side valley falling with it past the chair's bottom: eased back up to the
    // runout's level from z 560, it left closed basins riders could not get out of)
    if (past > 0) { const r = past < 16 ? past * past / 32 : past - 8; y -= inner ? 1.2 * r : 0.5 * 60 * (1 - Math.exp(-r / 60)); }
  }
  return y;
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
  // (2026-11-08) the side bowls' own ribs and gullies: the West Glades
  { x: -296, a: 4.0, w: 24, z0: 40, z1: 520, ph: 0.7 }, { x: -372, a: 4.6, w: 26, z0: 200, z1: 520, ph: 3.7 },
  { x: -420, a: -3.6, w: 18, z0: 80, z1: 560, ph: 5.1 },
  // and the Spine Wall: a gully under the spines and a rib under the lift
  { x: 312, a: -4.2, w: 24, z0: 280, z1: 560, ph: 1.1 }, { x: 420, a: 3.8, w: 20, z0: 60, z1: 520, ph: 4.3 },
  // and the Peak's face
  { x: -96, a: 3.4, w: 22, z0: -300, z1: -230, ph: 2.0 }, { x: -24, a: -3.0, w: 20, z0: -300, z1: -240, ph: 4.1 }, { x: 108, a: 3.0, w: 20, z0: -300, z1: -240, ph: 0.4 },
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
  // (and on the side bowls' floors, 2026-11-08)
  const ax = Math.abs(x), sd = ax > 200 ? 1 - smoothstep(76, 96, Math.abs(ax - 352)) : 0;
  const k = (smoothstep(-10, 30, z) * (1 - smoothstep(560, 660, z)) + smoothstep(-330, -305, z) * (1 - smoothstep(-205, -180, z))) * Math.max(1 - smoothstep(170, 190, ax), sd);
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
    /* (2026-11-13, for "less messy and everything has more of a flow": a landing to land on) land: metres below the foot
       where the apron keeps the slope's own steepness (or steeper, by steep: a tan added at the foot, easing to none at
       land's end) before the drop is made up; with none, as before, the apron eases at once, where riders come down.
       The bands on the named lines were tuned (scratchpad tune.mjs) for flights at 6 to 18 m/s: a long bench above
       (Rup), so the lip is not a kicker over the steep landing, a landing long enough for a fast rider's flight, and the
       drop made up slowly after it */
    Object.assign(this, { kind: 'band', a: 0.6, Rup: 16, Rdn: 24, wig: 1.2, seed: 1, rough: 0, name: 'Cliff band', rock: true, fw: 0, land: 0, steep: 0 }, o);
    this.xa = this.pts[0][0]; this.xb = this.pts[this.pts.length - 1][0];
    const Hs = mono(this.pts), Zs = this.lip ? mono(this.lip) : null;
    const S = 0.25, n = Math.ceil((this.xb - this.xa) / S) + 3;
    this.tS = S; this.tX = this.xa - S; this.tZ = new Float32Array(n); this.tH = new Float32Array(n);
    // (2026-11-13) and the band's height without its roughness, for its landing (h): rough, the landing below it ran down
    // the slope in ridges and troughs as long as the landing was
    this.tHs = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = this.tX + i * S;
      this.tZ[i] = (Zs ? Zs(x) : this.z) + wig(x, this.seed, this.wig);
      const r = this.rough ? 1 + this.rough * (simplex(x * 0.11, this.seed * 2.3) * 0.7 + 0.3 * simplex(x * 0.37, this.seed + 8)) : 1;
      this.tH[i] = x <= this.xa || x >= this.xb ? 0 : Math.max(0, Hs(x) * r);
      this.tHs[i] = x <= this.xa || x >= this.xb ? 0 : Math.max(0, Hs(x));
    }
    this.HsMax = Math.max(0.01, ...this.tHs);
    /* (2026-11-08) how far the face bulges out at mid-height, as a share of its width: broad swells along the band and
       smaller ones. They were pushed out on the drawn rock only (frrock.js), which stood rock over the snow at a face's
       foot and in front of where the rider met the face; now the land has them, so the drawing and the riding agree.
       At most 0.28 of the width, so the face never folds over (it still drops all the way down) */
    this.tB = new Float32Array(n);
    if (this.rock && this.look !== 'snow') for (let i = 0; i < n; i++) { const x = this.tX + i * S; this.tB[i] = 0.2 * (0.5 + 0.5 * simplex(x * 0.085 + this.seed, this.seed * 1.3)) + 0.06 * (0.5 + 0.5 * simplex(x * 0.33 + this.seed, 2.7)); }
    this.tC = new Float32Array(n);      // 1 / sqrt(1 + z'(x)^2): z distance to distance at right angles
    for (let i = 0; i < n; i++) { const a = this.tZ[Math.max(0, i - 1)], b = this.tZ[Math.min(n - 1, i + 1)], dz = (b - a) / (S * (i > 0 && i < n - 1 ? 2 : 1)); this.tC[i] = 1 / Math.sqrt(1 + dz * dz); }
    this.Hmax = Math.max(...this.tH);
    this.x0 = this.xa; this.x1 = this.xb;
    let zmin = Infinity, zmax = -Infinity; for (const z of this.tZ) { zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); }
    this.z0 = zmin - this.Rup * 1.6 - 1; this.z1 = zmax + (this.fwOf(this.Hmax) + this.land + this.Rdn) * 1.6 + 1;
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
    /* (the face's own width at right angles to the lip, d; the bench above and the apron below by plain z distance from
       the lip and the foot, 2026-11-08: at right angles there too, a wiggle of the lip turned into a fold across a
       58 m bench, 63 degrees steep) */
    const dz = z - zl, d = dz * c, w = this.fwOf(H), wz = w / c;
    let ld = this.land;
    if (dz < -this.Rup || dz > wz + ld + this.Rdn) return 0;
    const up = this.a * H;
    if (dz <= 0) { const t = 1 + dz / this.Rup; return up * t * t; }
    if (d < w) { const B = this.tB[i] + (this.tB[i + 1] - this.tB[i]) * t; return up - H * face(d - B * w * Math.sin(Math.PI * d / w), w); }
    // (the landing: held at the slope's steepness, or steeper at the foot, for ld m, then the drop made up over Rdn; both
    // less where the band is lower than its highest: a smaller drop needs a shorter landing. The rough band's drop at the
    // foot eases over 8 m into the smooth band's, so its roughness does not run on down the landing)
    const Hs = this.tHs[i] + (this.tHs[i + 1] - this.tHs[i]) * t, q = Math.min(1, 0.25 + 0.75 * Hs / this.HsMax), e = Math.max(0, dz - wz), S = this.steep * q * Math.min(1, Hs / 3);
    ld *= q;
    const low = up - H + ((this.a - 1) * Hs - (up - H)) * smoothstep(0, 8, e);
    if (e < ld) return low - S * e * (1 - e / (2 * ld));   // (e is never under 0 and ld over 0 here: no 0 / 0)
    return (low - S * ld / 2) * (1 - smoothstep(ld, ld + this.Rdn, e));
  }
  // on its rock face (from the lip to the foot, m metres either side): what the physics may treat as a cliff
  onFace(x, z, m) {
    if (!this.rock || x <= this.xa || x >= this.xb) return false;
    const H = this.H(x); if (H < 0.45) return false;
    const d = (z - this.zL(x)) * this.cs(x); return d > -m && d < this.fwOf(H) + m;
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
  // on its rock: a steep side wall or the end cliff (an outer slope as gentle as the face is snow to ride)
  onFace(x, z, m) {
    if (z < this.zTop + 2 || x < this.x0 || x > this.x1 || this.Dz(z) < 0.55) return false;
    const l = this.L(z), r = this.R(z), wl = this.wwL, wr = this.wwR, ze = this.zE(x);
    // (a chute's floor drops from 1.5 m in on the rib's top, Gully: the wall's rock reaches that far in, mi; an outer
    // slope is rock too, as it is drawn: only where it is steep does the physics treat it as a wall)
    const mi = Math.max(m, 1.8);
    if (z < ze + 0.3 && ((x > l - wl - m && x < l + mi) || (x < r + wr + m && x > r - mi))) return true;
    return x > l - wl && x < r + wr && z > ze - m && z < ze + this.wEnd + m;
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
    // (no rougher than a quarter of its half size, 2026-11-08: a small rock's rough corners crossed its drawn rows)
    this.wob = Math.min(this.wob, 0.25 * Math.min(this.hw, this.len / 2));
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
  // on its rock faces (its sides and lip)
  onFace(x, z, m) {
    if (x < this.x0 || x > this.x1 || z < this.z0 || z > this.z1 || this.raise(z) < 0.45) return false;
    const d = this.out(x, z); return d > -m && d < this.w + m;
  }
  // how far in from its edge its drawn rock reaches (frrock.js), and so how far in the terrain is held down under it
  back() { return Math.min(2.6, Math.min(this.hw, this.len / 2) * 0.9); }
  h(x, z) {
    if (x < this.x0 || x > this.x1 || z < this.z0 || z > this.z1) return 0;
    const d = this.out(x, z); if (d > this.w * 1.2) return 0;
    // (a little rough on top: snow over rock; broad lumps, 2026-11-08, so the drawn rock's points, 0.75 m apart, follow
    // them: at 1.4 m across they stood the drawn top up to 0.3 m off where the skis ride)
    return this.raise(z) * (1 - face(d, this.w)) + (d < 0 ? 0.1 * simplex(x * 0.3 + this.seed, z * 0.3) * smoothstep(0, -1.5, d) : 0);
  }
  dip(x, z, st, G, y) {
    if (x < this.x0 || x > this.x1 || z < this.z0 || z > this.z1) return Infinity;
    const d = this.out(x, z), Hh = this.raise(z);
    if (Hh < 0.5 || d < -Math.min(st + 0.3, this.back()) || d > this.w + 0.3) return Infinity;
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

const SPINE0 = smax(smax(0, 0, 1.6), 0, 2.5);
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
    // (the flute between two spines rounded, and the field never under the slope; faded in and out at its ends,
    // 2026-11-08: the roundings left it 0.2 m up where it began and ended, a step right across the field that took up
    // to 5 m/s off a rider in one step)
    // (less the field's own value with no spine near, SPINE0: it was 0.09 m everywhere in the field's box and a step at
    // its sides; and the flanks' feet rounded over 2.5 m, where a flank met the slope beside the field in a crease that
    // took up to 8 m/s off a rider crossing it)
    return Math.max(0, smax(smax(a, b, 1.6), 0, 2.5) - SPINE0) * smoothstep(this.za, this.za + 10, z) * (1 - smoothstep(this.zb - 10, this.zb, z));
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
  // (2026-11-08) a pillow's steep downhill front, over about 52 degrees on its own: a drop, as a rock's face is (it is
  // snow over a boulder); the rest of it is snow to ride
  onFace(x, z) {
    const e = 0.15, gx = this.h(x + e, z) - this.h(x - e, z), gz = this.h(x, z + e) - this.h(x, z - e);
    return gx * gx + gz * gz > (2 * e * 1.28) ** 2;
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

/* a natural halfpipe (2026-11-08): a gully worn into the slope down the fall line, a flat floor F m either side of its
   wandering middle and banked walls W m wide rising D m to the slope's own height (at most about 40 degrees across,
   50 with the slope's own fall), fading in and out at its ends */
export class HalfPipe {
  constructor(o) {
    Object.assign(this, { kind: 'hpipe', rock: false, name: 'Natural halfpipe', D: 5, F: 4, W: 9, seed: 6 }, o);
    this.x0 = this.x - this.F - this.W - 9; this.x1 = this.x + this.F + this.W + 9; this.z0 = this.za; this.z1 = this.zb;
  }
  cx(z) { return this.x + 5 * Math.sin(z * 0.012 + this.seed) + 2 * simplex(z * 0.02, this.seed); }
  h(x, z) {
    if (z <= this.za || z >= this.zb || x < this.x0 || x > this.x1) return 0;
    const d = Math.abs(x - this.cx(z)); if (d >= this.F + this.W) return 0;
    const e = smoothstep(this.za, this.za + 40, z) * (1 - smoothstep(this.zb - 50, this.zb, z));
    return -this.D * e * (1 - smoothstep(this.F, this.F + this.W, d));
  }
}
/* a banked turn (2026-11-13, flow): a berm of snow round the outside of a turn, its crest an arc of radius R round (cx,
   cz) from a0 to a1 degrees (0 is +x, 90 is +z, down the hill), H high: the inside face rises like a transition over wIn
   m to the crest (at most about 40 degrees across, more with the slope's own fall), the outside falls away over wOut m;
   faded in and out at its ends */
export class Bank {
  constructor(o) {
    Object.assign(this, { kind: 'bank', rock: false, name: 'Banked turn', H: 2.2, wIn: 6, wOut: 8 }, o);
    const R = this.R + this.wOut + 1; this.x0 = this.cx - R; this.x1 = this.cx + R; this.z0 = this.cz - R; this.z1 = this.cz + R;
  }
  h(x, z) {
    if (x < this.x0 || x > this.x1 || z < this.z0 || z > this.z1) return 0;
    const dx = x - this.cx, dz = z - this.cz, r = Math.hypot(dx, dz), s = this.R - r;
    if (s > this.wIn || -s > this.wOut) return 0;
    const ang = Math.atan2(dz, dx) * 180 / Math.PI, e = smoothstep(this.a0 - 25, this.a0 + 25, ang) * (1 - smoothstep(this.a1 - 25, this.a1 + 25, ang));
    if (e <= 0) return 0;
    const f = s >= 0 ? (1 - s / this.wIn) ** 2 : 1 - smoothstep(0, this.wOut, -s);
    return this.H * f * e;
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
  // (2026-11-08) its curl's steep front, over about 52 degrees on its own: a drop, as a cornice's is
  onFace(x, z) {
    const e = 0.1, gx = this.h(x + e, z) - this.h(x - e, z), gz = this.h(x, z + e) - this.h(x, z - e);
    return gx * gx + gz * gz > (2 * e * 1.28) ** 2;
  }
  h(x, z) {
    if (x <= this.xa || x >= this.xb) return 0;
    const e = smoothstep(this.xa, this.xa + 4, x) * (1 - smoothstep(this.xb - 4, this.xb, x));
    const d = z - this.zAt(x), hh = this.h0 * e * (0.8 + 0.2 * simplex(x * 0.15, this.seed));
    if (d < -this.up || d > this.dn) return 0;
    return d <= 0 ? hh * smoothstep(-this.up, 0, d) * (0.3 + 0.7 * smoothstep(-this.up, 0, d)) : hh * (1 - face(d, this.dn, 0.3));
  }
}

/* ---- the named lines (2026-11-13, for Leon's "less messy and everything has more of a flow"): each from its start (the
   pause menu's, freeride.js) down a way a rider can read, feature to feature, each feature's landing running out into
   the next one's in-run. pts: [x, z, the feature taken off there (its name in the layout, a kicker's or a jib's), the
   in-run in metres (25), a speed to come into the in-run at most: drops 10 m at 9 m/s, natural hits 14 m at 12, kickers
   22 m at 11, jibs 8 m at 8]. The bot that checks them (scratchpad flow.cjs) rides
   from waypoint to waypoint and lets the snow run in each in-run; the game itself only shows the starts and their signs. */
export const LINES = [
  // the main face, west to east
  { id: 'spines', name: 'The Spines', start: 'Summit: the Spines', pts: [[-96, 5], [-96, 40], [-90, 120], [-82, 168], [-80, 186, 'Spine lip (lower)', 14, 12], [-72, 240],
    [-71, 281.6, 'Selection kicker 2', 22, 11], [-73, 350, 'Selection lip', 14, 12], [-73, 398, 'Rock slab', 8, 8], [-73, 416.9, 'Log ledge log', 8], [-71, 485.5, 'Great Wall kicker (lane B)', 22, 11], [-71, 540]] },
  { id: 'selection', name: 'Selection kickers', start: 'Selection: the rock kickers', pts: [[-102, 190], [-102, 235.8, 'Selection kicker 1', 22, 11], [-104, 280],
    [-105, 318, 'Selection hit', 14, 12], [-106, 360], [-107, 392.8, 'Selection kicker 3', 22, 11], [-108, 440], [-108, 484.8, 'Great Wall kicker (lane A)', 22, 11], [-108, 540]] },
  { id: 'stepdowns', name: 'The step-downs', start: 'Summit: the step-downs', pts: [[-38, -9], [-38, 6.4, 'Summit cliffs (west)', 10, 9], [-38, 40], [-38, 65.3, 'The Teeth', 10, 9],
    [-36, 118.5, 'Upper steps', 10, 9], [-36, 160], [-36, 202.1, 'Tier A', 10, 9], [-38, 235.2, 'The step-down', 10, 9], [-24, 291.2, 'The Big Ones', 10, 9], [-22, 330], [-21, 346], [-21, 356], [-26, 366], [-36, 382],
    [-40, 400, 'Pillow line', 10, 9], [-40, 414, 'Pillow line', 6, 8], [-40, 428, 'Pillow line', 6, 8], [-40, 442, 'Pillow line', 6, 8], [-40, 456], [-38, 491.5, 'The Great Wall', 10, 9], [-38, 540]] },
  { id: 'centre', name: 'The centre line', start: 'Summit: the centre line', pts: [[0, -7], [0, 30], [0, 64.5, 'The Teeth', 10, 9], [0, 112, 'The centre hit', 14, 12], [2, 160],
    [2, 205, 'Tier A', 10, 9], [4, 287.3, 'The Big Ones', 10, 9], [5, 340], [6, 360, 'Centre hip', 12, 11], [8, 418, 'Pillow garden', 10, 9], [16, 470], [16, 501.3, 'The Great Wall', 10, 9], [16, 550]] },
  { id: 'liftline', name: 'The lift line', start: 'Top of the Summit Chair', pts: [[20, -36], [21, -10], [21, 8.4, 'Summit cliffs (east)', 10, 9], [24, 40], [27, 69.5, 'The Teeth', 10, 9],
    [24, 111.5, 'Rock drop (mid)', 10, 9], [22, 171.7, 'Lift line step', 10, 9], [22, 210, 'Tier A', 10, 9], [20, 291.5, 'The Big Ones', 10, 9], [21, 383.5, 'Lift line drop', 10, 9],
    [20, 440], [20, 500, 'The Great Wall', 10, 9], [20, 546, 'Lift line band', 10, 9], [20, 580]] },
  { id: 'narrow', name: 'The narrow chute', start: 'Summit: the narrow chute (mandatory air)', pts: [[63.8, 4], [64, 12, 'Corbet-style chute entrance', 10, 9], [64, 30], [65.4, 46], [65.7, 70], [65.6, 110], [66, 150],
    [66, 193, 'Fan lip', 14, 12], [66, 254, 'Fan cliffs', 10, 9], [68, 343.2, 'Fan rollers', 14, 12], [70, 422, 'Tree band', 10, 9], [80, 488, 'The Great Wall', 10, 9], [80, 540]] },
  { id: 'dogleg', name: 'The dog-leg', start: 'Summit: the Couloirs (the dog-leg)', pts: [[90, 3], [90.4, 46], [92.7, 52], [94.8, 58], [97.1, 64], [100.5, 70], [102.3, 76], [102.1, 82], [102.6, 94], [103.4, 106], [103.6, 124], [98, 160],
    [96, 195.5, 'Fan lip', 14, 12], [100, 262, 'Fan cliffs', 10, 9], [104, 346.8, 'Fan rollers', 14, 12], [110, 427.2, 'Tree band', 10, 9], [96, 485, 'The Great Wall', 10, 9], [96, 540]] },
  { id: 'wide', name: 'The wide chute', start: 'Summit: the wide chute', pts: [[125, 2], [125, 10, 'Wide chute cornice', 10, 9], [126, 60], [126, 110], [124, 160],
    [122, 198, 'Fan lip', 14, 12], [124, 300], [124, 348.8, 'Fan rollers', 14, 12], [122, 426.6, 'Tree band', 10, 9], [110, 481.6, 'The Great Wall', 10, 9], [110, 540]] },
  // the Peak, west to east
  { id: 'wave', name: 'The Wave', start: 'Peak: the Wave', pts: [[-380, -322], [-380, -292, 'The Wave', 14, 12], [-380, -238, 'The Little Wave', 14, 12], [-380, -190]] },
  { id: 'boulders', name: 'The Boulder Garden', start: 'Peak: the Boulder Garden', pts: [[-286, -322], [-284, -312], [-282.9, -298, 'Boulder pop', 10, 9], [-280.8, -280], [-281.3, -260, 'Boulder pop', 10, 9],
    [-284.6, -240], [-290.4, -222, 'Boulder pop', 10, 9], [-292, -200]] },
  { id: 'stairs', name: 'The Staircase', start: 'Peak: the Staircase', pts: [[-230, -322], [-229, -306, 'The Staircase', 10, 9], [-227, -282, 'The Staircase', 10, 9], [-230, -258, 'The Staircase', 10, 9],
    [-227, -232, 'The Staircase', 10, 9], [-229, -204, 'The Staircase', 10, 9], [-230, -180]] },
  { id: 'peakcliffs', name: 'The Peak cliffs', start: 'Peak: the cliffs', pts: [[-118, -318], [-118, -287, 'Peak cliffs', 10, 9], [-118, -200]] },
  { id: 'peakcouloir', name: 'The Peak couloir', start: 'Peak: the couloir', pts: [[89, -336], [88.3, -322], [88.6, -298], [89.6, -282], [90.6, -262], [90, -242], [90.5, -226], [90, -190]] },
  { id: 'fin', name: 'The Fin', start: 'Peak: the Fin', pts: [[214, -322], [222, -296, 'The Fin hip', 14, 12], [223, -200]] },
  { id: 'pillowstack', name: 'The Pillow Stack', start: 'Peak: the Pillow Stack', pts: [[283, -324], [283, -300, 'The Pillow Stack', 10, 9], [283, -200]] },
  { id: 'gate', name: 'The Gate', start: 'Peak: the Gate', pts: [[382, -322], [382, -296], [382, -259, 'Gate drop', 10, 9], [382, -200]] },
  // the side bowls
  { id: 'wgcornice', name: 'West Glades: the rollers', start: 'West Glades: the cornice', pts: [[-366, -4], [-366, 8], [-400, 40], [-400, 70, 'The rollers', 14, 12], [-400, 122, 'The rollers', 14, 12],
    [-400, 178, 'The rollers', 14, 12], [-406, 240], [-406, 297, 'West step-down', 10, 9], [-406, 313, 'West step-down', 10, 9], [-406, 420]] },
  { id: 'wghalfpipe', name: 'West Glades: the natural halfpipe', start: 'West Glades: the natural halfpipe', pts: [[-318, 30], [-320, 330], [-320, 400]] },
  { id: 'swspines', name: 'Spine Wall: the spines', start: 'Spine Wall: the spines', pts: [[306, 0], [306, 5, 'Cornice', 14, 12], [306, 270], [310, 292, 'Wind lip', 14, 12], [318, 346, 'East big band', 10, 9],
    [320, 397, 'East step-down', 10, 9], [320, 470]] },
  { id: 'swcouloir', name: 'Spine Wall: the couloir', start: 'Spine Wall: the couloir', pts: [[367, 2], [367, 10, 'East couloir cornice', 10, 9], [367.3, 28], [368.3, 52], [370.2, 68], [370.5, 100], [370.5, 140], [370, 200]] },
  { id: 'swband', name: 'Spine Wall: the big band', start: 'Spine Wall: the big band', pts: [[330, 310], [330, 347, 'East big band', 10, 9], [330, 398, 'East step-down', 10, 9], [330, 470]] },
];

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
  const R1 = new Rib({ name: 'Middle rib', wigL: 1.0, wigR: 1.0, xl: [[-20, 67.6], [28, 67.6], [42, 72], [75, 71], [130, 72.5]], xr: [[-20, 84], [44, 84], [62, 91.5], [74, 97.5], [130, 97.5]],
    zTop: 0, grow: 18, D: 13, Dpts: [[0, 10], [25, 15], [55, 12], [85, 16], [124, 13]], zEnd: 124, seed: 32, crest: 0.1 });
  const R2 = new Rib({ name: 'East rib', wigL: 1.0, wigR: 1.5, xl: [[-20, 96], [44, 96], [60, 100.5], [74, 106.5], [85, 106.5], [100, 109.5], [130, 109.5]], xr: [[-20, 119], [20, 116], [45, 118.5], [70, 122], [95, 119], [130, 121]],
    zTop: 4, grow: 18, D: 13, Dpts: [[4, 11], [35, 16], [70, 12], [100, 15], [118, 13]], zEnd: 118, seed: 33, crest: 0.12 });
  const R3 = new Rib({ name: 'Outer rib', wigL: 0.9, wigR: 3.4, wwR: 11, xl: [[-20, 133], [16, 133], [40, 131.5], [62, 135], [85, 133], [130, 136]], xr: [[-20, 146], [20, 150], [50, 147], [80, 153], [102, 149]],
    zTop: -2, grow: 18, D: 12, Dpts: [[-2, 8], [40, 14], [80, 10], [102, 12]], zEnd: 102, seed: 34, crest: 0.1 });
  F.push(R0, R1, R2, R3);
  // (2026-11-13: the dog-leg bends over 30 m, not 22, and its choke is about 4.5 m of floor, not 2.3: riders at speed hit its
  // wall on the bend's outside every time)
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
  F.push(new Band({ name: 'Summit cliffs (west)', lip: [[-74, 14], [-56, 9], [-36, 7], [-14, 9]], wig: 1.2, seed: 15, a: 0.45, Rup: 14, Rdn: 43, land: 39, steep: 0.1, rough: 0.2,
    pts: [[-76, 0], [-68, 4], [-58, 6.5], [-48, 3], [-42, 3.5], [-30, 7.5], [-20, 5], [-13, 0]] }));
  F.push(new Band({ name: 'Summit cliffs (east)', lip: [[13, 9], [26, 8], [40, 12]], wig: 1, seed: 16, a: 0.45, Rup: 14, Rdn: 43, land: 39, steep: 0.1, rough: 0.2, pts: [[13, 0], [19, 4.5], [30, 6], [37, 3], [42, 0]] }));
  // ---- the bowl's walls: buttresses of rock standing out of them, unridden (they frame the face)
  for (const [x, z, len, hw, h, rot, sd] of [[-168, 70, 46, 9, 12, 0.32, 161], [-176, 190, 60, 10, 16, 0.18, 162], [-170, 320, 44, 8, 11, 0.12, 163], [-160, 430, 30, 7, 7, 0.05, 164],
    [176, 120, 40, 8, 10, -0.3, 165], [170, 260, 52, 9, 13, -0.2, 166], [160, 380, 34, 7, 8, -0.1, 167]])
    // (rounder and less rough than they were, 2026-11-08: round a sharp, rough corner the drawn rock's rows crossed over
    // and stood rock up to 3 m off where the land had it)
    F.push(new Outcrop({ name: 'Wall buttress', x, z, len, hw, hUp: h, hDn: h * 0.8, w: 1.6, round: 0.65, rot, wob: hw * 0.12, seed: sd }));
  // ---- the centre, upper face: the Teeth, broken in three, curving down to the east
  F.push(new Band({ name: 'The Teeth', lip: [[-48, 66], [-20, 63], [8, 66], [30, 69], [46, 74]], wig: 1.3, seed: 3, a: 0.45, Rup: 22, Rdn: 36, land: 14, steep: 0.1, rough: 0.25,
    pts: [[-46, 0], [-40, 2.5], [-30, 3.5], [-24, 0.2], [-15, 0.2], [-8, 3.2], [2, 4], [10, 2.6], [16, 0.2], [22, 0.2], [28, 3], [37, 3.8], [44, 0]] }));
  // the Upper steps: a short band stepping down from the Teeth's west end
  F.push(new Band({ name: 'Upper steps', lip: [[-50, 118], [-30, 120], [-12, 124]], wig: 0.9, seed: 5, a: 0.45, Rup: 18, Rdn: 29, land: 12, steep: 0.1, rough: 0.2, pts: [[-50, 0], [-45, 2.6], [-32, 3], [-20, 2.2], [-12, 0]] }));
  /* (2026-11-13, for "less messy and everything has more of a flow": the rock kicker and the rock drop 25 to 30 m under
     the summit cliffs, where their flights came down, are gone; the mid-face's rock kicker, whose lip pointed 12 degrees
     up out of a 37 degree face and threw riders 27 m, is a snow hit now, its lip a little less steep than the face: you
     land on the face below it. The rock drop under the lift line is a rock step whose top is nearly as steep as the face) */
  F.push(new Lip({ name: 'The centre hit', xa: -16, xb: 14, z: 112, h0: 1.5, up: 8, dn: 1.4, seed: 53, slant: 0.04 }));
  F.push(new Outcrop({ name: 'Rock drop (mid)', x: 24, z: 106, len: 11, hw: 3.6, hUp: 0.3, hDn: 3.0, w: 1.0, round: 0.55, rot: -0.08, wob: 0.6, seed: 54 }));
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
  F.push(new Band({ name: 'Tier A', lip: [[-50, 203], [-24, 201], [-4, 204], [20, 208], [48, 215]], wig: 1.4, seed: 7, a: 0.45, Rup: 48, Rdn: 32, land: 31, steep: 0.1, rough: 0.12,
    pts: [[-58, 0], [-46, 5], [-24, 5], [-18, 0.3], [-10, 0.3], [-2, 6.5], [10, 8], [22, 6], [28, 0.3], [33, 0.3], [40, 7], [48, 0]] }));
  // the step-down's second 5 m drop, 14 m below the first: its ledge between is about 30 degrees, steep enough to land on
  // (2026-11-13: 33 m under Tier A, not 14: its flights came down on the second lip)
  F.push(new Band({ name: 'The step-down', lip: [[-52, 236], [-36, 235], [-23, 236]], wig: 0.8, seed: 8, a: 0.45, Rup: 15, Rdn: 24, land: 34, steep: 0.1, pts: [[-52, 0], [-45, 5], [-30, 5], [-23, 0]] }));
  F.push(new Band({ name: 'Fan cliffs', lip: [[56, 252], [76, 255], [100, 261], [120, 268], [140, 277]], wig: 1.8, seed: 13, a: 0.45, Rup: 36, Rdn: 84, land: 28, steep: 0.1, rough: 0.12,
    pts: [[56, 0], [63, 5], [76, 7], [84, 1], [90, 1], [98, 6], [106, 8], [112, 7.5], [120, 1], [125, 1], [131, 5], [140, 0]] }));
  // the Big Ones: 9 to 19 m wrapped round a buttress that stands out over the face (the lip bulging down round it)
  // (its lip's bulge round the buttress rounded off, 2026-11-08: its sharp point folded the 58 m bench above it into a
  // crease 63 degrees steep across)
  /* (2026-11-13, flow: 6 to 11 m, not 19, and its landing held steep, about 40 degrees at the foot, for 56 m: the 17 to 19 m
     sections landed at 15 to 16 m/s into the snow from any speed, on an apron that eased off where riders came down) */
  F.push(new Band({ name: 'The Big Ones', lip: [[-44, 296], [-22, 291], [0, 288], [14, 290], [24, 293], [36, 290.5], [48, 287], [60, 290], [74, 300]], wig: 1.5, seed: 11, a: 0.45, Rup: 75, Rdn: 60, land: 56, steep: 0.2, rough: 0.06,
    pts: [[-44, 0], [-30, 6], [-16, 8], [-6, 7], [4, 9], [12, 10.5], [20, 11], [28, 9.5], [34, 9.5], [41, 11], [49, 11], [58, 8.5], [74, 0]] }));
  // (2026-11-13: the buttress that stood in the Big Ones' landing is gone)
  // ---- below the Couloirs: rock kickers and outcrops over the fan
  // (2026-11-13: none now, between the Fan lip's landings and the Fan cliffs: a rock kicker and a rock drop stood where the
  // Fan lip set riders down)
  // ---- the Selection zone (skier's right): rock bands with kickers built on them (freeride.js), lips and outcrops
  // (each band level where its kicker stands, curving and breaking up at its ends)
  F.push(new Band({ name: 'Selection rock 1', lip: [[-130, 232], [-115, 237], [-89, 237], [-76, 243]], wig: 0.4, seed: 91, a: 0.85, Rup: 22, Rdn: 22, land: 14, steep: 0.08, pts: [[-130, 0], [-121, 2.4], [-112, 3.2], [-92, 3.2], [-84, 2.2], [-76, 0]] }));
  F.push(new Band({ name: 'Selection rock 2', lip: [[-96, 279], [-83, 283], [-59, 283], [-48, 288]], wig: 0.4, seed: 92, a: 0.85, Rup: 22, Rdn: 22, land: 14, steep: 0.08, pts: [[-96, 0], [-88, 2.4], [-80, 3.2], [-62, 3.2], [-54, 2.0], [-48, 0]] }));
  // (2026-11-13: the rock kicker to the west of them, pointing at nothing, is gone)
  // (2026-11-13) a snow hit in lane A between its first and third kickers (156 m of nothing before)
  F.push(new Lip({ name: 'Selection hit', xa: -116, xb: -94, z: 318, h0: 1.3, up: 7, dn: 1.2, seed: 94, slant: 0.02 }));
  /* (2026-11-13, flow: shaping the snow between the features) a roller across the fan, between the Fan cliffs' landings and
     the tree band (160 m of open fan before); a hip in the centre line's run-out under the Big Ones, its crest slanting
     across the fall line so it throws you a little sideways; a wind lip in Selection lane B between its kicker and the
     rock slab */
  F.push(new Band({ name: 'Fan rollers', lip: [[56, 342], [96, 346], [136, 350]], wig: 1.4, seed: 195, a: 0.45, Rup: 16, Rdn: 22, rock: false, fw: 14, pts: [[54, 0], [66, 2.6], [96, 3.2], [126, 2.8], [138, 0]] }));
  F.push(new Pillows({ name: 'Centre hip', list: [{ x: 6, z: 364, r: 7, h: 2.4, e: 1.7, a: 0.6 }] }));
  F.push(new Lip({ name: 'Selection lip', xa: -86, xb: -60, z: 350, h0: 1.1, up: 6, dn: 1.1, seed: 96, slant: -0.03 }));
  // and a banked turn in the step-downs' run-out under the Big Ones, carrying them round to the pillow line
  F.push(new Bank({ name: 'The bank', cx: -32, cz: 352, R: 16, a0: -35, a1: 65, H: 2.2, wIn: 6, wOut: 9 }));
  // ---- lower face: the pillow clusters
  F.push(new Pillows({ name: 'Pillow line', list: pillowLine() }));
  F.push(new Pillows({ name: 'Pillow garden', list: pillowGarden(10, 432, 28, 22, 22, 3) }));
  F.push(new Pillows({ name: 'West pillows', list: pillowGarden(-140, 438, 10, 16, 9, 5) }));
  // (2026-11-13: below the Great Wall's landing, not under its lip)
  F.push(new Pillows({ name: 'East pillows', list: pillowGarden(100, 542, 12, 9, 8, 7) }));
  // the pillow line's roll: the snow steepens over a convex break, the pillows stacked down it
  /* (2026-11-13, flow: the roll a real convex steepening, 16 m lower, the pillows stacked down its steep part. They sat on
     the Big Ones' run-out bench, at 12 to 20 degrees, each one's downhill side landing on the next one's uphill side) */
  F.push(new Band({ name: 'Pillow roll', lip: [[-66, 392], [-40, 396], [-16, 400]], wig: 1, seed: 66, a: 0.4, Rup: 16, Rdn: 40, rock: false, fw: 10, land: 50, steep: 0.32, pts: [[-78, 0], [-62, 3], [-24, 3], [-10, 0]] }));
  // the Selection zone, lower: lane A (x about -107): a rock band carrying a kicker, the stumps; lane B (x about -73): the
  // rock slab (freeride.js), the log ledge; both then the Great Wall's kickers. Boulders before the finish.
  F.push(new Band({ name: 'Selection rock 3', lip: [[-134, 389], [-118, 394], [-96, 394], [-82, 401]], wig: 0.4, seed: 101, a: 0.85, Rup: 22, Rdn: 22, land: 14, steep: 0.08, pts: [[-134, 0], [-124, 2.6], [-117, 3.4], [-97, 3.4], [-90, 2.4], [-82, 0]] }));
  F.push(new Band({ name: 'Log ledge', lip: [[-90, 425], [-81, 428], [-65, 428], [-56, 432]], wig: 0.4, seed: 103, a: 0.6, Rup: 14, Rdn: 18, land: 10, steep: 0.08, pts: [[-90, 0], [-82, 3], [-64, 3], [-56, 0]] }));
  // skier's left, lower: a small band into the trees, a rock kicker
  F.push(new Band({ name: 'Tree band', lip: [[62, 420], [84, 426], [104, 428], [122, 427], [138, 433]], wig: 1.6, seed: 111, a: 0.45, Rup: 20, Rdn: 60, land: 14, steep: 0.1, rough: 0.15, pts: [[62, 0], [70, 3], [84, 4], [92, 0.5], [98, 0.5], [106, 3.6], [122, 4], [138, 0]] }));
  // (2026-11-13: the rock kicker that stood in the tree band's landing is gone)
  // ---- the Great Wall: the last band across the face, sagging in the middle and stepping up to the east, kickers
  // built on it at four places (freeride.js; each lane level and 3.5 to 4.5 m), breaks to ride round, 5 to 5.5 m drops
  F.push(new Band({ name: 'The Great Wall', lip: [[-130, 480], [-114, 486], [-102, 486], [-90, 489], [-77, 487], [-65, 487], [-50, 492], [-36, 492], [-24, 492], [-6, 498], [12, 501], [34, 496], [46, 496], [62, 492], [90, 486], [120, 478]],
    wig: 1.2, seed: 121, a: 0.75, Rup: 18, Rdn: 24, rough: 0.05,
    pts: [[-128, 0], [-118, 3.5], [-99, 3.5], [-92, 0.6], [-86, 0.6], [-80, 3.5], [-62, 3.5], [-55, 0.6], [-47, 0.6], [-40, 4], [-20, 4], [-12, 5], [-5, 0.6], [5, 0.6], [12, 5], [24, 5.5], [32, 4], [48, 4], [56, 5], [64, 0.6], [72, 0.6], [80, 4.5], [104, 5], [120, 0]] }));
  // ---- rock showing through: boulders and small rock steps scattered over the face, turned and roughened each
  /* (2026-11-13, for "less messy": only the rock islands by the bowl's walls are left, framing the face; the twenty others
     stood in the lines, in landings and run-outs, a rock to land on or hit wherever you went) */
  const rocks = [
    // [x, z, len, hw, height at the downhill end, rot, wob]
    [-150, 300, 3.4, 2.4, 2.0, -0.5, 0.5], [140, 340, 4, 3, 2.2, 0.2, 0.6], [-146, 262, 8, 4.5, 4.5, 0.3, 1.2], [148, 314, 9, 5, 5, -0.4, 1.3],
  ];
  rocks.forEach(([x, z, len, hw, h, rot, wob], i) => F.push(new Outcrop({ name: 'Rock island', x, z, len, hw, hUp: 0.4, hDn: h, w: 0.9, round: 0.6, rot, wob, seed: 131 + i })));
  // small rock steps on the walls of the bowl (rock bands showing through, 1.5 to 3 m)
  F.push(new Band({ name: 'West wall band', lip: [[-176, 150], [-160, 158], [-146, 170]], wig: 1.4, seed: 151, a: 0.5, Rup: 10, Rdn: 14, rough: 0.3, pts: [[-178, 0], [-170, 2.6], [-158, 3], [-146, 0]] }));
  F.push(new Band({ name: 'East wall band', lip: [[150, 214], [164, 206], [182, 196]], wig: 1.4, seed: 152, a: 0.5, Rup: 10, Rdn: 14, rough: 0.3, pts: [[150, 0], [158, 2.4], [172, 3], [182, 0]] }));
  F.push(new Band({ name: 'West wall step', lip: [[-170, 344], [-156, 352], [-144, 362]], wig: 1, seed: 153, a: 0.5, Rup: 10, Rdn: 12, rough: 0.3, pts: [[-172, 0], [-164, 2.2], [-154, 2.4], [-144, 0]] }));
  F.push(new Outcrop({ name: 'Boulder', x: -126, z: 548, len: 5, hw: 3, hUp: 0.4, hDn: 2.6, w: 1.2, round: 0.8, rot: 0.4, wob: 0.6, seed: 104 }));
  F.push(new Outcrop({ name: 'Boulder', x: -86, z: 562, len: 4.5, hw: 2.6, hUp: 0.4, hDn: 2.2, w: 1.1, round: 0.8, rot: -0.3, wob: 0.5, seed: 105 }));
  F.push(new Outcrop({ name: 'Boulder', x: -58, z: 552, len: 5, hw: 3.2, hUp: 0.3, hDn: 2.8, w: 1.2, round: 0.75, rot: 0.7, wob: 0.6, seed: 106 }));
  sideLayout(F);
  return F;
}
/* ---- more to ride (2026-11-08, for Leon's "more rocks and drops under the lift" and "expand Freeride a lot: every kind
   of feature a Freeride World Tour venue has"): under the Face Chair's line (x 28), and the two side bowls */
function sideLayout(F) {
  // ---- under the Face Chair: a rock step, a cluster of small drops with gaps between them, a drop, a low band
  F.push(new Band({ name: 'Lift line step', lip: [[14, 170], [30, 172], [46, 176]], wig: 0.8, seed: 171, a: 0.45, Rup: 16, Rdn: 29, land: 12, steep: 0.1, rough: 0.2, pts: [[13, 0], [19, 2.6], [30, 3.4], [40, 2.8], [46, 0]] }));
  // (either side of the line, so its towers have room between them)
  // (2026-11-13: the three rocks stood where the Big Ones set riders down; the drop is a rock step now, its top nearly as
  // steep as the face, not a kicker, on the lift line's own way down west of the chair)
  F.push(new Outcrop({ name: 'Lift line drop', x: 21, z: 378, len: 11, hw: 3.8, hUp: 0.3, hDn: 3.4, w: 1.0, round: 0.55, rot: 0.06, wob: 0.6, seed: 175 }));
  F.push(new Band({ name: 'Lift line band', lip: [[10, 545], [28, 548], [46, 546]], wig: 0.7, seed: 176, a: 0.45, Rup: 24, Rdn: 54, land: 12, steep: 0.1, rough: 0.15, pts: [[9, 0], [16, 3], [28, 3.8], [38, 3.2], [46, 0]] }));

  // ---- the West Glades (x -268 to -436): a snow cornice along the brink with a way in, rollers, a natural halfpipe, hips,
  // a step-down, a gap between rocks, a rock rail and logs (freeride.js), pillows; glades of trees lower down
  F.push(new Band({ name: 'West cornice', look: 'snow', lip: [[-430, 9], [-400, 6], [-370, 8], [-340, 7], [-310, 10]], wig: 1.0, seed: 181, a: 0.3, Rup: 7, Rdn: 14, rough: 0.15,
    pts: [[-432, 0], [-424, 2.4], [-404, 3.4], [-384, 2.8], [-372, 0.2], [-360, 0.2], [-350, 2.6], [-326, 3.2], [-310, 0]] }));
  F.push(new Lip({ xa: -428, xb: -312, z: 5.6, h0: 0.6, up: 3, dn: 0.5, seed: 182, slant: 0.01, name: 'Cornice' }));
  for (const [z, a0] of [[70, 0], [122, 1], [178, 2]])
    F.push(new Band({ name: 'The rollers', lip: [[-440, z + 4], [-410, z], [-372, z + 3]], wig: 1.4, seed: 183 + a0, a: 0.45, Rup: 16, Rdn: 22, rock: false, fw: 14, pts: [[-444, 0], [-430, 2.6], [-396, 3.2], [-374, 2.4], [-366, 0]] }));
  F.push(new HalfPipe({ name: 'The natural halfpipe', x: -320, za: 40, zb: 330, D: 6, F: 3.5, W: 9, seed: 6 }));
  F.push(new Pillows({ name: 'The hips', list: [{ x: -348, z: 210, r: 7, h: 3.2, e: 1.7, a: 0.7 }, { x: -404, z: 262, r: 6.5, h: 3.0, e: 1.6, a: -0.7 }, { x: -296, z: 372, r: 6, h: 2.8, e: 1.5, a: 0.6 }] }));
  F.push(new Band({ name: 'West step-down', lip: [[-428, 300], [-406, 297], [-384, 300]], wig: 0.6, seed: 186, a: 0.45, Rup: 12, Rdn: 10, land: 8, steep: 0.1, rough: 0.12, pts: [[-430, 0], [-424, 4], [-392, 4], [-384, 0]] }));
  F.push(new Band({ name: 'West step-down', lip: [[-424, 315], [-406, 313], [-388, 316]], wig: 0.6, seed: 187, a: 0.35, Rup: 6, Rdn: 22, land: 14, steep: 0.1, rough: 0.12, pts: [[-426, 0], [-420, 4], [-394, 4], [-388, 0]] }));
  F.push(new Outcrop({ name: 'Gap rock (takeoff)', x: -352, z: 344, len: 5.5, hw: 3.4, hUp: 0.15, hDn: 3.6, rot: 0.05, wob: 0.4, seed: 188 }));
  F.push(new Outcrop({ name: 'Gap rock', x: -352, z: 356, len: 6, hw: 4, hUp: 1.2, hDn: 2.2, w: 1.0, round: 0.6, rot: -0.1, wob: 0.6, seed: 189 }));
  F.push(new Pillows({ name: 'Glade pillows', list: pillowGarden(-300, 440, 24, 18, 16, 11) }));
  // (2026-11-13: not the two in the step-down's run-out, x -420 and -410)
  for (const [x, z, len, hw, h, rot] of [[-336, 500, 4.5, 3, 2.2, -0.4], [-280, 300, 4, 3, 2.0, 0.8]])
    F.push(new Outcrop({ name: 'Rock island', x, z, len, hw, hUp: 0.4, hDn: h, w: 0.9, round: 0.6, rot, wob: 0.6, seed: 190 + x + z }));

  // ---- the Spine Wall (x 272 to 432): snow cornices along the brink, Alaska-style spines, a couloir between two rock ribs
  // ending in cliffs, a big band of rock with a step-down under it, cliffs under the lift, wind lips, rock islands
  F.push(new Band({ name: 'East cornices', look: 'snow', lip: [[276, 8], [300, 5], [326, 7], [346, 6]], wig: 0.9, seed: 201, a: 0.3, Rup: 7, Rdn: 14, rough: 0.2,
    pts: [[274, 0], [282, 3.0], [300, 4.0], [314, 2.6], [322, 0.2], [330, 0.2], [336, 2.2], [346, 0]] }));
  F.push(new Lip({ xa: 276, xb: 346, z: 4.6, h0: 0.7, up: 3, dn: 0.5, seed: 202, name: 'Cornice' }));
  F.push(new Spines({ name: 'The Spine Wall', za: 18, zb: 270, cross: 0.78, list: [{ x: 292, h: 7, ph: 0.9, za: 24, zb: 230 }, { x: 306, h: 9, ph: 2.6 }, { x: 320, h: 8.5, ph: 4.4, zb: 250 }, { x: 334, h: 6, ph: 1.7, za: 30, zb: 210 }] }));
  const E0 = new Rib({ name: 'East couloir rib', wigL: 1.2, wigR: 1.0, wwL: 9, xl: [[0, 350], [60, 352], [130, 351]], xr: [[0, 361], [40, 362], [70, 366], [130, 365]], zTop: 4, grow: 16, D: 11, Dpts: [[4, 8], [40, 12], [90, 10], [128, 12]], zEnd: 128, seed: 203, crest: 0.1 });
  // (its choke 8 m between the walls' tops, about 3 m of floor, as Corbet's; 2026-11-08 second pass: a metre wider, the
  // floor had narrowed to 2 m at z 90 where the walls wander in)
  const E1 = new Rib({ name: 'East couloir rib', wigL: 1.0, wigR: 1.4, wwR: 9, xl: [[0, 372], [40, 373.2], [70, 374.2], [130, 376]], xr: [[0, 384], [130, 387]], zTop: 6, grow: 16, D: 12, Dpts: [[6, 9], [50, 13], [100, 11], [134, 12]], zEnd: 134, seed: 204, crest: 0.12 });
  F.push(E0, E1);
  F.push(new Gully({ name: 'The east couloir', ribs: [E0, E1], left: { L: z => E0.R(z), ww: E0.ww }, right: { L: z => E1.L(z), ww: E1.ww }, xa: 356, xb: 378, za: 12, zb: 70, zc: 140, E: 3.2 }));
  F.push(new Band({ name: 'East couloir cornice', look: 'snow', z: 10, wig: 0.25, seed: 205, a: 0.2, Rup: 6, Rdn: 12, pts: [[362, 0], [363.4, 3.2], [369.6, 3.2], [371, 0]] }));
  F.push(new Lip({ name: 'Wind lip', xa: 280, xb: 342, z: 292, h0: 0.85, up: 4.5, dn: 1.0, seed: 206, slant: 0.05 }));
  // (2026-11-13: 9 m at most, its landing held steep for 34 m, as the Big Ones': at 12.5 m no speed landed it soft)
  F.push(new Band({ name: 'East big band', lip: [[292, 352], [318, 346], [346, 350], [372, 357], [398, 352]], wig: 1.4, seed: 207, a: 0.45, Rup: 60, Rdn: 90, land: 48, steep: 0.1, rough: 0.1,
    pts: [[290, 0], [298, 5.5], [314, 7.5], [326, 9], [338, 6.5], [346, 0.4], [352, 0.4], [358, 6.5], [372, 8.5], [390, 5.5], [398, 0]] }));
  // (2026-11-13: 18 m further down, out of the big band's held landing)
  F.push(new Band({ name: 'East step-down', lip: [[300, 418], [320, 415], [340, 417]], wig: 0.6, seed: 208, a: 0.45, Rup: 15, Rdn: 54, land: 12, steep: 0.1, pts: [[300, 0], [306, 4.5], [334, 4.5], [340, 0]] }));
  F.push(new Band({ name: 'Far cliffs', lip: [[392, 214], [408, 210], [426, 215], [436, 220]], wig: 1.2, seed: 209, a: 0.45, Rup: 45, Rdn: 72, land: 42, steep: 0.1, rough: 0.12, pts: [[390, 0], [398, 7], [410, 10.5], [422, 9], [434, 0]] }));
  // (2026-11-13: a rock step you pop off, its top a little less steep than the slope: its lip pointed up and threw riders)
  F.push(new Outcrop({ name: 'Rock kicker (east)', x: 300, z: 472, len: 9, hw: 3.4, hUp: 0.2, hDn: 2.6, w: 1.0, rot: -0.08, wob: 0.4, seed: 210 }));
  for (const [x, z, len, hw, h, rot] of [[402, 300, 5, 3.4, 2.8, 0.3], [424, 420, 5.5, 3.6, 3.2, -0.4], [360, 450, 4.5, 3, 2.4, 0.6], [293, 130, 4, 3, 2.0, -0.2], [396, 520, 5, 3.4, 2.6, 0.4]])
    F.push(new Outcrop({ name: 'Rock island', x, z, len, hw, hUp: 0.4, hDn: h, w: 0.9, round: 0.6, rot, wob: 0.6, seed: 211 + x + z }));
  F.push(new Pillows({ name: 'East pillows', list: pillowGarden(366, 500, 16, 12, 10, 13) }));

  // ---- the Peak (2026-11-08): the 34 degree face from the true summit (z -350) down to the shoulder (z -185), the
  // chairlift's top on it (freeride.js): a snow cornice along the crest with a way in, a cliff band on its west side, a
  // couloir between two rock ribs, a band on its east side, rock islands
  // (2026-11-10: the couloir and the east band 40 m further east, clear of the chairlift's line at x 28)
  F.push(new Band({ name: 'Peak cornice', look: 'snow', lip: [[-136, -334], [-100, -338], [-60, -337], [-20, -336], [8, -333]], wig: 1.0, seed: 221, a: 0.3, Rup: 7, Rdn: 14, rough: 0.15,
    pts: [[-138, 0], [-128, 3], [-100, 4], [-80, 3.4], [-74, 0.2], [-48, 0.2], [-42, 3], [-14, 3.6], [8, 0]] }));
  F.push(new Lip({ xa: -134, xb: -76, z: -338.6, h0: 0.6, up: 3, dn: 0.5, seed: 222, slant: 0.02, name: 'Cornice' }));
  F.push(new Lip({ xa: -46, xb: 6, z: -337.4, h0: 0.6, up: 3, dn: 0.5, seed: 227, slant: 0.02, name: 'Cornice' }));
  F.push(new Band({ name: 'Peak cliffs', lip: [[-146, -284], [-118, -287], [-90, -283]], wig: 1.2, seed: 223, a: 0.45, Rup: 27, Rdn: 50, land: 48, steep: 0.1, rough: 0.15,
    pts: [[-148, 0], [-138, 5], [-118, 8], [-102, 6.5], [-90, 0]] }));
  const P0 = new Rib({ name: 'Peak couloir rib', wigL: 1.4, wigR: 0.9, wwL: 9, xl: [[-340, 68], [-260, 70], [-230, 69]], xr: [[-340, 82], [-300, 83], [-260, 85], [-230, 84]], zTop: -340, grow: 14, D: 10, Dpts: [[-340, 7], [-300, 11], [-260, 9], [-236, 10]], zEnd: -236, seed: 224, crest: 0.1 });
  const P1 = new Rib({ name: 'Peak couloir rib', wigL: 0.9, wigR: 1.4, wwR: 9, xl: [[-340, 95], [-300, 94], [-260, 96], [-230, 96]], xr: [[-340, 108], [-230, 112]], zTop: -338, grow: 14, D: 10, Dpts: [[-338, 7], [-300, 10], [-260, 11], [-232, 9]], zEnd: -232, seed: 225, crest: 0.12 });
  F.push(P0, P1);
  F.push(new Gully({ name: 'The Peak couloir', ribs: [P0, P1], left: { L: z => P0.R(z), ww: P0.ww }, right: { L: z => P1.L(z), ww: P1.ww }, xa: 80, xb: 98, za: -334, zb: -290, zc: -226, E: 2.6 }));
  F.push(new Band({ name: 'Peak band (east)', lip: [[120, -263], [144, -259], [170, -263]], wig: 1.0, seed: 226, a: 0.45, Rup: 24, Rdn: 60, land: 22, steep: 0.1, rough: 0.15, pts: [[118, 0], [126, 4], [144, 6], [162, 5], [172, 0]] }));
  // (2026-11-13: only the two by the cliffs and the east band, framing them; three stood alone out on the open face)
  for (const [x, z, len, hw, h, rot] of [[-104, -232, 5, 3.4, 2.8, -0.4], [140, -305, 4.5, 3, 2.6, 0.5]])
    F.push(new Outcrop({ name: 'Rock island', x, z, len, hw, hUp: 0.4, hDn: h, w: 0.9, round: 0.6, rot, wob: 0.6, seed: 230 + x + z }));
  peakLines(F);
}
/* ---- the Peak's lines (2026-11-10, for Leon's "add more features along the way that are unique and different from each
   other creating unique lines which one could ride and pick a new line each time they drop"): the chairlift leaves you on
   the summit, and across the Peak's face from west to east are lines that each ride their own way, each with a flag and
   a sign at its top (frrock.js) and a start of its own (freeride.js):
     the Wave        a big wind-formed snow wave to boost off, and a smaller one below it: a natural double
     the Boulder Garden  a fan of rounded boulders, 1 to 3 m, to weave through and pop off
     the Staircase   five short cliffs one under another, 2 to 4.6 m, each landing the run-in to the next
     (the cliffs, the cornice's way in, the couloir and the east band, from before)
     the Fin         a thin rock fin standing 4 to 6 m down the fall line, with a hip of snow off its side
     the Pillow Stack  big pillows stacked down the fall line, each a drop onto the next
     the Gate        two rock towers to ride between, then a 5 m band below them, or round its ends
   Their own random numbers (not the layout's R), so nothing else moves. */
function peakLines(F) {
  const r = (s => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; })(20261110);
  // the Wave
  F.push(new Lip({ name: 'The Wave', xa: -414, xb: -346, z: -292, h0: 2.4, up: 9, dn: 2.2, seed: 241, slant: 0.08 }));
  F.push(new Lip({ name: 'The Little Wave', xa: -404, xb: -356, z: -238, h0: 1.2, up: 5, dn: 1.2, seed: 242, slant: -0.06 }));
  /* the Boulder Garden (2026-11-13, for "less messy ... more of a flow"): a way down that weaves a little between rounded
     boulders standing either side of it, 7 to 10 m off its middle, and three on it, 38 m apart, each a pop of about 2 m
     with its landing clear. They were 16 boulders thrown down anywhere at least 9 m apart: a straight line met a boulder,
     and three of five landings came down on another one. (The old placement's random numbers are still drawn, so the
     Pillow Stack below, from the same numbers, stays as it was.) */
  { const bs = []; for (let tries = 0; bs.length < 16 && tries < 400; tries++) { const x = -308 + r() * 46, z = -312 + r() * 108; if (bs.some(b => Math.hypot(b[0] - x, b[1] - z) < 9)) continue; bs.push([x, z]); } for (let i = 0; i < bs.length * 5; i++) r(); }
  const bgx = z => -286 + 6 * Math.sin((z + 312) * 0.045);
  // [z, side (0 on the line, -1 left, +1 right), how high its downhill end stands, its length, half width]
  [[-312, -1, 2.4, 4.5, 2.6], [-300, 0, 2.2, 4, 2.6], [-292, 1, 2.8, 4.5, 3], [-280, -1, 1.8, 3.6, 2.2], [-270, 1, 2.2, 4, 2.6], [-262, 0, 2.2, 4, 2.6],
    [-250, -1, 2.6, 4.6, 2.8], [-240, 1, 1.6, 3.4, 2.2], [-232, -1, 2.0, 4, 2.4], [-224, 0, 2.3, 4, 2.6], [-214, 1, 2.6, 4.4, 2.8], [-206, -1, 1.8, 3.6, 2.2]].forEach(([z, sd, hD, len, hw], i) => {
    const x = bgx(z) + sd * (7 + 3 * ((i * 0.37) % 1));
    F.push(new Outcrop({ name: sd ? 'Boulder garden' : 'Boulder pop', x, z, len, hw, hUp: sd ? 0.9 : 0.5, hDn: hD, w: 1.1, round: 0.75, rot: sd * 0.25 + (i % 3 - 1) * 0.2, wob: 0.4, seed: 270 + i }));
  });
  // the Staircase: steps zigzagging a little, each taller than the last
  // (from z -306: above that, by the crest, the face is too gentle for a bench, and a sled stopped on the first one)
  // (2026-11-13: zigzagging 2 to 3 m, not 10: the way down crossed every other step at its tapering end; a little further
  // apart and the lower ones lower, 3.2 and 3.6 m, not 3.8 and 4.6: the face eases off down there, and their benches climbed)
  [[-306, -241, -217, 2.2], [-282, -239, -215, 2.6], [-258, -242, -218, 3.0], [-232, -239, -215, 3.2], [-204, -241, -217, 3.6]].forEach(([z, xa, xb, H], i) =>
    // (2026-11-13: each step's bench longer the taller it is, less of its drop above it, and the rest made up slowly, over
  // the next steps: its bench climbed up to 17 degrees against the slope here, where the Peak's face eases off to the
  // shoulder)
    F.push(new Band({ name: 'The Staircase', z, wig: 0.4, seed: 281 + i, a: 0.2, Rup: 5 + 1.8 * H, Rdn: 60, land: 6, steep: 0.1, rough: 0.12, pts: [[xa, 0], [xa + 4, H], [xb - 4, H * 0.95], [xb, 0]] })));
  // the Fin, and its hip
  F.push(new Outcrop({ name: 'The Fin', x: 206, z: -298, len: 30, hw: 1.7, hUp: 3.5, hDn: 6, w: 1.0, round: 0.5, rot: 0.05, wob: 0.4, seed: 251 }));
  F.push(new Lip({ name: 'The Fin hip', xa: 214, xb: 232, z: -296, h0: 1.4, up: 5, dn: 1.4, seed: 252, slant: -0.5 }));
  // the Pillow Stack: down a line that wanders a little, each bigger than the last, a few beside it
  const L = [];
  // (from z -302, 20 m below its start: from closer, a snowboard at walking pace could not get over the first one)
  for (let k = 0, z = -302; z < -200; k++) {
    const x = 283 + 5 * Math.sin(k * 1.1) + (r() - 0.5) * 2;
    L.push({ x, z, r: 3.6 + k * 0.16 + r() * 0.8, h: 1.8 + k * 0.17 + r() * 0.5, e: 1.1, a: (r() - 0.5) * 0.8 });
    if (r() < 0.45) L.push({ x: x + (r() < 0.5 ? -1 : 1) * (8 + r() * 2), z: z + 2 + r() * 3, r: 2.6 + r(), h: 1.2 + r() * 0.6, e: 1, a: r() * 3 });
    z += 8.5 + r() * 2;
  }
  F.push(new Pillows({ name: 'The Pillow Stack', list: L }));
  // the Gate: two towers, about 14 m of snow between their faces, and the band below
  F.push(new Outcrop({ name: 'Gate tower', x: 368, z: -300, len: 7, hw: 3.6, hUp: 5.5, hDn: 6.5, w: 1.4, round: 0.6, wob: 0.5, rot: 0.15, seed: 261 }));
  F.push(new Outcrop({ name: 'Gate tower', x: 396, z: -301, len: 7, hw: 3.6, hUp: 5.5, hDn: 6.5, w: 1.4, round: 0.6, wob: 0.5, rot: -0.2, seed: 262 }));
  // the shoulder between the Peak and the main summit, where every line from the Peak runs out: two wind lips to boost
  // off on the way across, either side of the chairlift's line
  F.push(new Lip({ name: 'Shoulder lip (west)', xa: -112, xb: -40, z: -162, h0: 1.1, up: 5, dn: 1.1, seed: 291, slant: 0.06 }));
  F.push(new Lip({ name: 'Shoulder lip (east)', xa: 62, xb: 132, z: -146, h0: 1.1, up: 5, dn: 1.1, seed: 292, slant: -0.08 }));
  F.push(new Band({ name: 'Gate drop', lip: [[356, -262], [382, -259], [408, -263]], wig: 0.8, seed: 263, a: 0.45, Rup: 21, Rdn: 43, land: 36, steep: 0.1, rough: 0.12, pts: [[356, 0], [362, 4.8], [382, 5.0], [402, 5.2], [408, 0]] }));
}
/* the pillow line: pillows stacked down the roll's steep fall line (x about -48 to -32), each a step under the last,
   getting bigger as it goes, with a few beside the line */
function pillowLine() {
  const L = [];
  let z = 398;
  for (let k = 0; z < 456; k++) {
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
    this.rockCells = new Map();
    for (const [k, l] of this.cells) { const r = l.filter(f => (f.rock || f.kind === 'pillows' || f.kind === 'lip') && f.onFace); if (r.length) this.rockCells.set(k, r); }
    this.G = (x, z) => this.at(x, z);
    this.ribs = this.features.filter(f => f.kind === 'rib');
    this.gullies = this.features.filter(f => f.kind === 'gully');
    this.spines = this.features.find(f => f.kind === 'spines');
    this.snowy = this.features.filter(f => f.kind === 'hpipe' || f.look === 'snow');
    // (2026-11-13) the named lines' waypoints as segments on a 16 m grid, for how near a line a place is (lineNear)
    this.lineSegs = []; this.lineCells = new Map();
    for (const Ln of LINES) for (let i = 0; i + 1 < Ln.pts.length; i++) {
      const [ax, az] = Ln.pts[i], [bx, bz] = Ln.pts[i + 1], k = this.lineSegs.length; this.lineSegs.push([ax, az, bx, bz]);
      for (let ci = Math.floor((Math.min(ax, bx) - 24) / B); ci <= Math.floor((Math.max(ax, bx) + 24) / B); ci++) for (let cj = Math.floor((Math.min(az, bz) - 24) / B); cj <= Math.floor((Math.max(az, bz) + 24) / B); cj++) {
        const c = ci * 8192 + cj; if (!this.lineCells.has(c)) this.lineCells.set(c, []); this.lineCells.get(c).push(k);
      }
    }
  }
  /* (2026-11-08, with P: what counts as a cliff) true on a rock face: a band's face from its lip to its foot, a rib's
     steep side wall or its end cliff, an outcrop's sides and lip, 0.3 m either side. Everything else is snow, however
     steep: you stand on it, turn on it and ride it; a rock face is a wall to fall off or bounce off (skier.js). */
  cliff(x, z) {
    const l = this.rockCells.get(Math.floor(x / this.B) * 8192 + Math.floor(z / this.B)); if (!l) return false;
    for (let i = 0; i < l.length; i++) if (l[i].onFace(x, z, 0.3)) return true;
    return false;
  }
  // the ground with nothing on it but the long profile, the bowl, its arms and the fall lines
  base(x, z) {
    let y = baseZ(z - zs(x)) + arms(x, z);
    /* (the side bowls: the higher of the surfaces, the ridge between rounded. Past 120 m out on each side only: nearer
       the middle a side's surface is so far under the main one, past its ridge, that it adds nothing) */
    if (x < -120) y = smax(y, sideY(SIDES[0], x, z), 8);
    else if (x > 120) y = smax(y, sideY(SIDES[1], x, z), 8);
    return y + fallLines(x, z) + rolls(x, z) + runout(x, z) + far(x, z) + peakFall(x, z);
  }
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
  // how far a place is from the nearest named line's way down (24 m at most: 24 if none is nearer)
  lineNear(x, z) {
    const l = this.lineCells.get(Math.floor(x / this.B) * 8192 + Math.floor(z / this.B)); if (!l) return 24;
    let d = 24;
    for (const k of l) {
      const [ax, az, bx, bz] = this.lineSegs[k], dx = bx - ax, dz = bz - az, t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      d = Math.min(d, Math.hypot(x - ax - dx * t, z - az - dz * t));
    }
    return d;
  }
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
    // (2026-11-08) the natural halfpipe is a snow gully (its walls are steep only for snow), the cornices are snow
    for (const h of this.snowy) if (x > h.x0 && x < h.x1 && z > h.z0 && z < h.z1) return Math.max(ny, 0.8);
    const s = this.spines; if (s && x > s.x0 && x < s.x1 && z > s.za && z < s.zb) return ny + (Math.max(ny, 0.8) - ny) * 0.7;
    /* (2026-11-13, for "less messy": rock where it frames a line, not scattered) none of the streaks below within about 10 m
       of a named line's way down, so each line reads as clean snow between rockier ground; and the open face's own thin
       streaks half as strong (they were grey blotches all over it) */
    const a = Math.abs(x), sd = a > 200 ? Math.abs(a - 352) : 1e9, c = fallCrest(x, z), open = z > 10 && z < 560 && (a0(x) < 150 || sd < 84);
    const fr = c > 0 || open || z < -150 ? smoothstep(9, 20, this.lineNear(x, z)) : 1;
    // the ribs down the face: rock in streaks along their crests (the shader's noise breaks it up)
    if (c > 0) ny -= 0.15 * c * c * fr;
    // thin snow over rock in streaks down the fall line here and there on the open face (wind-scoured, rock just under)
    // (and on the side bowls' faces, 2026-11-08)
    if (fr > 0 && open) ny -= 0.045 * fr * smoothstep(0.25, 0.6, fbm(x * 0.034 + 7, z * 0.009 - 2, 2)) * (1 - smoothstep(470, 560, z));
    // the bowls' side walls (the main bowl's arms, the side bowls' outer walls), their upper parts most, and the peak
    // behind the summit (2026-11-08: past 200 m out the side bowls' faces are not walls)
    const wall = a < 230 ? smoothstep(150, 200, a) : smoothstep(84, 124, sd);
    if (wall > 0) ny -= 0.07 * wall * smoothstep(-40, 40, z) * (1 - smoothstep(420, 620, z));
    if (z < -150) ny -= 0.12 * (0.35 + 0.65 * fr) * smoothstep(-150, -230, z) * (1 - smoothstep(-330, -360, z));
    return ny;
  }
  // where the terrain's fine patches (st m a cell) must sit under the rock meshes: their visual height, or Infinity
  dipTarget(x, z, st) {
    if (st > 1.75) return Infinity;
    // (only where the drawn rock covers the snow, frrock.js markCover: anywhere else the lowered terrain was a hole)
    const C = this.cover;
    if (C) { const i = Math.floor((x - C.x0) / C.r), j = Math.floor((z - C.z0) / C.r); if (i < 0 || j < 0 || i >= C.W || j >= C.H || !C.a[j * C.W + i]) return Infinity; }
    const l = this.dipCells.get(Math.floor(x / this.B) * 8192 + Math.floor(z / this.B)); if (!l) return Infinity;
    let t = Infinity, y = null;
    for (const f of l) { const v = f.dip(x, z, st, this.G, y ?? (y = this.at(x, z))); if (v < t) t = v; }
    return t;
  }
}
