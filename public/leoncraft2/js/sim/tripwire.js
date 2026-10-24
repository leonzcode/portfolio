/* ---------------------------------------------------------------------------
   Leoncraft 2 - tripwire (the game's TripWireHookBlock and TripWireBlock, as
   the Minecraft Wiki has them): two hooks facing each other across a line of
   string, up to 40 long, on one level. Anything that steps into the string
   (a player, a mob, a dropped item, an arrow) trips it: both hooks turn on,
   15 into the blocks round them and strongly into the block each hangs on,
   and stay on while something is still in the string, looked at again every
   10 ticks. Breaking a string trips the line it was in for those 10 ticks.
   (So the jungle temples' dispenser traps, and any of your own, go off.)

   Meta: the hook's bits 0-2 the face of the block it hangs on (redstone.js
   F6), bit 3 on (sim/states.js draws it tripped); the string's own meta is
   left as it is.
--------------------------------------------------------------------------- */
import { B } from '../blocks.js?v=107';
import { F6, WEAK, STRONG, SOURCE } from './redstone.js?v=107';
import { INSIDE } from './rsparts.js?v=107';

export function installTripwire(sim) {
  const rs = sim.redstone, S = sim;
  if (B.tripwire_hook === undefined || B.tripwire === undefined || !rs) return;
  const HOOK = B.tripwire_hook, WIRE = B.tripwire;
  WEAK[HOOK] = (r, x, y, z, m) => (m & 8 ? 15 : 0);
  STRONG[HOOK] = (r, x, y, z, m, f) => (m & 8 && f === (m & 7) ? 15 : 0);
  SOURCE[HOOK] = 1;
  const at = (x, y, z, f) => { const v = F6[f]; return [x + v[0], y + v[1], z + v[2]]; };
  /* A hook's line: from the hook out from its wall, string after string, to a hook hanging the other
     way (on a wall further along); null when it is not a whole line. */
  function line(x, y, z, m) {
    const f = m & 7;
    if (f === 2 || f === 3) return null;
    const v = F6[f ^ 1], cells = [];
    for (let i = 1; i <= 41; i++) {
      const cx = x + v[0] * i, cz = z + v[2] * i, b = S.get(cx, y, cz);
      if (b === HOOK) return cells.length && (S.meta(cx, y, cz) & 7) === (f ^ 1) ? { other: [cx, y, cz], cells } : null;
      if (b !== WIRE) return null;
      cells.push([cx, y, cz]);
    }
    return null;
  }
  // something in the string (the bottom half of its block)
  function occupied(cells) {
    const list = rs.entityBoxes ? rs.entityBoxes() : [];
    for (const e of list) {
      const b = e.b;
      for (const [cx, cy, cz] of cells) if (b[0] < cx + 1 && b[3] > cx && b[1] < cy + 0.5 && b[4] > cy && b[2] < cz + 1 && b[5] > cz) return true;
    }
    return false;
  }
  function setHook(x, y, z, on) {
    if (S.get(x, y, z) !== HOOK) return;
    const m = S.meta(x, y, z);
    if (!!(m & 8) === on) return;
    S.set(x, y, z, HOOK, on ? m | 8 : m & ~8);
    rs.around(x, y, z);
    const [ax, ay, az] = at(x, y, z, m & 7);
    rs.around(ax, ay, az);
    if (S.onSound) S.onSound(on ? 'block.tripwire.click_on' : 'block.tripwire.click_off', x, y, z, 0.4, on ? 0.6 : 0.5);
  }
  // trip a line from either of its hooks, for at least `hold` ticks
  function trip(x, y, z, hold) {
    const m = S.meta(x, y, z), L = line(x, y, z, m);
    if (!L) return;
    setHook(x, y, z, true); setHook(L.other[0], L.other[1], L.other[2], true);
    rs.go();
    S.unschedule(x, y, z); S.schedule(x, y, z, hold || 10);
    S.unschedule(L.other[0], L.other[1], L.other[2]);
  }
  // the hook of the line a string is in (looking both ways along each axis for one facing in)
  function hookOf(x, y, z) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let i = 1; i <= 41; i++) {
        const cx = x + dx * i, cz = z + dz * i, b = S.get(cx, y, cz);
        if (b === WIRE) continue;
        if (b === HOOK) {
          const m = S.meta(cx, y, cz), f = m & 7, v = F6[f ^ 1];
          // it must look back along this way, and its line must reach this string
          if (v[0] === -dx && v[2] === -dz) { const L = line(cx, y, cz, m); if (L && L.cells.some(c => c[0] === x && c[2] === z)) return [cx, y, cz]; }
        }
        break;
      }
    }
    return null;
  }
  sim.on(HOOK, {
    // looked at again while on: still something in the string, or off (and its partner with it)
    tick(s, x, y, z, m) {
      if (!(m & 8)) return;
      const L = line(x, y, z, m);
      if (L && occupied(L.cells)) { s.schedule(x, y, z, 10); return; }
      setHook(x, y, z, false);
      if (L) setHook(L.other[0], L.other[1], L.other[2], false);
      rs.go();
    },
    removed(s, x, y, z, om) { if (om & 8) { const [ax, ay, az] = at(x, y, z, om & 7); rs.around(ax, ay, az); rs.around(x, y, z); } },
    neighbor(s, x, y, z, m) {
      // a hook hangs on a whole face of the block behind it
      const [ax, ay, az] = at(x, y, z, m & 7);
      if (!rs.sturdy(ax, ay, az, (m & 7) ^ 1)) s.destroy(x, y, z);
    },
  });
  sim.on(WIRE, {
    // a string broken (or cut away) trips its line for a moment
    removed(s, x, y, z) {
      // (the line is broken now: the hooks at its ends, found over the strings left, pulse on their own)
      let any = false;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        for (let i = 1; i <= 41; i++) {
          const cx = x + dx * i, cz = z + dz * i, b = S.get(cx, y, cz);
          if (b === WIRE) continue;
          if (b === HOOK) {
            const v = F6[(S.meta(cx, y, cz) & 7) ^ 1];
            if (v[0] === -dx && v[2] === -dz) { setHook(cx, y, cz, true); s.unschedule(cx, y, cz); s.schedule(cx, y, cz, 10); any = true; }
          }
          break;
        }
      }
      if (any) rs.go();
    },
  });
  INSIDE[WIRE] = (r, x, y, z, m, e) => {
    if (e.b[1] > y + 0.5) return;
    const h = hookOf(x, y, z);
    if (h && !(S.meta(h[0], h[1], h[2]) & 8)) trip(h[0], h[1], h[2], 10);
  };
}
