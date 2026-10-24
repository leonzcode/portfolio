/* ---------------------------------------------------------------------------
   Leoncraft 2 - the parts of redstone, to the game's timing (Java Edition,
   Minecraft Wiki; one game tick is 1/20 s, a "redstone tick" is two).

     redstone torch   on unless the block it hangs on is powered; changes 2
                      ticks after its block does; strongly powers the block
                      above. Turned off 8 times within 60 ticks it burns out
                      until fewer than 8 are left in that window
     lever            15 while on, strongly into the block it is on
     button           15 for 20 ticks (stone) or 30 (wood; an arrow stuck in
                      it keeps it down)
     pressure plate   pressed as soon as something is on it, looked at again
                      every 20 ticks (10 for the weighted ones): wood for any
                      entity, stone for mobs and players; gold gives the
                      number of entities (to 15), iron one per ten (to 15)
     repeater         2, 4, 6 or 8 ticks; full power out of its front; a
                      pulse shorter than its delay comes out as long as the
                      delay; locked by a powered repeater or comparator
                      facing into its side
     comparator       2 ticks; the back signal (or what a container behind
                      it, or behind a block, holds), compared with or minus
                      the stronger side
     redstone lamp    on at once, off 4 ticks after its power goes
     doors, trapdoors and fence gates open while powered (iron ones only so)
     note block       plays when its power comes on (if air is above it);
                      a click goes up a semitone, 25 of them round
     TNT              lit when powered (an 80 tick fuse)
     observer         2 ticks after the block it faces changes, a 2 tick
                      pulse out of its back
     daylight detector  every 20 ticks: the sky's light, weighed by the
                      sun's height (or 15 less it, inverted)
     target           hit by an arrow: up to 15 by how near the middle, for
                      20 ticks (8 for other things thrown)
     lightning rod    struck: 15 for 8 ticks
     redstone ore     lights up (9) when touched, stepped on or hit; goes out
                      on a random tick
     copper bulb      turns on or off each time power comes on
     trapped chest    the number looking in it
     powered and activator rails  powered by a neighbour, or along up to 8
                      more of the same rail from one that is
     detector rail    15 while a minecart is on it, looked at every 20 ticks
     hopper           stops moving items while powered
     bell             rings when power comes on
     lectern          a page turned: 15 for 2 ticks, strongly into the block
                      under it; a comparator reads how far through the book
     chiseled bookshelf  a comparator reads the last slot used, 1 to 6

   Meta layouts are listed in sim/states.js.
--------------------------------------------------------------------------- */
import { B, BLOCKS, FLUID } from '../blocks.js?v=107';
import { F6, HFACE, FACE6, FACE_H, FACE_F6, WEAK, STRONG, COND, SOURCE } from './redstone.js?v=107';
import { lookFacing } from '../place.js?v=107';
import { Living } from '../entities/entity.js?v=107';
import { maxStack } from '../items.js?v=107';
import { selectionBoxes } from '../models.js?v=107';

const SIN = new Float32Array(65536);
for (let i = 0; i < 65536; i++) SIN[i] = Math.sin(i * Math.PI * 2 / 65536);
const mcCos = x => SIN[(Math.trunc(Math.fround(Math.fround(x * 10430.378) + 16384)) & 65535)];
const has = n => B[n] !== undefined;
const idsOf = test => BLOCKS.filter(d => d && test(d.name, d)).map(d => d.id);
export const INSIDE = new Array(4096).fill(null);       // (rs, x, y, z, meta, entity box) for an entity in the cell
export const DIODE = new Uint8Array(4096);

/* The facing a player looking this way puts on a block that faces them
   (a piston) - the game's "nearest looking direction" - 0 north 1 east 2
   south 3 west 4 up 5 down. */
export function nearestLook(player) {
  const yaw = player.yaw, pitch = player.pitch;
  const lx = -Math.sin(yaw) * Math.cos(pitch), ly = Math.sin(pitch), lz = -Math.cos(yaw) * Math.cos(pitch);
  const ax = Math.abs(lx), ay = Math.abs(ly), az = Math.abs(lz);
  if (ay > ax && ay > az) return ly > 0 ? 4 : 5;
  if (ax > az) return lx > 0 ? 1 : 3;
  return lz > 0 ? 2 : 0;
}
export const OPP6 = [2, 3, 0, 1, 5, 4];

export function installParts(sim) {
  const rs = sim.redstone;
  const S = sim;
  const key = (x, y, z) => x + ',' + y + ',' + z;
  const at = (x, y, z, f) => { const v = F6[f]; return [x + v[0], y + v[1], z + v[2]]; };
  const particles = (x, y, z, colour, n, spread) => {
    const P = S.renderer && S.renderer.particles;
    if (!P || !P.spawn) return;
    for (let i = 0; i < (n || 1); i++) P.spawn(x + (Math.random() - 0.5) * (spread || 0), y + (Math.random() - 0.5) * (spread || 0), z + (Math.random() - 0.5) * (spread || 0), 0, 0.02, 0,
      { colour, size: 0.08, life: 8 + Math.floor(Math.random() * 8), gravity: 0, physics: false });
  };
  const dustBits = (x, y, z) => particles(x + 0.5, y + 0.6, z + 0.5, 0xff1a1a, 2, 0.6);
  // a vault gone (broken, blown up, set over by a command) forgets whom it rewarded at once, so one put back
  // in its place is a new vault (details.js would only notice within the second)
  if (B.vault !== undefined) sim.on('vault', { removed: (s, x, y, z) => { const D = s.game && s.game.details; if (D) D.broken(x, y, z); } });

  /* ------------------------------------------------ block of redstone */
  if (has('redstone_block')) { WEAK[B.redstone_block] = () => 15; SOURCE[B.redstone_block] = 1; }

  /* ------------------------------------------------ redstone torch */
  const tooFast = (k, add) => {
    if (add) rs.toggles.push([k, S.n]);
    let c = 0;
    for (const t of rs.toggles) if (t[0] === k) c++;
    return c >= 8;
  };
  for (const name of ['redstone_torch', 'redstone_wall_torch']) {
    if (!has(name)) continue;
    const id = B[name], wall = name !== 'redstone_torch';
    const att = m => (wall ? m & 7 : 3);        // the face it hangs from
    WEAK[id] = (r, x, y, z, m, f) => (!(m & 8) && f !== att(m) ? 15 : 0);
    STRONG[id] = (r, x, y, z, m, f) => (!(m & 8) && f === 2 ? 15 : 0);
    SOURCE[id] = 1;
    sim.on(id, {
      neighbor(s, x, y, z, m, fx, fy, fz, kind) {
        const [ax, ay, az] = at(x, y, z, att(m));
        const ok = wall ? rs.sturdy(ax, ay, az, att(m) ^ 1) : (() => { const b = s.get(ax, ay, az); return b && BLOCKS[b].solid; })();
        if (!ok) { s.destroy(x, y, z); return; }
        if (kind === 2) return;
        const lit = !(m & 8), p = rs.signalFrom(x, y, z, att(m)) > 0;
        if (lit === p && !s.willTickThisTick(x, y, z)) s.schedule(x, y, z, 2);
      },
      tick(s, x, y, z, m) {
        while (rs.toggles.length && s.n - rs.toggles[0][1] > 60) rs.toggles.shift();
        const p = rs.signalFrom(x, y, z, att(m)) > 0, k = key(x, y, z);
        if (!(m & 8)) {
          if (p) {
            s.set(x, y, z, id, m | 8); rs.around2(x, y, z); rs.go();
            if (tooFast(k, true)) {
              // burnt out: a puff of smoke, and a look again in 8 seconds
              particles(x + 0.5, y + 0.7, z + 0.5, 0x606060, 5, 0.3);
              s.schedule(x, y, z, 160);
              if (s.onBurnout) s.onBurnout(x, y, z);
            }
          }
        } else if (!p && !tooFast(k, false)) { s.set(x, y, z, id, m & ~8); rs.around2(x, y, z); rs.go(); }
      },
      onPlace(s, x, y, z) { rs.around2(x, y, z); },
      removed(s, x, y, z) { rs.around2(x, y, z); },
    });
  }

  /* ------------------------------------------------ lever and buttons */
  const attachedOk = (x, y, z, m) => { const f = m & 7, [ax, ay, az] = at(x, y, z, f); return rs.sturdy(ax, ay, az, f ^ 1); };
  const hangCheck = (s, x, y, z, m) => { if (!attachedOk(x, y, z, m)) { s.destroy(x, y, z); return false; } return true; };
  if (has('lever')) {
    const id = B.lever;
    WEAK[id] = (r, x, y, z, m) => (m & 8 ? 15 : 0);
    STRONG[id] = (r, x, y, z, m, f) => (m & 8 && f === (m & 7) ? 15 : 0);
    SOURCE[id] = 1;
    sim.on(id, {
      use(s, x, y, z, m) {
        s.set(x, y, z, id, m ^ 8);
        const [ax, ay, az] = at(x, y, z, m & 7);
        rs.around(ax, ay, az); rs.go();
        if (!(m & 8)) dustBits(x, y, z);
        if (s.onClick) s.onClick(x, y, z, 'lever', !(m & 8));
        return true;
      },
      removed(s, x, y, z, om) { if (om & 8) { const [ax, ay, az] = at(x, y, z, om & 7); rs.around(ax, ay, az); } },
      neighbor(s, x, y, z, m) { hangCheck(s, x, y, z, m); },
    });
  }
  /* ------------------------------------------------ lectern: a page turned (details.js) is a pulse of 2 ticks, bit 3 */
  if (has('lectern')) {
    const id = B.lectern;
    WEAK[id] = (r, x, y, z, m) => (m & 8 ? 15 : 0);
    STRONG[id] = (r, x, y, z, m, f) => (m & 8 && f === 3 ? 15 : 0);
    SOURCE[id] = 1;
    const out = (x, y, z) => { const [ax, ay, az] = at(x, y, z, 3); rs.around(x, y, z); rs.around(ax, ay, az); rs.go(); };
    sim.lecternPulse = (x, y, z) => {
      const m = S.meta(x, y, z);
      if (S.get(x, y, z) !== id) return;
      if (!(m & 8)) { S.set(x, y, z, id, m | 8); out(x, y, z); }
      // (a page turned while it is still on starts the 2 ticks again)
      S.unschedule(x, y, z); S.schedule(x, y, z, 2);
    };
    sim.on(id, {
      tick(s, x, y, z, m) { if (m & 8) { s.set(x, y, z, id, m & ~8); out(x, y, z); } },
      removed(s, x, y, z, om) { if (om & 8) { const [ax, ay, az] = at(x, y, z, 3); rs.around(ax, ay, az); } },
    });
  }
  // how long a button stays pressed: 20 ticks for stone ones, 30 for wood (which arrows press too)
  const buttonTime = n => (/^(stone|polished_blackstone)_button$/.test(n) ? 20 : 30);
  for (const id of idsOf(n => /_button$/.test(n))) {
    const n = BLOCKS[id].name, time = buttonTime(n), arrows = time === 30;
    WEAK[id] = (r, x, y, z, m) => (m & 8 ? 15 : 0);
    STRONG[id] = (r, x, y, z, m, f) => (m & 8 && f === (m & 7) ? 15 : 0);
    SOURCE[id] = 1;
    const setPressed = (s, x, y, z, m, on) => {
      s.set(x, y, z, id, on ? m | 8 : m & ~8);
      const [ax, ay, az] = at(x, y, z, m & 7);
      rs.around(ax, ay, az); rs.go();
      if (s.onClick) s.onClick(x, y, z, 'button', on);
    };
    sim.on(id, {
      use(s, x, y, z, m) {
        if (m & 8) return true;
        setPressed(s, x, y, z, m, true);
        s.schedule(x, y, z, time);
        return true;
      },
      tick(s, x, y, z, m) {
        if (!(m & 8)) return;
        if (arrows && arrowIn(x, y, z, m)) { s.schedule(x, y, z, time); return; }
        setPressed(s, x, y, z, m, false);
      },
      removed(s, x, y, z, om) { if (om & 8) { const [ax, ay, az] = at(x, y, z, om & 7); rs.around(ax, ay, az); } },
      neighbor(s, x, y, z, m) { hangCheck(s, x, y, z, m); },
    });
    if (arrows) INSIDE[id] = (r, x, y, z, m, e) => {
      if (e.k !== 'arrow' || (m & 8)) return;
      if (!arrowIn(x, y, z, m)) return;
      setPressed(S, x, y, z, m, true);
      S.schedule(x, y, z, time);
    };
  }
  // an arrow whose box touches the button's
  function arrowIn(x, y, z, m) {
    const E = S.game && S.game.entities;
    if (!E) return false;
    const d = BLOCKS[S.get(x, y, z)], bx = selectionBoxes(d, m, () => null) || [[0, 0, 0, 1, 1, 1]];
    let hit = false;
    E.forNear(x + 0.5, z + 0.5, 2, e => {
      if (hit || e.removed || !/arrow|trident/.test(e.type)) return;
      const a = [e.pos.x - 0.25, e.pos.y, e.pos.z - 0.25, e.pos.x + 0.25, e.pos.y + 0.5, e.pos.z + 0.25];
      for (const b of bx) if (a[0] < x + b[3] && a[3] > x + b[0] && a[1] < y + b[4] && a[4] > y + b[1] && a[2] < z + b[5] && a[5] > z + b[2]) { hit = true; return; }
    });
    return hit;
  }

  /* ------------------------------------------------ pressure plates */
  for (const id of idsOf(n => /_pressure_plate$/.test(n))) {
    const n = BLOCKS[id].name;
    const weighted = /weighted/.test(n), heavy = n === 'heavy_weighted_pressure_plate';
    const mobsOnly = /^(stone|polished_blackstone)_pressure_plate$/.test(n);
    const sig = m => (weighted ? m & 15 : m & 1 ? 15 : 0);
    WEAK[id] = (r, x, y, z, m) => sig(m);
    STRONG[id] = (r, x, y, z, m, f) => (f === 3 ? sig(m) : 0);
    SOURCE[id] = 1;
    // what is on it now, the game's way: anything in the box 1/16 in from the sides and a quarter high
    const strength = (x, y, z) => {
      const box = [x + 0.0625, y, z + 0.0625, x + 0.9375, y + 0.25, z + 0.9375];
      let c = 0;
      for (const e of entityBoxes()) {
        if (mobsOnly && !e.living) continue;
        if (e.b[0] < box[3] && e.b[3] > box[0] && e.b[1] < box[4] && e.b[4] > box[1] && e.b[2] < box[5] && e.b[5] > box[2]) { c++; if (!weighted) break; }
      }
      if (!weighted) return c > 0 ? 15 : 0;
      if (!c) return 0;
      const max = heavy ? 150 : 15;
      return Math.ceil(Math.min(max, c) / max * 15);
    };
    const check = (s, x, y, z, m, cur) => {
      const j = strength(x, y, z);
      if (cur !== j) {
        s.set(x, y, z, id, weighted ? (m & ~15) | j : j > 0 ? m | 1 : m & ~1);
        rs.around(x, y - 1, z); rs.go();
        if (s.onClick) s.onClick(x, y, z, 'plate', j > 0);
      }
      if (j > 0) s.schedule(x, y, z, weighted ? 10 : 20);
    };
    sim.on(id, {
      tick(s, x, y, z, m) { const c = sig(m); if (c > 0) check(s, x, y, z, m, c); },
      neighbor(s, x, y, z) { if (!rs.sturdy(x, y - 1, z, 2) && !(BLOCKS[s.get(x, y - 1, z)] || {}).solid) s.destroy(x, y, z); },
      removed(s, x, y, z, om) { if (sig(om) > 0) rs.around(x, y - 1, z); },
    });
    INSIDE[id] = (r, x, y, z, m, e) => { if (sig(m) === 0 && (!mobsOnly || e.living)) check(S, x, y, z, m, 0); };
  }

  /* ------------------------------------------------ repeater */
  if (has('repeater')) {
    const R = B.repeater;
    DIODE[R] = 1; SOURCE[R] = 1;
    const out = m => HFACE[m & 3];
    const sides = m => [HFACE[(m + 1) & 3], HFACE[(m + 3) & 3]];
    WEAK[R] = STRONG[R] = (r, x, y, z, m, f) => (m & 16 && f === out(m) ? 15 : 0);
    const input = (x, y, z, m) => {
      const fi = out(m) ^ 1;
      let p = rs.signalFrom(x, y, z, fi);
      if (p < 15) { const [ix, iy, iz] = at(x, y, z, fi); if (S.get(ix, iy, iz) === B.redstone_wire) p = Math.max(p, S.meta(ix, iy, iz) & 15); }
      return p;
    };
    const locked = (x, y, z, m) => {
      for (const fs of sides(m)) {
        const [nx, ny, nz] = at(x, y, z, fs), b = S.get(nx, ny, nz);
        if (DIODE[b] && STRONG[b](rs, nx, ny, nz, S.meta(nx, ny, nz), fs ^ 1) > 0) return true;
      }
      return false;
    };
    const delay = m => (((m >> 2) & 3) + 1) * 2;
    rs.repeaterInput = input;
    sim.on(R, {
      neighbor(s, x, y, z, m, fx, fy, fz, kind) {
        if (!rs.sturdy(x, y - 1, z, 2)) { s.destroy(x, y, z); return; }
        // the lock follows the sides at once
        const L = locked(x, y, z, m);
        if (!!(m & 32) !== L) { m = L ? m | 32 : m & ~32; rs.setState(x, y, z, R, m); rs.front(x, y, z, out(m)); }
        if (kind === 2 || L) { rs.go(); return; }
        const on = !!(m & 16), want = input(x, y, z, m) > 0;
        if (on !== want && !s.willTickThisTick(x, y, z)) {
          const [ox, oy, oz] = at(x, y, z, out(m)), ob = s.get(ox, oy, oz);
          let pr = -1;
          if (DIODE[ob] && (s.meta(ox, oy, oz) & 3) !== ((m + 2) & 3)) pr = -3;
          else if (on) pr = -2;
          s.schedule(x, y, z, delay(m), pr);
        }
        rs.go();
      },
      tick(s, x, y, z, m) {
        if (locked(x, y, z, m)) return;
        const on = !!(m & 16), want = input(x, y, z, m) > 0;
        if (on && !want) { rs.setState(x, y, z, R, m & ~16); rs.front(x, y, z, out(m)); rs.go(); }
        else if (!on) {
          rs.setState(x, y, z, R, m | 16); rs.front(x, y, z, out(m)); rs.go();
          // a pulse shorter than the delay is stretched to it
          if (!want) s.schedule(x, y, z, delay(m), -2);
        }
      },
      use(s, x, y, z, m) { s.set(x, y, z, R, (m & ~12) | ((((m >> 2) & 3) + 1) & 3) << 2); return true; },
      onPlace(s, x, y, z, m) { rs.front(x, y, z, out(m)); if (input(x, y, z, m) > 0) s.schedule(x, y, z, 1); },
      removed(s, x, y, z, om) { rs.front(x, y, z, out(om)); },
    });
  }

  /* ------------------------------------------------ comparator */
  // what a block reads as to a comparator behind it, or -1 if it is nothing a comparator reads
  const analog = (x, y, z) => {
    const b = S.get(x, y, z);
    if (!b) return -1;
    const d = BLOCKS[b], n = d.name, m = S.meta(x, y, z);
    const C = S.game && S.game.containers;
    if (C && /^(chest|trapped_chest|barrel|hopper|dispenser|dropper|furnace|smoker|blast_furnace|brewing_stand)$|shulker_box$/.test(n)) {
      const list = [C.peek(x, y, z)];
      if (n === 'chest' || n === 'trapped_chest') { const p = C.partner(x, y, z); if (p) list.push(C.peek(p[0], p[1], p[2])); else list.push(null); }
      const sizes = { furnace: 3, smoker: 3, blast_furnace: 3, hopper: 5, brewing_stand: 5, dispenser: 9, dropper: 9 };
      const per = sizes[n] || 27;
      let f = 0, slots = 0;
      for (const c of list) {
        slots += per;
        if (!c) continue;
        for (const st of c.slots) if (st && st.count > 0) f += st.count / Math.min(64, maxStack(st.id));
      }
      f /= slots;
      return f > 0 ? Math.floor(f * 14) + 1 : 0;
    }
    if (n === 'cake') return (7 - Math.min(6, m & 7)) * 2;
    if (/candle_cake$/.test(n)) return 14;
    if (n === 'cauldron') return 0;
    if (n === 'water_cauldron' || n === 'powder_snow_cauldron') return Math.max(1, Math.min(3, m & 3));
    if (n === 'lava_cauldron') return 3;
    if (n === 'composter') return Math.min(8, m & 15);
    if (n === 'end_portal_frame') return m & 4 ? 15 : 0;
    if (n === 'respawn_anchor') return Math.floor(15 * Math.min(4, m & 7) / 4);
    if (/copper_bulb$/.test(n)) return m & 1 ? 15 : 0;
    if (n === 'jukebox') { const D = S.game && S.game.details; return D && D.jukeboxSignal ? D.jukeboxSignal(x, y, z) : 0; }
    if (n === 'sculk_sensor' || n === 'calibrated_sculk_sensor') return S.sculk ? S.sculk.frequency(x, y, z) : 0;
    if (n === 'chiseled_bookshelf' || n === 'lectern') {
      const D = S.game && S.game.details;
      return D ? (n === 'lectern' ? D.lecternSignal(x, y, z) : D.shelfSignal(x, y, z)) : 0;
    }
    if (n === 'beehive' || n === 'bee_nest') return (S.meta(x, y, z) >> 2) & 7;
    if (n === 'decorated_pot' || n === 'crafter') return 0;
    if (n === 'detector_rail') return 0;
    return -1;
  };
  rs.analog = analog;
  if (has('comparator')) {
    const C = B.comparator;
    DIODE[C] = 1; SOURCE[C] = 1;
    const out = m => HFACE[m & 3];
    const sides = m => [HFACE[(m + 1) & 3], HFACE[(m + 3) & 3]];
    const outOf = (x, y, z) => { const e = S.state.get(key(x, y, z)); return e ? e.c | 0 : 0; };
    const setOut = (x, y, z, v) => { const k = key(x, y, z); if (v) S.state.set(k, { c: v, keep: true }); else S.state.delete(k); };
    WEAK[C] = STRONG[C] = (r, x, y, z, m, f) => (m & 8 && f === out(m) ? outOf(x, y, z) : 0);
    const input = (x, y, z, m) => {
      const fi = out(m) ^ 1, [bx, by, bz] = at(x, y, z, fi), b = S.get(bx, by, bz);
      let i = rs.signalFrom(x, y, z, fi);
      if (i < 15 && b === B.redstone_wire) i = Math.max(i, S.meta(bx, by, bz) & 15);
      const a = analog(bx, by, bz);
      if (a >= 0) return a;
      if (i < 15 && COND[b]) { const [cx, cy, cz] = at(bx, by, bz, fi), a2 = analog(cx, cy, cz); if (a2 >= 0) i = a2; }
      return i;
    };
    const alt = (x, y, z, m) => {
      let j = 0;
      for (const fs of sides(m)) {
        const [nx, ny, nz] = at(x, y, z, fs), b = S.get(nx, ny, nz);
        if (!SOURCE[b]) continue;
        const v = b === B.redstone_block ? 15 : b === B.redstone_wire ? S.meta(nx, ny, nz) & 15 : STRONG[b] ? STRONG[b](rs, nx, ny, nz, S.meta(nx, ny, nz), fs ^ 1) : 0;
        if (v > j) j = v;
      }
      return j;
    };
    const calc = (x, y, z, m) => { const i = input(x, y, z, m); if (!i) return 0; const j = alt(x, y, z, m); if (j > i) return 0; return m & 4 ? i - j : i; };
    const shouldOn = (x, y, z, m) => { const i = input(x, y, z, m); if (!i) return false; const j = alt(x, y, z, m); return i > j || (i === j && !(m & 4)); };
    const check = (s, x, y, z, m) => {
      if (s.willTickThisTick(x, y, z)) return;
      if (calc(x, y, z, m) !== outOf(x, y, z) || !!(m & 8) !== shouldOn(x, y, z, m)) {
        const [ox, oy, oz] = at(x, y, z, out(m)), ob = s.get(ox, oy, oz);
        s.schedule(x, y, z, 2, DIODE[ob] && (s.meta(ox, oy, oz) & 3) !== ((m + 2) & 3) ? -1 : 0);
      }
    };
    const refresh = (s, x, y, z, m) => {
      const o = calc(x, y, z, m), cur = outOf(x, y, z);
      setOut(x, y, z, o);
      if (cur !== o || !(m & 4)) {
        const on = shouldOn(x, y, z, m), was = !!(m & 8);
        if (was && !on) rs.setState(x, y, z, C, m & ~8);
        else if (!was && on) rs.setState(x, y, z, C, m | 8);
        rs.front(x, y, z, out(m)); rs.go();
      }
    };
    rs.comparatorOut = outOf;
    sim.on(C, {
      neighbor(s, x, y, z, m, fx, fy, fz, kind) {
        if (!rs.sturdy(x, y - 1, z, 2)) { s.destroy(x, y, z); return; }
        if (kind !== 2) check(s, x, y, z, m);
      },
      tick(s, x, y, z, m) { refresh(s, x, y, z, m); },
      use(s, x, y, z, m) { s.silentSet(x, y, z, C, m ^ 4); rs.shapes(x, y, z); refresh(s, x, y, z, m ^ 4); return true; },
      onPlace(s, x, y, z, m) { rs.poll(x, y, z, true); rs.front(x, y, z, out(m)); if (shouldOn(x, y, z, m)) s.schedule(x, y, z, 1); },
      removed(s, x, y, z, om) { rs.poll(x, y, z, false); setOut(x, y, z, 0); rs.front(x, y, z, out(om)); },
    });
    // a container's contents change without a block update: comparators look every tick
    rs.pollers = rs.pollers || {};
    rs.pollers[C] = (r, x, y, z, m) => check(S, x, y, z, m);
  }

  /* ------------------------------------------------ redstone lamp */
  if (has('redstone_lamp')) {
    const L = B.redstone_lamp;
    sim.on(L, {
      neighbor(s, x, y, z, m, fx, fy, fz, kind) {
        if (kind === 2) return;
        const lit = !!(m & 1), p = rs.powered(x, y, z);
        if (lit === p) return;
        if (lit) s.schedule(x, y, z, 4);
        else { rs.setState(x, y, z, L, m | 1); rs.go(); }
      },
      tick(s, x, y, z, m) { if (m & 1 && !rs.powered(x, y, z)) { rs.setState(x, y, z, L, m & ~1); rs.go(); } },
      onPlace(s, x, y, z, m) { if (!(m & 1) && rs.powered(x, y, z)) { rs.setState(x, y, z, L, m | 1); } },
    });
  }

  /* ------------------------------------------------ doors, trapdoors, fence gates */
  for (const id of idsOf((n, d) => d.shape === 'door')) {
    sim.on(id, {
      neighbor(s, x, y, z, m, fx, fy, fz, kind) {
        if (kind === 2 || s.get(fx, fy, fz) === id) return;
        const oy = m & 8 ? y - 1 : y + 1;
        const p = rs.powered(x, y, z) || rs.powered(x, oy, z);
        if (p === !!(m & 32)) return;
        const bits = m2 => (m2 & ~(4 | 32)) | (p ? 4 | 32 : 0);
        rs.setState(x, y, z, id, bits(m));
        if (s.get(x, oy, z) === id) rs.setState(x, oy, z, id, bits(s.meta(x, oy, z)));
        if (!!(m & 4) !== p && s.onDoor) s.onDoor(x, y, z, p);
        rs.go();
      },
    });
  }
  for (const id of idsOf((n, d) => d.shape === 'trapdoor')) {
    sim.on(id, {
      neighbor(s, x, y, z, m, fx, fy, fz, kind) {
        if (kind === 2) return;
        const p = rs.powered(x, y, z);
        if (p === !!(m & 32)) return;
        rs.setState(x, y, z, id, (m & ~(4 | 32)) | (p ? 4 | 32 : 0));
        rs.go();
      },
    });
  }
  for (const id of idsOf((n, d) => d.shape === 'gate')) {
    sim.on(id, {
      neighbor(s, x, y, z, m, fx, fy, fz, kind) {
        if (kind === 2) return;
        const p = rs.powered(x, y, z);
        if (p === !!(m & 8)) return;
        rs.setState(x, y, z, id, (m & ~(4 | 8)) | (p ? 4 | 8 : 0));
        rs.go();
      },
    });
  }

  /* ------------------------------------------------ note block */
  if (has('note_block')) {
    const N = B.note_block;
    const play = (s, x, y, z, m) => {
      const above = s.get(x, y + 1, z);
      if (above && !(BLOCKS[above].shape === 'head')) return false;
      const note = m & 31, f = note / 24;
      const c = v => Math.max(0, Math.min(255, Math.round((Math.max(0, Math.sin((f + v) * Math.PI * 2) * 0.65 + 0.35)) * 255)));
      const P = s.renderer && s.renderer.particles;
      if (P && P.spawn) P.spawn(x + 0.5, y + 1.2, z + 0.5, 0, 0.06, 0, { colour: (c(0) << 16) | (c(1 / 3) << 8) | c(2 / 3), size: 0.18, life: 6, gravity: 0, physics: false });
      if (s.onNote) s.onNote(x, y, z, instrument(s.get(x, y - 1, z)), note);
      s.lastNote = { x, y, z, note, at: s.n, instrument: instrument(s.get(x, y - 1, z)) };
      return true;
    };
    rs.playNote = (x, y, z) => play(S, x, y, z, S.meta(x, y, z));
    sim.on(N, {
      neighbor(s, x, y, z, m, fx, fy, fz, kind) {
        if (kind === 2) return;
        const p = rs.powered(x, y, z);
        if (p === !!(m & 32)) return;
        if (p) play(s, x, y, z, m);
        s.set(x, y, z, N, (m & ~32) | (p ? 32 : 0));
      },
      use(s, x, y, z, m) {
        const nm = (m & ~31) | (((m & 31) + 1) % 25);
        s.set(x, y, z, N, nm);
        play(s, x, y, z, nm);
        return true;
      },
    });
  }
  // the instrument a note block plays: what is under it (the Minecraft Wiki, Note Block)
  function instrument(b) {
    const d = BLOCKS[b];
    if (!d) return 'harp';
    const n = d.name;
    if (/_log$|_wood$|_planks$|_stem$|_hyphae$|bookshelf|note_block|jukebox|_fence|_sign|banner|chest|crafting_table|daylight|loom|barrel|composter|bee|lectern|campfire|mushroom_block|_slab$|_stairs$/.test(n) && !/stone|brick|quartz|copper|deepslate|tuff|blackstone|purpur|prismarine|sandstone|mud_brick/.test(n)) return 'bass';
    if (/^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel)$|concrete_powder$/.test(n)) return 'snare';
    if (/glass|sea_lantern|beacon/.test(n)) return 'hat';
    if (/stone|^cobble|ore$|brick|netherrack|nylium|obsidian|quartz|sandstone|terracotta|concrete$|deepslate|tuff|basalt|blackstone|purpur|prismarine|coral_block|end_stone|bedrock|observer|dispenser|dropper|furnace|smoker|calcite|dripstone/.test(n)) return 'basedrum';
    if (n === 'gold_block') return 'bell';
    if (n === 'clay') return 'flute';
    if (n === 'packed_ice') return 'chime';
    if (/_wool$/.test(n)) return 'guitar';
    if (n === 'bone_block') return 'xylophone';
    if (n === 'iron_block') return 'iron_xylophone';
    if (n === 'soul_sand') return 'cow_bell';
    if (n === 'pumpkin') return 'didgeridoo';
    if (n === 'emerald_block') return 'bit';
    if (n === 'hay_block') return 'banjo';
    if (n === 'glowstone') return 'pling';
    return 'harp';
  }

  /* ------------------------------------------------ TNT */
  if (has('tnt')) {
    const T = B.tnt;
    const light = (s, x, y, z) => { if (!rs.powered(x, y, z)) return false; s.set(x, y, z, 0, 0); if (s.primeTnt) s.primeTnt(x, y, z, null, 80); return true; };
    sim.on(T, {
      onPlace(s, x, y, z) { light(s, x, y, z); },
      neighbor(s, x, y, z, m, fx, fy, fz, kind) { if (kind !== 2) light(s, x, y, z); },
    });
  }

  /* ------------------------------------------------ observer */
  if (has('observer')) {
    const O = B.observer;
    const back = m => FACE6[Math.min(5, m & 7)] ^ 1;
    WEAK[O] = STRONG[O] = (r, x, y, z, m, f) => (m & 8 && f === back(m) ? 15 : 0);
    SOURCE[O] = 1;
    sim.on(O, {
      neighbor(s, x, y, z, m, fx, fy, fz, kind) {
        if (kind === 1 || (m & 8)) return;
        const v = F6[FACE6[Math.min(5, m & 7)]];
        if (fx !== x + v[0] || fy !== y + v[1] || fz !== z + v[2]) return;
        if (!s.scheduled(x, y, z)) s.schedule(x, y, z, 2);
      },
      tick(s, x, y, z, m) {
        if (m & 8) rs.setState(x, y, z, O, m & ~8);
        else { rs.setState(x, y, z, O, m | 8); s.schedule(x, y, z, 2); }
        rs.front(x, y, z, back(m)); rs.go();
      },
      onPlace(s, x, y, z, m) { if (m & 8 && !s.scheduled(x, y, z)) { s.silentSet(x, y, z, O, m & ~8); rs.front(x, y, z, back(m)); } },
      removed(s, x, y, z, om) { if (om & 8) rs.front(x, y, z, back(om)); },
    });
  }

  /* ------------------------------------------------ daylight detector */
  if (has('daylight_detector')) {
    const D = B.daylight_detector;
    WEAK[D] = (r, x, y, z, m) => m & 15;
    SOURCE[D] = 1;
    const level = (x, y, z, m) => {
      if (S.dimension() !== 'overworld') return m & 16 ? 15 : 0;
      let i = S.skyLight(x, y, z) - S.skyDarken();
      const inv = !!(m & 16);
      if (inv) i = 15 - i;
      else if (i > 0) {
        let f = Math.fround(S.celestial() * Math.fround(Math.PI * 2));
        const f1 = f < Math.PI ? 0 : Math.PI * 2;
        f = Math.fround(f + Math.fround((f1 - f) * 0.2));
        i = Math.round(i * mcCos(f));
      }
      return Math.max(0, Math.min(15, i));
    };
    const update = (s, x, y, z, m) => { const p = level(x, y, z, m); if ((m & 15) !== p) s.set(x, y, z, D, (m & ~15) | p); };
    rs.daylightLevel = (x, y, z) => level(x, y, z, S.meta(x, y, z));
    sim.on(D, {
      use(s, x, y, z, m) { s.silentSet(x, y, z, D, m ^ 16); update(s, x, y, z, m ^ 16); return true; },
      onPlace(s, x, y, z) { rs.poll(x, y, z, true); },
      removed(s, x, y, z) { rs.poll(x, y, z, false); },
    });
    rs.pollers = rs.pollers || {};
    rs.pollers[D] = (r, x, y, z, m) => { if (S.n % 20 === 0) update(S, x, y, z, m); };
  }

  /* ------------------------------------------------ target block */
  if (has('target')) {
    const TG = B.target;
    WEAK[TG] = (r, x, y, z, m) => m & 15;
    SOURCE[TG] = 1;
    sim.on(TG, {
      tick(s, x, y, z, m) { if (m & 15) s.set(x, y, z, TG, m & ~15); },
      onPlace(s, x, y, z, m) { if (m & 15 && !s.scheduled(x, y, z)) s.silentSet(x, y, z, TG, m & ~15); },
    });
    // a projectile struck it at (hx, hy, hz) on face f: power by how near the middle, held 20 ticks for arrows, 8 for the rest
    rs.targetHit = (x, y, z, hx, hy, hz, f, isArrow) => {
      if (S.get(x, y, z) !== TG || S.scheduled(x, y, z)) return 0;
      const fr = v => v - Math.floor(v);
      const dx = Math.abs(fr(hx) - 0.5), dy = Math.abs(fr(hy) - 0.5), dz = Math.abs(fr(hz) - 0.5);
      const d = f === 2 || f === 3 ? Math.max(dx, dz) : f === 4 || f === 5 ? Math.max(dx, dy) : Math.max(dy, dz);
      const p = Math.max(1, Math.ceil(15 * Math.max(0, Math.min(1, (0.5 - d) / 0.5))));
      S.set(x, y, z, TG, (S.meta(x, y, z) & ~15) | p);
      S.schedule(x, y, z, isArrow ? 20 : 8);
      return p;
    };
  }

  /* ------------------------------------------------ lightning rods */
  for (const id of idsOf(n => /lightning_rod$/.test(n))) {
    const attached = m => FACE6[Math.min(5, m & 7)] ^ 1;
    WEAK[id] = (r, x, y, z, m) => (m & 8 ? 15 : 0);
    STRONG[id] = (r, x, y, z, m, f) => (m & 8 && f === attached(m) ? 15 : 0);
    SOURCE[id] = 1;
    sim.on(id, {
      tick(s, x, y, z, m) {
        if (!(m & 8)) return;
        s.set(x, y, z, id, m & ~8);
        const [ax, ay, az] = at(x, y, z, attached(m)); rs.around(ax, ay, az); rs.go();
      },
    });
  }
  rs.pulseRod = (x, y, z) => {
    const b = S.get(x, y, z);
    if (!b || !/lightning_rod$/.test(BLOCKS[b].name)) return false;
    const m = S.meta(x, y, z);
    S.set(x, y, z, b, m | 8);
    const [ax, ay, az] = at(x, y, z, FACE6[Math.min(5, m & 7)] ^ 1); rs.around(ax, ay, az); rs.go();
    S.schedule(x, y, z, 8);
    return true;
  };

  /* ------------------------------------------------ redstone ore */
  for (const id of idsOf(n => n === 'redstone_ore' || n === 'deepslate_redstone_ore')) {
    sim.on(id, {
      random(s, x, y, z, m) { if (m & 1) s.set(x, y, z, id, m & ~1); },
      use(s, x, y, z, m, held) {
        rs.touchOre(x, y, z);
        // with a block in hand the block still goes down after it lights
        const hid = s.inv ? s.inv.heldId() : 0;
        return !(hid && BLOCKS[hid] && BLOCKS[hid].item !== false && hid < 4096);
      },
    });
  }
  rs.touchOre = (x, y, z) => {
    const b = S.get(x, y, z);
    if (b !== B.redstone_ore && b !== B.deepslate_redstone_ore) return;
    particles(x + 0.5, y + 0.5, z + 0.5, 0xff1a1a, 4, 1.1);
    const m = S.meta(x, y, z);
    if (!(m & 1)) S.set(x, y, z, b, m | 1);
  };

  /* ------------------------------------------------ copper bulbs */
  for (const id of idsOf(n => /copper_bulb$/.test(n))) {
    const flip = (s, x, y, z, m) => {
      const p = rs.powered(x, y, z);
      if (p === !!(m & 2)) return;
      let nm = m;
      if (!(m & 2)) nm ^= 1;
      s.set(x, y, z, id, (nm & ~2) | (p ? 2 : 0));
    };
    sim.on(id, {
      neighbor(s, x, y, z, m, fx, fy, fz, kind) { if (kind !== 2) flip(s, x, y, z, m); },
      onPlace(s, x, y, z, m) { flip(s, x, y, z, m); },
    });
  }

  /* ------------------------------------------------ bell */
  if (has('bell')) {
    sim.on(B.bell, {
      neighbor(s, x, y, z, m, fx, fy, fz, kind) {
        if (kind === 2) return;
        const p = rs.powered(x, y, z);
        if (p === !!(m & 16)) return;
        if (p && s.onBell) s.onBell(x, y, z);
        // (it swings away from the way it faces: sim/lids.js)
        if (p && s.lids) s.lids.ring(x, y, z, [5, 0, 4, 1][(m >> 1) & 3]);
        if (p) s.lastBell = { x, y, z, at: s.n };
        s.set(x, y, z, B.bell, (m & ~16) | (p ? 16 : 0));
      },
    });
  }

  /* ------------------------------------------------ hopper: locked while powered (meta bit 3) */
  if (has('hopper')) {
    const H = B.hopper;
    const lock = (s, x, y, z, m) => { const p = rs.powered(x, y, z); if (p !== !!(m & 8)) { rs.setState(x, y, z, H, (m & ~8) | (p ? 8 : 0)); rs.go(); } };
    sim.on(H, {
      neighbor(s, x, y, z, m, fx, fy, fz, kind) { if (kind !== 2) lock(s, x, y, z, m); },
      onPlace(s, x, y, z, m) { lock(s, x, y, z, m); },
    });
  }

  /* ------------------------------------------------ trapped chest: the number of people looking in */
  if (has('trapped_chest')) {
    const TC = B.trapped_chest;
    const viewers = (x, y, z) => { const v = rs.viewing; if (!v) return 0; return v.some(p => p[0] === x && p[1] === y && p[2] === z) ? 1 : 0; };
    WEAK[TC] = (r, x, y, z) => viewers(x, y, z);
    STRONG[TC] = (r, x, y, z, m, f) => (f === 3 ? viewers(x, y, z) : 0);
    SOURCE[TC] = 1;
    const tell = list => { for (const [x, y, z] of list) { rs.around(x, y, z); rs.around(x, y - 1, z); } rs.go(); };
    // a container screen opened on one (hands.js opens it): look at the gui each tick until it is shut
    rs.openedContainer = (x, y, z) => {
      if (S.get(x, y, z) !== TC) return;
      const C = S.game && S.game.containers, p = C && C.partner(x, y, z);
      rs.viewing = p ? [[x, y, z], p] : [[x, y, z]];
      rs.viewingSince = S.n;
      tell(rs.viewing);
    };
    rs.tickers.push(() => {
      if (!rs.viewing) return;
      const gui = S.gui || (S.game && S.game.gui);
      const open = gui && gui.isOpen ? gui.isOpen() : false;
      if (!open && S.n > rs.viewingSince) { const was = rs.viewing; rs.viewing = null; tell(was); }
    });
  }

  /* ------------------------------------------------ rails */
  const isRail = b => !!b && BLOCKS[b].shape === 'rail';
  const HD = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  // a straight rail's line: ew (east-west) and the side it rises towards (-1 if flat), as minecart.js and the mesher work it out
  const railShape = (x, y, z) => {
    const c = HD.map(([dx, dz]) => isRail(S.get(x + dx, y, z + dz)) || isRail(S.get(x + dx, y - 1, z + dz)));
    const up = HD.map(([dx, dz]) => isRail(S.get(x + dx, y + 1, z + dz)));
    const ew = (c[1] || c[3]) && !(c[0] || c[2]);
    for (let k = 0; k < 4; k++) if (up[k] && (ew ? (k & 1) : !(k & 1))) return { ew, asc: k };
    return { ew, asc: -1 };
  };
  rs.railShape = railShape;
  for (const name of ['powered_rail', 'activator_rail']) {
    if (!has(name)) continue;
    const id = B[name];
    // along the rail from (x, y, z) one way, to a rail of the same kind that is powered and has power of its own within 8
    const find = (x, y, z, fwd, count) => {
      if (count >= 8) return false;
      const sh = railShape(x, y, z);
      let nx = x, ny = y, nz = z, below = true;
      if (!sh.ew) {
        if (sh.asc === 0) { if (fwd) nz++; else { nz--; ny++; below = false; } }
        else if (sh.asc === 2) { if (fwd) { nz++; ny++; below = false; } else nz--; }
        else nz += fwd ? 1 : -1;
      } else {
        if (sh.asc === 1) { if (fwd) nx--; else { nx++; ny++; below = false; } }
        else if (sh.asc === 3) { if (fwd) { nx--; ny++; below = false; } else nx++; }
        else nx += fwd ? -1 : 1;
      }
      return same(nx, ny, nz, fwd, count, sh.ew) || (below && same(nx, ny - 1, nz, fwd, count, sh.ew));
    };
    const same = (x, y, z, fwd, count, ew) => {
      if (S.get(x, y, z) !== id) return false;
      const sh = railShape(x, y, z);
      if (sh.ew !== ew) return false;
      if (!(S.meta(x, y, z) & 8)) return false;
      return rs.powered(x, y, z) || find(x, y, z, fwd, count + 1);
    };
    const update = (s, x, y, z, m) => {
      const p = rs.powered(x, y, z) || find(x, y, z, true, 0) || find(x, y, z, false, 0);
      if (p === !!(m & 8)) return;
      s.set(x, y, z, id, m ^ 8);
      rs.around(x, y - 1, z);
      if (railShape(x, y, z).asc >= 0) rs.around(x, y + 1, z);
      rs.go();
    };
    sim.on(id, {
      neighbor(s, x, y, z, m, fx, fy, fz, kind) {
        if (!rs.sturdy(x, y - 1, z, 2)) { s.destroy(x, y, z); return; }
        if (kind !== 2) update(s, x, y, z, m);
      },
      onPlace(s, x, y, z, m) { update(s, x, y, z, m); },
    });
  }
  if (has('detector_rail')) {
    const DR = B.detector_rail;
    WEAK[DR] = (r, x, y, z, m) => (m & 8 ? 15 : 0);
    STRONG[DR] = (r, x, y, z, m, f) => (m & 8 && f === 3 ? 15 : 0);
    SOURCE[DR] = 1;
    const carts = (x, y, z) => {
      const box = [x + 0.2, y, z + 0.2, x + 0.8, y + 0.8, z + 0.8];
      return entityBoxes().some(e => e.k === 'cart' && e.b[0] < box[3] && e.b[3] > box[0] && e.b[1] < box[4] && e.b[4] > box[1] && e.b[2] < box[5] && e.b[5] > box[2]);
    };
    const check = (s, x, y, z, m) => {
      const p = carts(x, y, z), was = !!(m & 8);
      if (p !== was) { s.set(x, y, z, DR, m ^ 8); rs.around(x, y - 1, z); rs.go(); }
      if (p) s.schedule(x, y, z, 20);
    };
    sim.on(DR, {
      tick(s, x, y, z, m) { if (m & 8) check(s, x, y, z, m); },
      neighbor(s, x, y, z) { if (!rs.sturdy(x, y - 1, z, 2)) s.destroy(x, y, z); },
    });
    INSIDE[DR] = (r, x, y, z, m, e) => { if (e.k === 'cart' && !(m & 8)) check(S, x, y, z, m); };
  }
  // carts over a powered activator rail: riders are thrown out and the cart shakes
  if (has('activator_rail')) {
    const AR = B.activator_rail;
    INSIDE[AR] = (r, x, y, z, m, e) => {
      if (e.k !== 'cart' || !(m & 8)) return;
      const c = e.e, E = S.game && S.game.entities;
      if (!c || !E) return;
      if (c.passengers && c.passengers.length) {
        for (const p of c.passengers.slice()) { if (p.isPlayer || p === E.player) E.dismount(); else if (E.unseat) E.unseat(p); }
      }
      if (!c.hurtTime) { c.hurtDir = -(c.hurtDir || 1); c.hurtTime = 10; c.damage = 50; }
    };
  }

  /* ------------------------------------------------ what stands in what
     Each tick every entity is checked against the blocks its box is in, as
     the game's entityInside: plates, detector rails, wooden buttons with
     arrows, and redstone ore that is stepped on (not while sneaking). */
  let boxesAt = -1, boxes = [];
  function entityBoxes() {
    if (boxesAt === S.n) return boxes;
    boxesAt = S.n; boxes = [];
    const g = S.game, P = S.player;
    if (P && g && !(g.survival && g.survival.dead) && g.mode !== 'spectator' && !P.noclip && !(g.entities && g.entities.riding)) {
      const h = P.h || 1.8;
      boxes.push({ k: 'player', living: true, sneak: !!P.sneaking, b: [P.pos.x - 0.3, P.pos.y, P.pos.z - 0.3, P.pos.x + 0.3, P.pos.y + h, P.pos.z + 0.3], e: null });
    }
    const E = g && g.entities;
    if (E && E.list) for (const e of E.list) {
      if (e.removed || (e.dead && e.deathTime > 0)) continue;
      const hw = e.hw !== undefined ? e.hw : (e.w || 0.6) / 2, h = e.h || 1;
      const k = /minecart$/.test(e.type) ? 'cart' : /arrow|trident/.test(e.type) ? 'arrow' : e instanceof Living ? 'mob' : 'other';
      boxes.push({ k, living: e instanceof Living, sneak: false, b: [e.pos.x - hw, e.pos.y, e.pos.z - hw, e.pos.x + hw, e.pos.y + h, e.pos.z + hw], e });
    }
    const D = g && g.drops;
    if (D && D.items) for (const it of D.items) {
      if (it.gone) continue;
      boxes.push({ k: 'item', living: false, sneak: false, b: [it.pos.x - 0.125, it.pos.y, it.pos.z - 0.125, it.pos.x + 0.125, it.pos.y + 0.25, it.pos.z + 0.125], e: it });
    }
    if (S.bodies) for (const e of S.bodies.list) if (!e.dead) boxes.push({ k: 'other', living: false, sneak: false, b: e.box(), e });
    return boxes;
  }
  rs.entityBoxes = entityBoxes;
  rs.tickers.push(() => {
    const list = entityBoxes();
    for (const e of list) {
      const b = e.b;
      for (let y = Math.floor(b[1] + 1e-7); y <= Math.floor(b[4] - 1e-7); y++)
        for (let z = Math.floor(b[2] + 1e-7); z <= Math.floor(b[5] - 1e-7); z++)
          for (let x = Math.floor(b[0] + 1e-7); x <= Math.floor(b[3] - 1e-7); x++) {
            const id = S.get(x, y, z), fn = INSIDE[id];
            if (fn) fn(rs, x, y, z, S.meta(x, y, z), e);
          }
      // stepping on redstone ore lights it
      if (!e.sneak && e.k !== 'item' && e.k !== 'arrow') {
        const ux = Math.floor((b[0] + b[3]) / 2), uy = Math.floor(b[1] - 0.2), uz = Math.floor((b[2] + b[5]) / 2);
        const ub = S.get(ux, uy, uz);
        if ((ub === B.redstone_ore || ub === B.deepslate_redstone_ore) && !(S.meta(ux, uy, uz) & 1) && b[1] - uy - 1 < 0.01) rs.touchOre(ux, uy, uz);
      }
    }
    // hitting redstone ore lights it too
    const it = S.game && S.game.inter, mm = it && it.mining;
    if (mm && (mm.b === B.redstone_ore || mm.b === B.deepslate_redstone_ore)) rs.touchOre(mm.x, mm.y, mm.z);
  });

  /* ------------------------------------------------ the parts looked at every tick (comparators) or 20 (daylight detectors)
     Found when placed, and in the chunks round the player the first time the simulation sees them. */
  const POLL = new Uint8Array(4096);
  for (const n of ['comparator', 'daylight_detector']) if (has(n)) POLL[B[n]] = 1;
  rs.tickers.push(() => {
    const w = S.w, p = S.player.pos, R = S.simDist;
    const pcx = Math.floor(p.x / 16), pcz = Math.floor(p.z / 16);
    let budget = 3;
    for (let dz = -R; dz <= R && budget > 0; dz++) for (let dx = -R; dx <= R && budget > 0; dx++) {
      const c = w.chunkXZ(pcx + dx, pcz + dz);
      if (!c || c.rsScanned) continue;
      c.rsScanned = true; budget--;
      // only up to its highest block: above that is air
      const bl = c.blocks;
      for (let i = 0, n = Math.min(bl.length, ((c.top | 0) + 1) << 8); i < n; i++) if (POLL[bl[i]]) rs.poll(c.cx * 16 + (i & 15), i >> 8, c.cz * 16 + ((i >> 4) & 15), true);
    }
    for (const [k, [x, y, z]] of rs.polled) {
      if (!w.loaded(x, z)) continue;
      const b = w.get(x, y, z), fn = rs.pollers && rs.pollers[b];
      if (!fn) { rs.polled.delete(k); continue; }
      fn(rs, x, y, z, w.meta(x, y, z));
    }
  });

  /* ------------------------------------------------ placing: which way the parts face */
  (sim.placers = sim.placers || []).push((list, hit, id) => {
    const P = S.player, d = BLOCKS[id];
    if (!d || !P) return list;
    const n = d.name;
    const look = nearestLook(P);
    return list.map(e => {
      const [x, y, z] = e;
      if (n === 'repeater' || n === 'comparator') {
        if (!rs.sturdy(x, y - 1, z, 2)) return null;
        return [x, y, z, id, lookFacing(P.yaw)];
      }
      // a piston, dispenser or dropper faces you; an observer looks away from you
      if (n === 'piston' || n === 'sticky_piston' || n === 'dispenser' || n === 'dropper' || n === 'crafter') return [x, y, z, id, OPP6[look]];
      if (n === 'observer') return [x, y, z, id, look];
      // a hopper points into what was clicked, or down
      if (n === 'hopper' && hit && hit.face) {
        const f = hit.face;
        return [x, y, z, id, f[1] !== 0 ? 5 : FACE_F6[[0, 1, 2, 3, 4, 5].find(i => F6[i][0] === -f[0] && F6[i][2] === -f[2])]];
      }
      if (n === 'daylight_detector') return [x, y, z, id, 0];
      // buttons and levers only go on a full face
      if ((/_button$/.test(n) || n === 'lever') && !attachedOk(x, y, z, e[4])) return null;
      if (/_pressure_plate$/.test(n) && !rs.sturdy(x, y - 1, z, 2) && !(BLOCKS[S.get(x, y - 1, z)] || {}).solid) return null;
      return e;
    }).filter(Boolean);
  });

  // a projectile hitting a block (entities/projectiles.js): targets light up
  const onProjectile = (e, x, y, z) => {
    // a burning arrow or a fireball lights TNT, a campfire or a candle it hits (sim/fire.js)
    if ((e.fire > 0 || /fireball$/.test(e.type)) && S.projectileFire) S.projectileFire(x, y, z, e.owner);
    if (S.get(x, y, z) !== B.target || !rs.targetHit) return;
    const p = e.pos, d = [1 - (p.x - x), p.x - x, 1 - (p.y - y), p.y - y, 1 - (p.z - z), p.z - z];
    let f = 0; for (let i = 1; i < 6; i++) if (d[i] < d[f]) f = i;
    rs.targetHit(x, y, z, p.x, p.y, p.z, f, /arrow|trident/.test(e.type));
  };
  rs.tickers.push(() => { const E = S.game && S.game.entities; if (E && E.onProjectileBlock !== onProjectile) E.onProjectileBlock = onProjectile; });

  // a trapped chest opened by the player (hands.js opens the screen; it is told here)
  const H = S.game && S.game.hands;
  if (H && !H.__rsWrapped) {
    const orig = H.useOn.bind(H);
    H.useOn = hit => {
      const r = orig(hit);
      if (r && hit) { const L = window.__lc2, sim2 = L && L.sim; if (sim2 && sim2.redstone && sim2.redstone.openedContainer) sim2.redstone.openedContainer(hit.x, hit.y, hit.z); }
      return r;
    };
    H.__rsWrapped = true;
  }
}
