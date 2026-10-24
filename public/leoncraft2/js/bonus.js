/* ---------------------------------------------------------------------------
   Leoncraft 2 - the Bonus Chest (Create World, World tab), as the game puts
   it down: in a new world, on the surface a few blocks from where you
   start, a chest of the spawn_bonus_chest loot table (some planks or logs,
   wooden and stone tools, apples, bread, salmon) with a torch on each side.
--------------------------------------------------------------------------- */
import { B, BLOCKS } from './blocks.js?v=107';

const R = Math.random;
// the top of a column, if a chest can stand on it (a full solid block, no fluid, room above)
function topOf(world, x, z) {
  for (let y = 383; y > 0; y--) {
    const b = world.get(x, y, z);
    if (!b) continue;
    const d = BLOCKS[b];
    if (d.fluid || d.waterlogged || d.leaves || d.log) return -1;
    return d.solid && d.shape === 'cube' ? y + 1 : -1;
  }
  return -1;
}
export async function bonusChest(g, sx, sz) {
  const w = g.world, C = g.containers;
  if (!w || !C || B.chest === undefined) return false;
  // a few tries round the spawn, as the game's BonusChestFeature does
  for (let k = 0; k < 40; k++) {
    const x = sx + Math.floor(R() * 13) - 6, z = sz + Math.floor(R() * 13) - 6;
    if (Math.abs(x - sx) < 2 && Math.abs(z - sz) < 2) continue;
    const y = topOf(w, x, z);
    if (y < 0 || w.get(x, y, z) || w.get(x, y + 1, z)) continue;
    w.set(x, y, z, B.chest, 2);
    const [L, Cn] = await Promise.all([import('./struct/loot.js?v=107'), import('./containers.js?v=107')]);
    const box = C.at(x, y, z);
    if (box) {
      const stacks = L.rollLoot('spawn_bonus_chest', (R() * 2147483647) | 0, { size: box.slots.length });
      if (Array.isArray(stacks)) for (const e of stacks) if (e && e.slot < box.slots.length) box.slots[e.slot] = Cn.lootStack(e) || null;
      if (C.changed) C.changed(box);
    }
    // a torch on each side of it where there is ground
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const tx = x + dx, tz = z + dz;
      if (!w.get(tx, y, tz) && BLOCKS[w.get(tx, y - 1, tz)] && BLOCKS[w.get(tx, y - 1, tz)].solid && B.torch !== undefined) w.set(tx, y, tz, B.torch, 0);
    }
    return true;
  }
  return false;
}
