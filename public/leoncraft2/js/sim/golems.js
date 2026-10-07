/* ---------------------------------------------------------------------------
   Leoncraft 2 - mobs built from blocks (the game's carved pumpkin and wither
   skull patterns, as the Minecraft Wiki draws them): the last block put on
   makes the mob, the blocks go.

     snow golem    a carved pumpkin (or jack o'lantern) on two snow blocks
     iron golem    a carved pumpkin on a T of four iron blocks, the arms
                   along x or z, air in the corners round the head and the
                   foot; it is yours (it never turns on you)
     copper golem  a carved pumpkin on a block of copper (any weathering,
                   waxed or not): the golem as weathered as the block, which
                   becomes a copper chest of its weathering
     the wither    three wither skeleton skulls on a T of soul sand or soul
                   soil (three across, one under the middle), air in the
                   bottom corners; not in Peaceful. It comes in charging,
                   unhurt for 11 seconds while its health fills, then blows
                   up round itself and goes to work.
--------------------------------------------------------------------------- */
import { B, BLOCKS } from '../blocks.js?v=24';

const has = n => B[n] !== undefined;
const isName = (b, re) => !!(b && BLOCKS[b] && re.test(BLOCKS[b].name));
const AXES = [[1, 0], [0, 1]];

export function installGolems(sim) {
  const S = sim, get = (x, y, z) => S.get(x, y, z);
  const air = (x, y, z) => { const b = get(x, y, z); return !b || (BLOCKS[b] && !BLOCKS[b].solid && BLOCKS[b].replaceable); };
  const clear = cells => {
    for (const [x, y, z] of cells) {
      const b = get(x, y, z);
      if (S.renderer && S.renderer.particles && S.renderer.particles.blockBreak) try { S.renderer.particles.blockBreak(x, y, z, b); } catch (e) { /* no pieces */ }
      S.set(x, y, z, 0, 0);
    }
  };
  const E = () => S.game && S.game.entities;
  const spawn = (type, x, y, z, o) => { const M = E(); return M ? M.spawn(type, x + 0.5, y, z + 0.5, Object.assign({ natural: false }, o || {})) : null; };

  // a carved pumpkin or jack o'lantern put on
  const pumpkin = {
    onPlace(s, x, y, z) {
      const below = get(x, y - 1, z), below2 = get(x, y - 2, z);
      // snow golem
      if (below === B.snow_block && below2 === B.snow_block) {
        clear([[x, y, z], [x, y - 1, z], [x, y - 2, z]]);
        spawn('snow_golem', x, y - 2, z);
        return;
      }
      // iron golem
      if (below === B.iron_block && below2 === B.iron_block) {
        for (const [ax, az] of AXES) {
          if (get(x + ax, y - 1, z + az) !== B.iron_block || get(x - ax, y - 1, z - az) !== B.iron_block) continue;
          if (!air(x + ax, y, z + az) || !air(x - ax, y, z - az) || !air(x + ax, y - 2, z + az) || !air(x - ax, y - 2, z - az)) continue;
          clear([[x, y, z], [x, y - 1, z], [x, y - 2, z], [x + ax, y - 1, z + az], [x - ax, y - 1, z - az]]);
          const e = spawn('iron_golem', x, y - 2, z);
          if (e) { e.playerMade = true; e.persistent = true; }
          return;
        }
      }
      // copper golem: the copper block becomes a copper chest as weathered as it
      if (isName(below, /^(waxed_)?(exposed_|weathered_|oxidized_)?copper(_block)?$/) && !isName(below, /^copper$/) ) {
        const n = BLOCKS[below].name, waxed = /^waxed_/.test(n), stage = /oxidized/.test(n) ? 3 : /weathered/.test(n) ? 2 : /exposed/.test(n) ? 1 : 0;
        const chest = (waxed ? 'waxed_' : '') + ['', 'exposed_', 'weathered_', 'oxidized_'][stage] + 'copper_chest';
        clear([[x, y, z]]);
        if (has(chest)) S.set(x, y - 1, z, B[chest], 2); else S.set(x, y - 1, z, 0, 0);
        const e = spawn('copper_golem', x, y, z);
        if (e) { e.stage = stage; e.waxed = waxed; e.persistent = true; }
      }
    },
  };
  for (const n of ['carved_pumpkin', 'jack_o_lantern']) if (has(n)) sim.on(n, pumpkin);

  // a wither skeleton skull put on: three on a T of soul sand or soul soil
  const SOUL = id => id === B.soul_sand || id === B.soul_soil;
  const SKULL = id => id === B.wither_skeleton_skull || id === B.wither_skeleton_wall_skull;
  const skull = {
    onPlace(s, x, y, z) {
      const M = E();
      if (!M || M.difficulty === 'peaceful') return;
      for (const [ax, az] of AXES) for (const k of [-1, 0, 1]) {
        // (x, y, z) is the skull k along the row from the middle
        const cx = x - ax * k, cz = z - az * k;
        let ok = true;
        for (const i of [-1, 0, 1]) {
          if (!SKULL(get(cx + ax * i, y, cz + az * i)) || !SOUL(get(cx + ax * i, y - 1, cz + az * i))) { ok = false; break; }
        }
        if (!ok || !SOUL(get(cx, y - 2, cz)) || !air(cx + ax, y - 2, cz + az) || !air(cx - ax, y - 2, cz - az)) continue;
        const cells = [];
        for (const i of [-1, 0, 1]) cells.push([cx + ax * i, y, cz + az * i], [cx + ax * i, y - 1, cz + az * i]);
        cells.push([cx, y - 2, cz]);
        clear(cells);
        const e = spawn('wither', cx, y - 2, cz);
        if (e) { e.summonT = 220; e.health = Math.max(1, Math.floor(e.maxHealth / 3)); }
        if (S.onSound) S.onSound('entity.wither.spawn', cx, y - 1, cz, 1, 1);
        return;
      }
    },
  };
  for (const n of ['wither_skeleton_skull', 'wither_skeleton_wall_skull']) if (has(n)) sim.on(n, skull);
}
