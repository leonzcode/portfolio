/* ---------------------------------------------------------------------------
   Leoncraft 2 - where a new world starts you.

   Somewhere good to start: dry land in a green biome, with water in sight,
   looked for in rings round 0, 0. Kept here so both the main thread (main.js,
   asking the workers) and a worker on its own (world.js practise, while the
   Create New World screen is open) run the very same search and find the
   very same place.

   ask({ type: 'surface', x, z, withBiome }) answers { y, biome } as a worker
   does: the ground's height at the column and, when asked, its biome (the
   vanilla generator's biome number, or the first generator's climate).
--------------------------------------------------------------------------- */
import { SEA } from './world-const.js?v=107';
import { BIOMES } from './biomes.js?v=107';
import { pickBiome } from './worldgen.js?v=107';

const GOOD = ['plains', 'forest', 'birch_forest', 'flower_forest', 'meadow', 'cherry_grove', 'sunflower_plains', 'taiga', 'dark_forest', 'old_growth_birch_forest', 'savanna', 'jungle', 'sparse_jungle'];
export async function searchSpawn(ask) {
  for (let ring = 0; ring < 40; ring++) {
    const tries = [];
    for (let k = 0; k < Math.max(1, ring * 6); k++) {
      const a = k / Math.max(1, ring * 6) * Math.PI * 2;
      tries.push([Math.round(Math.cos(a) * ring * 56), Math.round(Math.sin(a) * ring * 56)]);
    }
    const res = await Promise.all(tries.map(([x, z]) => ask({ type: 'surface', x, z, withBiome: true })));
    for (let i = 0; i < tries.length; i++) {
      const r = res[i];
      if (r.spawn) return r.spawn;
      if (r.y < SEA + 1 || r.y > SEA + 30) continue;
      // the vanilla generator answers with the biome itself, the first one with its climate
      const bid = typeof r.biome === 'number' ? r.biome : pickBiome(r.biome);
      if (GOOD.indexOf(BIOMES[bid].name) < 0) continue;
      const [x, z] = tries[i];
      const near = await Promise.all([[28, 0], [-28, 0], [0, 28], [0, -28], [20, 20], [-20, -20]].map(([dx, dz]) => ask({ type: 'surface', x: x + dx, z: z + dz })));
      if (near.some(n => n.y >= 0 && n.y < SEA) || ring > 25) return { x, z };
    }
  }
  return { x: 0, z: 0 };
}
