/* ---------------------------------------------------------------------------
   Leoncraft 2 - golems and the wither, built from blocks.

   As the game builds them (the Minecraft Wiki's Iron Golem, Snow Golem,
   Copper Golem and Wither pages), when the last block goes in:

     snow golem    a carved pumpkin (or jack o'lantern) on two snow blocks
     iron golem    a carved pumpkin on a T of four iron blocks, the two
                   spaces either side of its foot empty; the arms run east
                   and west or north and south
     copper golem  a carved pumpkin on a copper block (any age, waxed or
                   not): the golem as old as the block
     wither        three wither skeleton skulls on a T of four soul sand or
                   soul soil, the two spaces either side of its foot empty

   The blocks go (with their breaking pieces) and the mob stands where the
   foot of the build was. An iron golem made this way is the player's and
   never turns on them. summonAt returns the mob, or null when the block
   just put down finished nothing.
--------------------------------------------------------------------------- */
import { B, BLOCKS } from '../blocks.js?v=24';

const name = (w, x, y, z) => { const d = BLOCKS[w.get(x, y, z)]; return d ? d.name : 'air'; };
const PUMPKIN = n => n === 'carved_pumpkin' || n === 'jack_o_lantern';
const SKULL = n => n === 'wither_skeleton_skull' || n === 'wither_skeleton_wall_skull';
const SOUL = n => n === 'soul_sand' || n === 'soul_soil';
const AIR = n => n === 'air' || n === 'cave_air' || n === 'void_air';
const COPPER = { copper_block: 0, exposed_copper: 1, weathered_copper: 2, oxidized_copper: 3 };
const copperStage = n => { const k = n.replace(/^waxed_/, ''); return COPPER[k] !== undefined ? [COPPER[k], n !== k] : null; };

// a T: top row (three across), the middle below it, the foot below that, with empty spaces either side of the foot
function tee(w, x, y, z, dx, dz, top, body) {
  for (let i = -1; i <= 1; i++) {
    if (!top(name(w, x + dx * i, y, z + dz * i), i)) return false;
    if (!body(name(w, x + dx * i, y - 1, z + dz * i))) return false;
  }
  if (!body(name(w, x, y - 2, z))) return false;
  return AIR(name(w, x - dx, y - 2, z - dz)) && AIR(name(w, x + dx, y - 2, z + dz));
}
function clear(w, cells, particles) {
  for (const [x, y, z] of cells) {
    const b = w.get(x, y, z);
    if (!b) continue;
    if (particles) try { particles.blockBreak(x, y, z, b); } catch (e) { /* only pieces */ }
    w.set(x, y, z, 0, 0);
  }
}

/* A block just put down at (x, y, z) (index y): whatever it finished, made. */
export function summonAt(g, x, y, z) {
  const w = g.world, E = g.entities;
  if (!w || !E || !E.spawn) return null;
  const here = name(w, x, y, z);
  const parts = g.renderer && g.renderer.particles;
  if (PUMPKIN(here)) {
    // a snow golem
    if (name(w, x, y - 1, z) === 'snow_block' && name(w, x, y - 2, z) === 'snow_block') {
      clear(w, [[x, y, z], [x, y - 1, z], [x, y - 2, z]], parts);
      return E.spawn('snow_golem', x + 0.5, y - 2, z + 0.5, { natural: false });
    }
    // an iron golem, its arms either way
    for (const [dx, dz] of [[1, 0], [0, 1]]) {
      if (!tee(w, x, y, z, dx, dz, (n, i) => (i === 0 ? PUMPKIN(n) : AIR(n)), n => n === 'iron_block')) continue;
      const cells = [[x, y, z], [x, y - 1, z], [x - dx, y - 1, z - dz], [x + dx, y - 1, z + dz], [x, y - 2, z]];
      clear(w, cells, parts);
      const e = E.spawn('iron_golem', x + 0.5, y - 2, z + 0.5, { natural: false });
      if (e) { e.playerMade = true; e.persistent = true; }
      return e;
    }
    // a copper golem
    const cs = copperStage(name(w, x, y - 1, z));
    if (cs && B.copper_block !== undefined) {
      clear(w, [[x, y, z], [x, y - 1, z]], parts);
      const e = E.spawn('copper_golem', x + 0.5, y - 1, z + 0.5, { natural: false });
      if (e) { e.stage = cs[0]; e.waxed = cs[1]; }
      return e;
    }
    return null;
  }
  if (SKULL(here)) {
    // the wither: this skull any of the three on top, the T either way
    for (const [dx, dz] of [[1, 0], [0, 1]]) for (let k = -1; k <= 1; k++) {
      const cx = x - dx * k, cz = z - dz * k;
      if (!tee(w, cx, y, cz, dx, dz, n => SKULL(n), SOUL)) continue;
      const cells = [];
      for (let i = -1; i <= 1; i++) { cells.push([cx + dx * i, y, cz + dz * i]); cells.push([cx + dx * i, y - 1, cz + dz * i]); }
      cells.push([cx, y - 2, cz]);
      clear(w, cells, parts);
      return E.spawn('wither', cx + 0.5, y - 2, cz + 0.5, { natural: false });
    }
  }
  return null;
}
