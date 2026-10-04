/* ---------------------------------------------------------------------------
   Leoncraft 2 - explosions (a minimal version; the world-simulation work
   brings the full one with the same call).

     explode(world, x, y, z, power, { fire, source, targets, fluids, onBlock })

   As the Minecraft Wiki's Explosion article describes it: rays go out from
   the centre towards the 1352 points on the surface of a 16 x 16 x 16 cube,
   each starting with an intensity of power x (0.7 to 1.3), stepping 0.3
   blocks and losing 0.225 a step plus (blast resistance + 0.3) x 0.3 for each
   block it passes; a block a ray still has intensity left in is destroyed.
   Things nearby are hurt by (impact^2 + impact) / 2 x 7 x 2 x power + 1,
   impact being (1 - distance / (2 x power)) times how much of them can see
   the centre, and pushed away by the impact. With fire, a third of the air
   cells left over solid ground catch fire.

   targets: [{ box: [x0, y0, z0, x1, y1, z1], hurt(damage, source), push(x, y, z) }]
   Coordinates are the engine's (index y). Returns the destroyed cells.
--------------------------------------------------------------------------- */
import { B, BLOCKS, FLUID } from './blocks.js?v=8';

// blast resistance by name; anything else: four times its hardness
const RESIST = {
  obsidian: 1200, crying_obsidian: 1200, bedrock: 3600000, end_portal_frame: 3600000, end_portal: 3600000, end_gateway: 3600000,
  nether_portal: 0, respawn_anchor: 1200, ancient_debris: 1200, netherite_block: 1200, enchanting_table: 1200, ender_chest: 600,
  anvil: 1200, end_stone: 9, end_stone_bricks: 9, iron_bars: 6, water: 100, lava: 100, dragon_egg: 9, glass: 0.3,
  netherrack: 0.4, soul_sand: 0.5, soul_soil: 0.5, glowstone: 0.3, chorus_plant: 0.4, chorus_flower: 0.4, purpur_block: 6,
};
export function resistance(b) {
  const d = BLOCKS[b];
  if (!d || !b) return 0;
  if (RESIST[d.name] !== undefined) return RESIST[d.name];
  if (d.hardness === undefined) return 1;
  return d.hardness < 0 ? 3600000 : d.hardness * 4;
}

export function explode(world, x, y, z, power, opts) {
  opts = opts || {};
  const hit = new Set(), list = [];
  for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) for (let k = 0; k < 16; k++) {
    if (i !== 0 && i !== 15 && j !== 0 && j !== 15 && k !== 0 && k !== 15) continue;
    let dx = i / 15 * 2 - 1, dy = j / 15 * 2 - 1, dz = k / 15 * 2 - 1;
    const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
    let f = power * (0.7 + Math.random() * 0.6);
    let px = x, py = y, pz = z;
    while (f > 0) {
      const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz);
      const b = world.get(bx, by, bz);
      if (b || FLUID[b]) f -= (resistance(b) + 0.3) * 0.3;
      if (f > 0 && b && !FLUID[b]) {
        const key = bx + ',' + by + ',' + bz;
        if (!hit.has(key)) { hit.add(key); list.push([bx, by, bz, b]); }
      }
      px += dx * 0.3; py += dy * 0.3; pz += dz * 0.3;
      f -= 0.22500001;
    }
  }
  for (const [bx, by, bz, b] of list) {
    world.set(bx, by, bz, 0, 0);
    if (opts.onBlock) opts.onBlock(bx, by, bz, b);
    if (opts.fluids) opts.fluids.around(bx, by, bz);
  }
  if (opts.fire && B.fire !== undefined) {
    for (const [bx, by, bz] of list) {
      if (Math.random() * 3 >= 1) continue;
      const below = world.get(bx, by - 1, bz);
      if (world.get(bx, by, bz) === 0 && below && BLOCKS[below].solid) world.set(bx, by, bz, B.fire, 0);
    }
  }
  // the things in range
  const reach = power * 2;
  for (const t of opts.targets || []) {
    const bx = t.box;
    const cx = (bx[0] + bx[3]) / 2, cy = bx[1], cz = (bx[2] + bx[5]) / 2;
    const dist = Math.hypot(cx - x, cy - y, cz - z) / reach;
    if (dist > 1) continue;
    const seen = exposure(world, x, y, z, bx);
    const impact = (1 - dist) * seen;
    const dmg = Math.floor((impact * impact + impact) / 2 * 7 * reach + 1);
    if (t.hurt && impact > 0) t.hurt(dmg, opts.source || 'explosion');
    if (t.push && impact > 0) {
      let ex = cx - x, ey = (bx[1] + bx[4]) / 2 - y, ez = cz - z;
      const l = Math.hypot(ex, ey, ez) || 1;
      t.push(ex / l * impact, ey / l * impact, ez / l * impact);
    }
  }
  return list;
}

// how much of a box can see a point: a few rays, each blocked by any solid cube
export function exposure(world, x, y, z, b) {
  let seen = 0, n = 0;
  for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) for (let k = 0; k <= 2; k++) {
    const px = b[0] + (b[3] - b[0]) * i / 2, py = b[1] + (b[4] - b[1]) * j / 2, pz = b[2] + (b[5] - b[2]) * k / 2;
    n++;
    const dx = x - px, dy = y - py, dz = z - pz, len = Math.hypot(dx, dy, dz);
    const steps = Math.ceil(len / 0.4);
    let clear = true;
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const blk = world.get(Math.floor(px + dx * t), Math.floor(py + dy * t), Math.floor(pz + dz * t));
      if (blk && BLOCKS[blk].solid && BLOCKS[blk].shape === 'cube') { clear = false; break; }
    }
    if (clear) seen++;
  }
  return seen / n;
}
