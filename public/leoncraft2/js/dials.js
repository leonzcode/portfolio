/* ---------------------------------------------------------------------------
   Leoncraft 2 - the item pictures that move.

   The game's compass turns its needle towards the world spawn, the recovery
   compass towards where you last died, and the clock face shows where the
   sun is. Their frames (32, 32 and 64) are in items.png after the items, as
   frame_<item>_<nn> (tools/leoncraft2/build_items.py), and are picked here
   the game's way:

     compass   frame (16 + round(a x 32)) mod 32, where a is the angle from
               where you face to the target, as a share of a turn: 0 dead
               ahead (needle up), growing clockwise. The recovery compass
               points at your last death in this dimension.
     clock     frame round(s x 64) mod 64, where s is the sun's angle from
               noon as a share of a day (frame 0 at noon).

   In the Nether and the End, and for a recovery compass with no death to
   point at, they spin at random, as in the game. The needle and the face
   ease towards where they should be rather than jumping.

     tickDials(state)    once a tick: { yaw, x, z, spawn, time, dim, dead }
                         (yaw as player.js has it: facing -sin, -cos);
                         true when a shown frame changed (redraw the hotbar)
     dialPicture(name)   the frame to show for that item now, or null
--------------------------------------------------------------------------- */
const TURN = Math.PI * 2;
const wrap = a => a - Math.floor(a);
// the shortest way round from a to b, as a share of a turn (-0.5 to 0.5)
const towards = (a, b) => wrap(b - a + 0.5) - 0.5;

// each dial: where it shows (a share of a turn), where it is heading, and its frame
const DIALS = {
  compass: { at: 0, to: 0, frames: 32, base: 16, frame: 16 },
  recovery_compass: { at: 0, to: 0, frames: 32, base: 16, frame: 16 },
  clock: { at: 0, to: 0, frames: 64, base: 0, frame: 0 },
};
let death = null;           // { dim, x, z }: where you last died
let wasDead = false;
let started = false;

// the angle from where you face to a point, as a share of a turn (0 ahead, growing clockwise seen from above)
function angleTo(s, tx, tz) {
  const face = Math.atan2(-Math.cos(s.yaw), -Math.sin(s.yaw));
  return wrap((Math.atan2(tz - s.z, tx - s.x) - face) / TURN);
}

export function tickDials(s) {
  if (s.dead && !wasDead) death = { dim: s.dim, x: s.x, z: s.z };
  wasDead = !!s.dead;
  const home = !s.dim || s.dim === 'overworld';
  // where each should point; a spinning one picks a new heading now and then
  const C = DIALS.compass, R = DIALS.recovery_compass, K = DIALS.clock;
  if (home && s.spawn) C.to = angleTo(s, s.spawn.x + 0.5, s.spawn.z + 0.5);
  else if (Math.random() < 0.1) C.to = Math.random();
  if (death && death.dim === s.dim) R.to = angleTo(s, death.x, death.z);
  else if (Math.random() < 0.1) R.to = Math.random();
  if (home) K.to = wrap(s.time / 24000 - 0.25);
  else if (Math.random() < 0.1) K.to = Math.random();
  let changed = false;
  for (const name in DIALS) {
    const d = DIALS[name];
    // the first tick puts every dial where it belongs; after that they ease a third of the way each tick
    d.at = started ? wrap(d.at + towards(d.at, d.to) / 3) : d.to;
    const f = (d.base + Math.round(d.at * d.frames)) % d.frames;
    if (f !== d.frame) { d.frame = f; changed = true; }
  }
  started = true;
  return changed;
}

export function dialPicture(name) {
  const d = DIALS[name];
  return d ? 'frame_' + name + '_' + String(d.frame).padStart(2, '0') : null;
}
