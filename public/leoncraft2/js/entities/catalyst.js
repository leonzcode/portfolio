/* ---------------------------------------------------------------------------
   Leoncraft 2 - the sculk catalyst blooming (the Minecraft Wiki's Sculk
   Catalyst page), ticked with the spawners (struct/spawners.js).

   A mob you kill within 8 blocks of a sculk catalyst gives its experience to
   the catalyst instead of dropping it: the catalyst blooms (its sound and a
   puff of soul-blue) and that much sculk spreads from where the mob fell,
   over the surfaces of stone, dirt, sand and the like round it (a block for
   each point, nearest first), with now and then a sculk sensor on the new
   sculk when there was charge enough. Our own spreading, after the wiki: the
   game's charge cursors are not copied.
--------------------------------------------------------------------------- */
import { B, BLOCKS } from '../blocks.js?v=107';

const R = Math.random;
const REPLACEABLE = new Uint8Array(4096);
for (const d of BLOCKS) if (d && /^(stone|granite|diorite|andesite|deepslate|tuff|dirt|coarse_dirt|rooted_dirt|grass_block|podzol|mycelium|mud|moss_block|sand|red_sand|gravel|soul_sand|soul_soil|calcite|smooth_basalt|clay|dripstone_block|end_stone|sandstone|red_sandstone|netherrack|basalt|blackstone|crimson_nylium|warped_nylium|sulfur|cinnabar|terracotta|[a-z_]+_terracotta)$/.test(d.name) && !/glazed/.test(d.name)) REPLACEABLE[d.id] = 1;
const lc2 = () => (typeof window !== 'undefined' ? window.__lc2 : null);
const sound = (e, x, y, z) => { const S = typeof window !== 'undefined' && window.__lc2sound && window.__lc2sound.Sound; if (S) try { S.play(e, x + 0.5, y + 0.5, z + 0.5, 2, 1, 'block'); } catch (err) { /* none */ } };

export class Catalysts {
  tick(world, player) {
    const L = lc2(), g = L && L.game, E = g && g.entities;
    if (!E || E.__cat || B.sculk_catalyst === undefined) return;
    E.__cat = true;
    const od = E.onDeath.bind(E), ox = E.dropXp.bind(E);
    E.onDeath = (e, src) => { const r = od(e, src); try { this.died(g.world, E, e); } catch (err) { console.warn('catalyst', err); } return r; };
    // the experience went into the sculk
    E.dropXp = e => (e.sculked ? undefined : ox(e));
  }
  died(world, E, e) {
    if (!e.byPlayer || !world) return;
    const xp = e.xp !== undefined ? e.xp : e.constructor.XP || 0;
    if (!(xp > 0)) return;
    const x = Math.floor(e.pos.x), y = Math.floor(e.pos.y), z = Math.floor(e.pos.z);
    let cat = null, bd = 1e9;
    for (let dy = -8; dy <= 8; dy++) for (let dz = -8; dz <= 8; dz++) for (let dx = -8; dx <= 8; dx++) {
      if (world.get(x + dx, y + dy, z + dz) !== B.sculk_catalyst) continue;
      const d = dx * dx + dy * dy + dz * dz;
      if (d <= 64 && d < bd) { bd = d; cat = [x + dx, y + dy, z + dz]; }
    }
    if (!cat) return;
    e.sculked = true;
    sound('block.sculk_catalyst.bloom', cat[0], cat[1], cat[2]);
    const P = lc2() && lc2().renderer && lc2().renderer.particles;
    if (P && P.spawn) for (let i = 0; i < 12; i++) P.spawn(cat[0] + 0.5 + (R() - 0.5), cat[1] + 1.1, cat[2] + 0.5 + (R() - 0.5), 0, 0.04, 0, { colour: 0x3fd8e8, size: 0.09, life: 18, gravity: 0, physics: false });
    this.spread(world, x, y, z, xp);
  }
  // sculk over the open surfaces round (x, y, z), nearest first, one block a point of charge
  spread(world, x, y, z, charge) {
    const seen = new Set(), open = [[x, y - 1, z]], placed = [];
    const air = (a, b, c) => { const k = world.get(a, b, c); return !k || !BLOCKS[k].solid; };
    while (open.length && placed.length < charge && seen.size < 600) {
      open.sort((a, b) => ((a[0] - x) ** 2 + (a[1] - y) ** 2 + (a[2] - z) ** 2) - ((b[0] - x) ** 2 + (b[1] - y) ** 2 + (b[2] - z) ** 2));
      const [cx, cy, cz] = open.shift(), k = cx + ',' + cy + ',' + cz;
      if (seen.has(k)) continue;
      seen.add(k);
      const b = world.get(cx, cy, cz);
      const surface = air(cx, cy + 1, cz) || air(cx + 1, cy, cz) || air(cx - 1, cy, cz) || air(cx, cy, cz + 1) || air(cx, cy, cz - 1);
      if (b === B.sculk || (REPLACEABLE[b] && surface)) {
        if (b !== B.sculk) { world.set(cx, cy, cz, B.sculk, 0); placed.push([cx, cy, cz]); }
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) open.push([cx + dx, cy + dy, cz + dz]);
      }
    }
    // with charge enough, a sensor grows on top of a new piece now and then
    if (charge >= 5 && B.sculk_sensor !== undefined) for (const [cx, cy, cz] of placed) {
      if (R() < 0.1 && world.get(cx, cy + 1, cz) === 0) { world.set(cx, cy + 1, cz, B.sculk_sensor, 0); break; }
    }
  }
}
