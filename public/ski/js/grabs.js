// Grabs and positions as data, with their mirror images and their variations.
//   GRABS[id]           the base shapes (one hand each way round; the rider's frame: +X left, +Y up, +Z forward)
//   GRABS[id + '_m']    the same grab done with the other hand on the other side ('Left Mute' <-> 'Right Mute')
//   grabDef(id, mod)    a grab with a variation: mod is '' or 'E' or 'R' or 'ER' (the Shredsauce Controls keys held
//                       with the grab). For one-handed grabs the key on the grabbing hand's side (E for the left
//                       hand, R for the right) tweaks it and the other key pokes it (the free leg kicked straight);
//                       tail grabs go to an uncrossed blunt with the other key, the truck driver tweaks to the left
//                       with E and to the right with R, as Shredsauce lists them.
// hands: [hand, ski, at (-1 tail .. +1 tip), edge 'out' | 'in' | 'end']
// ski: { L: [dx, dy, dz, yaw, pitch, roll], R: [...] }  (pitch < 0 lifts the tip, yaw > 0 turns the tip left)
// tuck: how far the knees come up (0..1), lean: chest forward (rad), twist: chest yaw (+ left), side: chest roll
// (+ drops the right shoulder), arms: what the free arm does ('out', 'up', 'wide')
export const GRABS = {
  safety:    { name: 'Right Safety', hand: 'R', hands: [['R', 'R', 0, 'out']], arms: 'out', ski: { L: [-0.03, 0.04, 0.08, 0.02, -0.06, 0], R: [0.03, 0, 0.08, -0.02, -0.06, 0] }, tuck: 0.55, lean: 1.15, twist: 0.15, side: 0.3 },
  // (2026-11-03, against photos: the grabbed ski's tip pulled up high and across in front, so the skis cross in a big
  // X out ahead, the knees tucked up near the chest with the chest fairly upright, hips and shoulders turned to the
  // grab, the grabbing shoulder dropped, the free arm up; it was folded over low knees with the X down at the feet)
  mute:      { name: 'Left Mute', hand: 'L', hands: [['L', 'R', 0.28, 'out']], arms: 'up', ski: { L: [-0.05, -0.08, 0.06, -0.4, 0.2, 0.1], R: [0.16, 0.16, 0.16, 0.78, -0.95, -0.3] }, tuck: 0.78, lean: 0.5, twist: -0.6, side: -0.38, hips: 0.55 },
  japan:     { name: 'Right Japan', hand: 'R', hands: [['R', 'L', 0, 'in']], arms: 'up', ski: { L: [-0.08, 0.22, -0.1, -0.4, 0.15, -0.15], R: [0.04, -0.15, 0.18, 0.3, 0.45, 0] }, tuck: 0.55, lean: 1.1, twist: 0.35, side: 0.3 },
  tail:      { name: 'Right Tail', hand: 'R', kind: 'tail', hands: [['R', 'R', -0.85, 'out']], arms: 'up', ski: { L: [0, 0.05, -0.2, -0.05, 0.7, 0], R: [0, 0.05, -0.2, 0.05, 0.75, 0] }, tuck: 0.35, lean: 0.3, twist: -0.45, side: 0.3 },
  nose:      { name: 'Nose', hand: 'R', hands: [['R', 'R', 0.94, 'end']], arms: 'out', ski: { L: [0, -0.03, 0.26, 0.04, -0.8, 0], R: [0, -0.03, 0.27, -0.04, -0.82, 0] }, tuck: 0.25, lean: 1.4, twist: 0.1, side: 0.25 },
  truck:     { name: 'Truck Driver', hand: 'B', kind: 'truck', hands: [['L', 'L', 0.35, 'out'], ['R', 'R', 0.35, 'out']], ski: { L: [-0.02, 0, 0.08, 0.05, -0.95, 0], R: [0.02, 0, 0.08, -0.05, -0.95, 0] }, tuck: 0.6, lean: 0.7, twist: 0, side: 0 },
  critical:  { name: 'Critical', hand: 'L', hands: [['L', 'R', 0.3, 'in']], arms: 'up', ski: { L: [-0.04, -0.18, -0.04, -0.15, 0.35, 0], R: [0.12, 0.1, 0.06, 0.35, -0.95, -0.1] }, tuck: 0.55, lean: 0.65, twist: -0.3, side: -0.25 },
  octo:      { name: 'Octograb', hand: 'B', hands: [['R', 'R', 0.85, 'end'], ['L', 'L', -0.85, 'out']], ski: { L: [-0.04, -0.05, -0.3, -0.15, 0.45, 0], R: [0.04, 0, 0.2, 0.2, -0.85, 0] }, tuck: 0.45, lean: 0.5, twist: 0.1, side: 0 },
  // a blunt: the very end of the tail held, that ski pulled steeply tail up beside the hip and crossed under the other
  // (its tip over to the other side), the knee bent hard, the shoulders turned and dropped to it (2026-11-03: both skis
  // were tail up side by side, parallel, with the tail far behind the hand)
  blunt:     { name: 'Right Blunt', hand: 'R', kind: 'tail', hands: [['R', 'R', -1, 'end']], arms: 'up', ski: { L: [0.02, -0.06, 0.1, -0.22, 0.22, 0.05], R: [-0.07, 0.12, -0.1, 0.55, 1.25, 0.25] }, tuck: 0.5, lean: 0.45, twist: -0.7, side: 0.5 },
  stalefish: { name: 'Stalefish', hand: 'R', hands: [['R', 'L', -0.75, 'out']], arms: 'out', ski: { L: [-0.02, 0, -0.15, 1.15, 0.35, 0], R: [-0.04, 0, 0.1, 1.15, 0.3, 0] }, tuck: 0.5, lean: 0.35, twist: -0.25, side: 0.35 },
  bowarrow:  { name: 'Bow and Arrow', hand: 'B', hands: [['R', 'R', 0.9, 'end'], ['L', 'L', 0.4, 'out']], ski: { L: [0.12, 0.2, 0, 0.15, -1, -0.2], R: [-0.02, -0.12, 0.3, -0.08, -0.6, 0] }, tuck: 0.45, lean: 0.75, twist: 0.1, side: 0.1 },
  dubtail:   { name: 'Double Tail', hand: 'B', hands: [['L', 'L', -0.85, 'out'], ['R', 'R', -0.85, 'out']], ski: { L: [0.02, 0.05, -0.2, -0.08, 0.7, 0], R: [-0.02, 0.05, -0.2, 0.08, 0.7, 0] }, tuck: 0.35, lean: 0.3, twist: 0, side: 0 },
  seatbelt:  { name: 'Seatbelt', hand: 'L', hands: [['L', 'R', -0.85, 'out']], arms: 'up', ski: { L: [0.03, 0.02, -0.02, 0.05, 0.1, 0], R: [-0.08, 0, 0.2, 0.25, 0.65, 0] }, tuck: 0.4, lean: 0.55, twist: -0.8, side: -0.25 },
  // positions
  daffy:     { name: 'Daffy', pos: true, hands: [], arms: 'wide', ski: { L: [0, -0.05, 0.5, 0, -1, 0], R: [0, -0.12, -0.5, 0, 0.85, 0] }, tuck: 0.05, lean: 0.05, twist: 0, side: 0 },
  spread:    { name: 'Spread Eagle', pos: true, hands: [], arms: 'up', ski: { L: [0.48, 0.25, 0, 0.25, -0.85, 0.3], R: [-0.48, 0.25, 0, -0.25, -0.85, -0.3] }, tuck: 0.15, lean: 0.1, twist: 0, side: 0 },
  backscratch: { name: 'Backscratcher', pos: true, hands: [], arms: 'up', ski: { L: [0.04, 0.2, -0.38, 0, 1.2, 0], R: [-0.04, 0.2, -0.38, 0, 1.2, 0] }, tuck: 0.35, lean: -0.1, twist: 0, side: 0 },
  ironcross: { name: 'Iron Cross', pos: true, hands: [], arms: 'wide', ski: { L: [0.06, 0.05, -0.05, -0.75, 0.15, 0], R: [-0.06, 0, -0.05, 0.75, 0.15, 0] }, tuck: 0.5, lean: 0.6, twist: 0, side: 0 },
};
export const POSITIONS = new Set(['daffy', 'spread', 'backscratch', 'ironcross']);

// the mirror image: other hand, other ski, everything sideways turned the other way
const LR = s => s === 'L' ? 'R' : s === 'R' ? 'L' : s;
function mirror(g) {
  const m = (t) => [-t[0], t[1], t[2], -t[3], t[4], -t[5]];
  const name = g.name.startsWith('Left ') ? 'Right ' + g.name.slice(5) : g.name.startsWith('Right ') ? 'Left ' + g.name.slice(6) : g.name;
  return Object.assign({}, g, { name, hand: LR(g.hand), hands: g.hands.map(([h, s, at, e]) => [LR(h), LR(s), at, e]), ski: { L: m(g.ski.R), R: m(g.ski.L) }, twist: -g.twist, side: -g.side });
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
const NAMES = { tweak: 'Tweaked ', poke: 'Poked ' };
export function grabDef(id, mod = '') {
  const g = GRABS[id]; if (!g) return null;
  if (!mod) return g;
  const key = id + '|' + mod;
  if (cache.has(key)) return cache.get(key);
  const E = mod.includes('E'), R = mod.includes('R');
  let d = g, name = g.name;
  if (g.kind === 'truck' || g.hand === 'B' || g.pos) {
    if (g.kind === 'truck' && E !== R) { d = truckTo(g, E ? 1 : -1); name = 'Tweaked Truck to ' + (E ? 'Left' : 'Right'); }
    else { d = tweaked(g); name = 'Tweaked ' + g.name; if (E && R) { d = tweaked(d); name = 'Double Tweaked ' + g.name; } }
  } else {
    const own = g.hand === 'L' ? E : R, other = g.hand === 'L' ? R : E;
    if (g.kind === 'tail' && other && !own) { d = blunt(g); name = 'Uncrossed ' + d.name; }
    else if (own && other) { d = poked(tweaked(g)); name = 'Tweaked ' + NAMES.poke.trim() + ' ' + g.name; }
    else if (own) { d = tweaked(g); name = NAMES.tweak + g.name; }
    else { d = poked(g); name = NAMES.poke + g.name; }
  }
  d = Object.assign({}, d, { name, base: id, mod });
  cache.set(key, d);
  return d;
}
export const grabName = (id, mod) => { const d = grabDef(id, mod); return d ? d.name : id; };

// what each grab is, the way freeskiers describe it (Backcountry Access, Red Bull, NBC's glossary)
export const GRAB_GUIDE = {
  safety: 'same hand, same ski, under the boot, outside edge', mute: 'opposite hand to the other ski, outside edge in front of the binding, skis crossed',
  japan: 'opposite hand under the knee to the tucked ski, inside edge', tail: 'same hand on the tail, tails pulled up behind',
  nose: 'same hand on the tip, legs out straight', truck: 'both hands, each on its own ski in front of the bindings',
  critical: 'opposite hand to the other ski, inside edge in front of the binding', octo: 'one hand on one tip, the other on the other tail, skis crossed',
  blunt: 'same hand on the very end of the tail', stalefish: "a hand to the other ski's tail behind the legs, skis turned sideways",
  bowarrow: 'both hands at the fronts, one leg to the chest, the other straight', dubtail: 'both hands on both tails',
  seatbelt: "reach across the body to the other ski's tail", daffy: 'one ski forward, one back', spread: 'skis and legs wide',
  backscratch: 'tails kicked up behind the back', ironcross: 'skis crossed in an X',
};
export const guideOf = id => GRAB_GUIDE[id] || GRAB_GUIDE[id.replace(/_m$/, '')] || '';
