// Grabs and positions as data, with their mirror images and their variations.
//   GRABS[id]           the base shapes (one hand each way round; the rider's frame: +X left, +Y up, +Z forward)
//   GRABS[id + '_m']    the same grab done with the other hand on the other side ('Left Mute' <-> 'Right Mute')
//   grabDef(id, mod)    a grab with a variation: mod is '' or 'E' or 'R' or 'ER' (the Shredsauce Controls keys held
//                       with the grab). For one-handed grabs the key on the grabbing hand's side (E for the left
//                       hand, R for the right) tweaks it and the other key pokes it (the free leg kicked straight);
//                       tail grabs go to an uncrossed blunt with the other key, the truck driver tweaks to the left
//                       with E and to the right with R, as Shredsauce lists them.
// hands: [hand, ski, at (-1 tail .. +1 tip), edge 'out' | 'in' | 'end']
// (2026-11-08, a pass against photos: the free arm by grab, out wide on a safety and stalefish, forward on a tail grab,
// back on a nose grab, up on a critical and seatbelt; the head looks at the grab, rig.js)
// ski: { L: [dx, dy, dz, yaw, pitch, roll], R: [...] }  (pitch < 0 lifts the tip, yaw > 0 turns the tip left)
// tuck: how far the knees come up (0..1), lean: chest forward (rad), twist: chest yaw (+ left), side: chest roll
// (+ drops the right shoulder), arms: what the free arm does ('out', 'up', 'wide')
export const GRABS = {
  /* (2026-11-03, for "the nose grab is an example of a good grab ... make the other grabs more like that": every grab
     on the nose's pattern, a clean, compact shape a player reads at once: both skis kept together and nearly parallel
     (a little crossed at most), the knees tucked, the chest folded towards the point the hand holds, the free arm
     hanging low and out. What tells the grabs apart is which hand holds which ski where, and how the body turns to
     it. They had skis crossed wide or turned 66 degrees sideways, nearly vertical, and free arms held up stiff.) */
  safety:    { name: 'Right Safety', hand: 'R', hands: [['R', 'R', 0, 'out']], arms: 'wide', ski: { L: [-0.02, 0.03, 0.06, 0.03, -0.12, 0], R: [0.02, 0.02, 0.06, -0.03, -0.12, 0] }, tuck: 0.55, lean: 1.2, twist: 0.12, side: 0.3 },
  /* a mute (redone 2026-11-10, for "mute and blunt for skis are still scuffed and do not look right", against photos of
     real ones in ski8/R/ref: the Youth Olympics slopestyle shots 13, 21, 30, 31, 35, 36): the other hand reaches across
     the front of the knees to the outside edge of the other ski just in front of its binding; the two skis cross in an X
     right under the boots, both near level (only the tips a little up), the held one a little over the other and pulled
     across towards the hand (the free one under it, so it passes below the held ski's boot); the knees tucked, the chest folded over them and turned to the grab, the reaching shoulder
     dropped; the free arm straight out to the side at the shoulder with its pole out along it. (It had the held ski
     pitched 41 degrees up in front of the chest and the body wound round hard, which read as a scuffle.) */
  mute:      { name: 'Left Mute', hand: 'L', hands: [['L', 'R', 0.16, 'out']], arms: 'side', ski: { L: [-0.06, -0.08, 0.05, -0.42, -0.12, 0.08], R: [0.09, 0.09, 0.06, 0.48, -0.24, -0.22] }, tuck: 0.76, lean: 1.15, twist: -0.42, side: -0.34, hips: 0.45,
    // the variations (grabs.js VERS: R the poke, E+R tweaked): a bigger X pulled further across, or the free leg kicked out
    vary: {
      tweak: { ski: { L: [-0.08, -0.12, 0.08, -0.58, -0.14, 0.1], R: [0.12, 0.1, 0.1, 0.68, -0.32, -0.3] }, tuck: 0.74, lean: 1.1, twist: -0.6, side: -0.46, hips: 0.55 },
      poke: { ski: { L: [-0.05, -0.28, 0.26, -0.38, -0.55, 0.06], R: [0.09, 0.09, 0.07, 0.5, -0.26, -0.22] }, tuck: 0.5, lean: 0.85, twist: -0.48, side: -0.38, hips: 0.45 },
      both: { ski: { L: [-0.06, -0.3, 0.27, -0.5, -0.58, 0.08], R: [0.12, 0.14, 0.07, 0.68, -0.32, -0.3] }, tuck: 0.6, lean: 0.95, twist: -0.62, side: -0.48, hips: 0.55 },
    } },
  // a japan: the hand reaches round the front of the tucked knee to the inside of that ski, the other leg kicked out
  // straight with its ski across under the first, the free arm up high (2026-11-05, for "v should default to v + e":
  // the plain japan is now what the poked one was, and its variations go further)
  japan:     { name: 'Right Japan', hand: 'R', hands: [['R', 'L', 0.1, 'in']], arms: 'high', ski: { L: [-0.05, 0.1, 0.02, -0.12, 0.2, -0.05], R: [-0.11, -0.2, 0.38, -0.29, -0.75, 0] }, tuck: 0.4, lean: 1.0, twist: 0.36, side: 0.34, hips: 0.4,
    // R (the grabbing hand's key) tweaks it: the held ski pulled up and back behind, the body wound hard round to it;
    // E pokes the free leg further and crosses its ski under the held one (a big X); both together do both
    vary: {
      tweak: { ski: { L: [-0.1, 0.2, -0.12, -0.42, 0.62, -0.18], R: [-0.12, -0.22, 0.38, -0.32, -0.78, 0] }, tuck: 0.55, lean: 1.15, twist: 0.78, side: 0.55, hips: 0.55 },
      poke: { ski: { L: [-0.07, 0.14, -0.06, -0.3, 0.42, -0.08], R: [-0.22, -0.34, 0.48, 0.72, -1.0, 0.16] }, tuck: 0.32, lean: 0.92, twist: 0.58, side: 0.45, hips: 0.5 },
      both: { ski: { L: [-0.1, 0.22, -0.14, -0.5, 0.68, -0.2], R: [-0.24, -0.36, 0.48, 0.78, -1.02, 0.16] }, tuck: 0.45, lean: 1.08, twist: 0.92, side: 0.62, hips: 0.62 },
    } },
  // a tail grab: the hand at the very end of the tail beside the hip, both skis steeply tips down (60 to 70 degrees)
  // and together, the legs hanging lower, the chest fairly upright and turned and dropped a little to the grab
  tail:      { name: 'Right Tail', hand: 'R', kind: 'tail', hands: [['R', 'R', -0.93, 'out']], arms: 'fwd', ski: { L: [0.01, -0.02, -0.12, -0.04, 1.35, 0], R: [-0.01, 0, -0.14, 0.05, 1.45, 0] }, tuck: 0.3, lean: 0.4, twist: -0.35, side: 0.38 },
  nose:      { name: 'Nose', hand: 'R', hands: [['R', 'R', 0.94, 'end']], arms: 'back', ski: { L: [0, -0.03, 0.26, 0.04, -0.8, 0], R: [0, -0.03, 0.27, -0.04, -0.82, 0] }, tuck: 0.25, lean: 1.4, twist: 0.1, side: 0.25 },
  truck:     { name: 'Truck Driver', hand: 'B', kind: 'truck', hands: [['L', 'L', 0.35, 'out'], ['R', 'R', 0.35, 'out']], ski: { L: [-0.02, 0, 0.1, 0.04, -0.55, 0], R: [0.02, 0, 0.1, -0.04, -0.55, 0] }, tuck: 0.65, lean: 1.0, twist: 0, side: 0 },
  critical:  { name: 'Critical', hand: 'L', hands: [['L', 'R', 0.55, 'in']], arms: 'high', ski: { L: [-0.02, 0, 0.04, -0.06, 0.08, 0], R: [0.04, 0.06, 0.1, 0.12, -0.55, -0.05] }, tuck: 0.5, lean: 1.2, twist: -0.25, side: -0.22, hips: 0.4 },
  octo:      { name: 'Octograb', hand: 'B', hands: [['R', 'R', 0.85, 'end'], ['L', 'L', -0.82, 'out']], ski: { L: [-0.03, 0.02, -0.18, -0.06, 0.4, 0], R: [0.03, 0, 0.18, 0.06, -0.6, 0] }, tuck: 0.45, lean: 0.75, twist: 0.1, side: 0 },
  /* a blunt (redone 2026-11-10, against photos of real ones and the freeskiers' definition, "the true tail grab: the very
     end of the tail", same hand, same ski): the boot brought up behind with the knee bent, so the held ski stands nearly
     upright behind the hip and a little out to the side, its tail up at the hand behind the shoulder and its tip down
     past the other boot; the other leg under the body with its ski level; the chest fairly upright, turned to the grab
     and that shoulder dropped a little; the free arm out at the side with its pole; the head glancing back at the tail.
     (It had that ski turned 75 degrees in and laid diagonally across behind the legs.) */
  blunt:     { name: 'Right Blunt', hand: 'R', kind: 'blunt', hands: [['R', 'R', -1, 'end']], arms: 'side', ski: { L: [0.03, -0.06, 0.1, -0.06, -0.08, 0], R: [-0.17, 0.3, -0.27, 0.12, 1.52, -0.12] }, tuck: 0.38, lean: 0.25, twist: -0.42, side: 0.32, hips: 0.4, look: 0.25 },
  // (the grabbed ski brought behind the other leg, which stays forward, so neither goes through the other)
  stalefish: { name: 'Stalefish', hand: 'R', hands: [['R', 'L', -0.6, 'out']], arms: 'wide', ski: { L: [-0.03, 0.08, -0.2, -0.2, 0.45, 0], R: [-0.03, 0, 0.08, -0.04, 0.3, 0] }, tuck: 0.55, lean: 0.6, twist: -0.3, side: 0.35, hips: 0.4 },
  bowarrow:  { name: 'Bow and Arrow', hand: 'B', hands: [['R', 'R', 0.9, 'end'], ['L', 'L', 0.4, 'out']], ski: { L: [0.06, 0.12, 0.02, 0.08, -0.7, -0.1], R: [-0.02, -0.05, 0.26, -0.05, -0.65, 0] }, tuck: 0.45, lean: 0.9, twist: 0.1, side: 0.1 },
  dubtail:   { name: 'Double Tail', hand: 'B', kind: 'tail', hands: [['L', 'L', -0.93, 'out'], ['R', 'R', -0.93, 'out']], ski: { L: [0.02, -0.02, -0.12, -0.05, 1.35, 0], R: [-0.02, -0.02, -0.12, 0.05, 1.35, 0] }, tuck: 0.3, lean: 0.4, twist: 0, side: 0 },
  // a seatbelt: the other hand reaches across the front of the body to the tail: that ski's boot pulled up and forward,
  // the ski steeply tail up so its tail stands in front of the hips (it went behind, through the left leg)
  seatbelt:  { name: 'Seatbelt', hand: 'L', kind: 'tail', hands: [['L', 'R', -0.8, 'out']], arms: 'high', ski: { L: [0.02, -0.04, -0.04, 0.04, 0.25, 0], R: [0.05, 0.25, 0.3, -0.3, 1.25, 0.15] }, tuck: 0.6, lean: 0.7, twist: -0.5, side: -0.25, hips: 0.4 },
  // positions
  daffy:     { name: 'Daffy', pos: true, hands: [], arms: 'wide', ski: { L: [0, -0.05, 0.5, 0, -1, 0], R: [0, -0.12, -0.5, 0, 0.85, 0] }, tuck: 0.05, lean: 0.05, twist: 0, side: 0 },
  spread:    { name: 'Open Spread Eagle', pos: true, hands: [], arms: 'up', ski: { L: [0.48, 0.25, 0, 0.25, -0.85, 0.3], R: [-0.48, 0.25, 0, -0.25, -0.85, -0.3] }, tuck: 0.15, lean: 0.1, twist: 0, side: 0 },
  backscratch: { name: 'Backscratcher', pos: true, hands: [], arms: 'up', ski: { L: [0.04, 0.2, -0.38, 0, 1.2, 0], R: [-0.04, 0.2, -0.38, 0, 1.2, 0] }, tuck: 0.35, lean: -0.1, twist: 0, side: 0 },
  /* a spread eagle with the poles between the legs (2026-11-08, Leon's key 1; the old-school Cossack's shape, from
     freestyle glossaries): the legs straight and spread wide to the sides in a V, the skis level and their tips a
     little up, the chest tall, both hands brought together low in front and the poles pointing down between the legs */
  spreadpoles: { name: 'Spread Eagle', pos: true, hands: [], arms: 'between', poles: 'between', crouch: 0.12, ski: { L: [0.5, -0.12, 0.06, 0.28, -0.28, 0.4], R: [-0.5, -0.12, 0.06, -0.28, -0.28, -0.4] }, tuck: 0, lean: 0.22, twist: 0, side: 0, head: -0.12 },
  /* a screaming seaman (2026-11-08, Leon's key 2; from freeski glossaries: a daffy, one straight leg kicked forward
     and the other back, then the legs crossed over to the other sides, and a daffy again to uncross them for the
     landing). The skis here are the crossed shape it holds; rig.js runs the daffy in and out (kind 'seaman'). The arms
     thrown out wide and up, the head back. */
  seaman:    { name: 'Screaming Seaman', pos: true, kind: 'seaman', hands: [], arms: 'scream', crouch: 0.1, ski: { L: [-0.27, -0.06, 0.32, -0.3, -0.85, -0.18], R: [0.27, -0.1, -0.3, -0.3, 0.72, 0.18] }, tuck: 0.05, lean: -0.05, twist: 0, side: 0, head: -0.35,
    daffy: { L: [0.03, -0.05, 0.5, 0, -1, 0], R: [-0.03, -0.12, -0.5, 0, 0.85, 0] } },
  // (the legs spread in a V and the crossed tails at two heights, so they cross well behind the heels and pass each
  // other and the legs even tweaked)
  ironcross: { name: 'Iron Cross', pos: true, hands: [], arms: 'wide', ski: { L: [0.15, 0.09, -0.05, -0.6, 0.15, 0], R: [-0.15, -0.01, -0.05, 0.6, 0.15, 0] }, tuck: 0.5, lean: 0.6, twist: 0, side: 0 },
};
export const POSITIONS = new Set(['daffy', 'spread', 'backscratch', 'ironcross', 'spreadpoles', 'seaman']);

// the mirror image: other hand, other ski, everything sideways turned the other way
const LR = s => s === 'L' ? 'R' : s === 'R' ? 'L' : s;
function mirror(g) {
  const m = (t) => [-t[0], t[1], t[2], -t[3], t[4], -t[5]];
  const name = g.name.startsWith('Left ') ? 'Right ' + g.name.slice(5) : g.name.startsWith('Right ') ? 'Left ' + g.name.slice(6) : g.name;
  const out = Object.assign({}, g, { name, hand: LR(g.hand), hands: g.hands.map(([h, s, at, e]) => [LR(h), LR(s), at, e]), ski: { L: m(g.ski.R), R: m(g.ski.L) }, twist: -g.twist, side: -g.side });
  if (g.vary) { out.vary = {}; for (const k in g.vary) { const v = g.vary[k]; out.vary[k] = Object.assign({}, v, { ski: { L: m(v.ski.R), R: m(v.ski.L) }, twist: -v.twist, side: -v.side }); } }
  return out;
}
for (const id of ['safety', 'mute', 'japan', 'tail', 'blunt', 'critical', 'seatbelt', 'stalefish', 'nose']) GRABS[id + '_m'] = mirror(GRABS[id]);

// ---- variations -------------------------------------------------------------------------------------------------------
const cache = new Map();
// (the pitch is scaled less than the yaw and roll: a held ski pitched 1.5 times over stood up vertical behind the back)
const scaleSki = (t, kp, kr) => [t[0] * kp, t[1] * kp, t[2] * kp, t[3] * kr, t[4] * (1 + (kr - 1) * 0.4), t[5] * kr];
// tweaked: the grabbed ski pulled further and the body bent round it (shoulders turned and dropped, back arched)
function tweaked(g) {
  return Object.assign({}, g, { ski: { L: scaleSki(g.ski.L, 1.4, 1.5), R: scaleSki(g.ski.R, 1.4, 1.5) }, twist: g.twist * 1.6 + (g.hand === 'L' ? -0.15 : g.hand === 'R' ? 0.15 : 0), side: g.side * 1.6, lean: g.lean + 0.12, tuck: Math.min(0.85, g.tuck + 0.1), tw: 1 });
}
// poked: the leg that is not held kicked out straight, the held one still tucked
function poked(g) {
  const held = new Set(g.hands.map(h => h[1]));
  const free = held.has('L') && !held.has('R') ? 'R' : held.has('R') && !held.has('L') ? 'L' : null;
  const ski = { L: g.ski.L.slice(), R: g.ski.R.slice() };
  if (free) { const s = free === 'L' ? 1 : -1; ski[free] = [ski[free][0] + 0.12 * s, ski[free][1] - 0.22, ski[free][2] + 0.32, ski[free][3] + 0.25 * s, -0.75, ski[free][5]]; }
  return Object.assign({}, g, { ski, tuck: Math.max(0.15, g.tuck - 0.25), lean: g.lean * 0.85, side: g.side * 1.2, poke: free });
}
// an uncrossed blunt: the tail grabbed at its very end, both skis straight and parallel, tails kicked up behind
function blunt(g) {
  const h = g.hand;
  return Object.assign({}, g, { name: (h === 'L' ? 'Left' : 'Right') + ' Blunt', hands: [[h, h, -1, 'end']], arms: 'up', kind: 'tail',
    ski: { L: [0.01, 0.12, -0.3, 0, 1.05, 0], R: [-0.01, 0.12, -0.3, 0, 1.05, 0] }, tuck: 0.45, lean: 0.15, twist: h === 'L' ? 0.6 : -0.6, side: h === 'L' ? -0.4 : 0.4, uncrossed: true });
}
// the truck driver tweaked to one side: both skis swung that way, the body turned against them
function truckTo(g, dir) {
  const ski = { L: [-0.02 + 0.12 * dir, 0.04, 0.08, 0.55 * dir, -1.0, 0.25 * dir], R: [0.02 + 0.12 * dir, 0.04, 0.08, 0.55 * dir, -1.0, 0.25 * dir] };
  return Object.assign({}, g, { ski, twist: -0.45 * dir, side: 0.3 * dir, tuck: 0.7, lean: 0.8, tw: 1 });
}
/* ---- E and R: a different version of each trick (2026-11-08, for "E and R give different versions of a trick, not
   just a tweak"). E, R and both together each give their own version, named so the trick's name says it: the
   two-handed or doubled form, the poke (the free leg kicked out straight), the uncrossed blunt, the crossed japan...
   Holding a grab a second still adds "Tweaked" to its name (tricks.js). -------------------------------------------- */
const MI = (t) => [-t[0], t[1], t[2], -t[3], t[4], -t[5]];
const sideless = n => n.replace(/^(Left|Right) /, '');
// two-handed: the free hand takes the held ski too (behind the binding: under the boot on its own side, the inside edge
// across the body), the knees a little higher to bring the ski to both hands
function twoHand(g) {
  const used = new Set(g.hands.map(h => h[0])), free = used.has('L') ? (used.has('R') ? null : 'R') : 'L';
  if (!free) return g;
  const sk = g.hands[0][1], spot = free === sk ? [free, sk, -0.12, 'out'] : [free, sk, -0.3, 'in'];
  return Object.assign({}, g, { hands: g.hands.concat([spot]), arms: undefined, tuck: Math.min(0.9, g.tuck + 0.12), lean: g.lean + 0.12, twist: g.twist * 0.6, side: g.side * 0.7 });
}
// doubled: a same-side grab done with both hands, each on its own ski at the same place, the skis a mirror pair
function doubled(g) {
  const h0 = g.hands[0], held = h0[1], other = held === 'L' ? 'R' : 'L', ski = {};
  ski[held] = g.ski[held].slice(); ski[other] = MI(g.ski[held]);
  return Object.assign({}, g, { hands: [h0, [h0[0] === 'L' ? 'R' : 'L', other, h0[2], h0[3]]], ski, arms: undefined, twist: 0, side: 0, hips: 0.3 });
}
// a poke behind: the free leg kicked straight back, its tail up (a nose grab's poke)
function pokeBack(g) {
  const held = new Set(g.hands.map(h => h[1])), free = held.has('L') ? (held.has('R') ? null : 'R') : 'L';
  if (!free) return g;
  const ski = { L: g.ski.L.slice(), R: g.ski.R.slice() }, s = free === 'L' ? 1 : -1;
  ski[free] = [0.04 * s, -0.16, -0.4, 0.06 * s, 0.85, 0];
  return Object.assign({}, g, { ski, tuck: Math.max(0.1, g.tuck - 0.15), poke: free });
}
// crossed: both skis turned across each other behind (a double tail's tails crossed)
function crossedTails(g) {
  return Object.assign({}, g, { ski: { L: [g.ski.L[0] - 0.05, g.ski.L[1], g.ski.L[2], -0.38, g.ski.L[4], 0.12], R: [g.ski.R[0] + 0.05, g.ski.R[1] - 0.06, g.ski.R[2], 0.38, g.ski.R[4], -0.12] } });
}
// the switched daffy: the other leg forward
function switched(g) { return Object.assign({}, g, { ski: { L: MI(g.ski.R), R: MI(g.ski.L) } }); }
// a grab's own variation shapes (the mute, the japan)
const vary = k => g => g.vary && g.vary[k] ? Object.assign({}, g, g.vary[k]) : tweaked(g);
// each grab's E, R and E + R: [name ({n} the grab's name, {b} without its side), shape]
const VERS = {
  safety: { E: ['Double Safety', doubled], R: ['{n} Poke', poked], ER: ['Tweaked Double Safety', g => tweaked(doubled(g))] },
  mute: { E: ['Two-handed {n}', twoHand], R: ['{n} Poke', vary('poke')], ER: ['Tweaked {n}', vary('tweak')] },
  japan: { E: ['Two-handed {n}', twoHand], R: ['Crossed {n}', vary('poke')], ER: ['Tweaked Crossed {n}', vary('both')] },
  tail: { E: ['Double Tail', doubled], R: ['{n} Poke', poked], ER: ['Uncrossed {s} Blunt', g => blunt(g)] },
  nose: { E: ['Double Nose', doubled], R: ['Nose Poke', pokeBack], ER: ['Tweaked Double Nose', g => tweaked(doubled(g))] },
  critical: { E: ['Two-handed Critical', twoHand], R: ['Critical Poke', poked], ER: ['Tweaked Critical Poke', g => tweaked(poked(g))] },
  octo: { E: ['Tweaked Octograb', tweaked], R: ['Inverted Octograb', mirror], ER: ['Tweaked Inverted Octograb', g => tweaked(mirror(g))] },
  blunt: { E: ['Double Blunt', g => doubled(blunt(g))], R: ['Uncrossed {n}', g => blunt(g)], ER: ['Tweaked {n}', tweaked] },
  stalefish: { E: ['Two-handed Stalefish', twoHand], R: ['Stalefish Poke', poked], ER: ['Tweaked Stalefish', tweaked] },
  bowarrow: { E: ['Tweaked Bow and Arrow', tweaked], R: ['Inverted Bow and Arrow', mirror], ER: ['Tweaked Inverted Bow and Arrow', g => tweaked(mirror(g))] },
  dubtail: { E: ['Tweaked Double Tail', tweaked], R: ['Crossed Double Tail', crossedTails], ER: ['Tweaked Crossed Double Tail', g => tweaked(crossedTails(g))] },
  seatbelt: { E: ['Two-handed Seatbelt', twoHand], R: ['Seatbelt Poke', poked], ER: ['Tweaked Seatbelt', tweaked] },
  daffy: { E: ['Switched Daffy', switched], R: ['Tweaked Daffy', tweaked], ER: ['Tweaked Switched Daffy', g => tweaked(switched(g))] },
  spreadpoles: { E: ['Open Spread Eagle', g => Object.assign({}, g, { arms: 'wide', poles: undefined })], R: ['Tweaked Spread Eagle', tweaked], ER: ['Tweaked Open Spread Eagle', g => tweaked(Object.assign({}, g, { arms: 'wide', poles: undefined }))] },
};
export function grabDef(id, mod = '') {
  const g = GRABS[id]; if (!g) return null;
  if (!mod) return g;
  const key = id + '|' + mod;
  if (cache.has(key)) return cache.get(key);
  const E = mod.includes('E'), R = mod.includes('R'), base = id.replace(/_m$/, ''), V = VERS[base];
  let d = g, name = g.name;
  if (V) {
    const [nm, fn] = V[E && R ? 'ER' : E ? 'E' : 'R'];
    d = fn(g); name = nm.replace('{n}', g.name).replace('{b}', sideless(g.name)).replace('{s}', g.hand === 'L' ? 'Left' : 'Right');
  } else if (g.kind === 'truck' && E !== R) { d = truckTo(g, E ? 1 : -1); name = 'Tweaked Truck to ' + (E ? 'Left' : 'Right'); }
  else { d = tweaked(g); name = 'Tweaked ' + g.name; if (E && R) { d = tweaked(d); name = 'Double Tweaked ' + g.name; } }
  d = Object.assign({}, d, { name, base: id, mod });
  cache.set(key, d);
  return d;
}
export const grabName = (id, mod) => { const d = grabDef(id, mod); return d ? d.name : id; };

// what each grab is, the way freeskiers describe it (Backcountry Access, Red Bull, NBC's glossary)
export const GRAB_GUIDE = {
  safety: 'same hand, same ski, under the boot, outside edge', mute: 'opposite hand to the other ski, outside edge in front of the binding, skis crossed in a big X',
  japan: 'opposite hand round the tucked knee to that ski, inside edge, the other leg kicked out', tail: 'same hand on the tail, tails pulled up behind',
  nose: 'same hand on the tip, legs out straight', truck: 'both hands, each on its own ski in front of the bindings',
  critical: 'opposite hand to the other ski, inside edge in front of the binding', octo: 'one hand on one tip, the other on the other tail, skis crossed',
  blunt: 'same hand on the very end of the tail', stalefish: "a hand to the other ski's tail behind the legs, skis turned sideways",
  bowarrow: 'both hands at the fronts, one leg to the chest, the other straight', dubtail: 'both hands on both tails',
  seatbelt: "reach across the body to the other ski's tail", daffy: 'one ski forward, one back', spread: 'skis and legs wide, arms up',
  spreadpoles: 'legs spread wide to the sides, hands together, the poles down between the legs', seaman: 'a daffy, then the straight legs crossed over, then a daffy again to land',
  backscratch: 'tails kicked up behind the back', ironcross: 'skis crossed in an X',
};
export const guideOf = id => GRAB_GUIDE[id] || GRAB_GUIDE[id.replace(/_m$/, '')] || '';
