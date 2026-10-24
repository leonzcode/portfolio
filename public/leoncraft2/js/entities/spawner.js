/* ---------------------------------------------------------------------------
   Leoncraft 2 - where mobs come from, by the Minecraft Wiki's spawning rules
   (Java Edition, 1.18 and later).

   Every tick, each chunk within 8 chunks of the player (and the simulation
   distance, which is the render distance here) gets one try per mob
   category that is under its cap. The caps are per 17 x 17 chunks and
   scale with how many chunks are in range:
     monster 70, creature 10 (tried only every 400 ticks), ambient 15,
     water creature 5, water ambient 20, underground water creature 5.
   Mobs that must stay (named, tamed, on a lead, from a structure) do not
   count towards a cap.

   A try picks a column in the chunk and a height between the bottom of the
   dimension and the top block there; a solid block there ends it. Then up
   to three packs, each starting from that spot: it walks by -5..+5 across
   (a random 1 to 4 steps until a mob is chosen, then as many steps as the
   group's size), and at each step, if the spot is more than 24 blocks from
   the player and from the world spawn (and within 128), a mob of a kind
   chosen by the biome's (or the structure's) weights may appear there if
   its spawn rules allow; four in a chunk at most.

   Each dimension has its own lists. The Overworld's are by biome; the
   Nether's are by its five biomes, with the fortress's own list inside a
   fortress; the End has endermen only. Light, the game's way:
     Overworld  monsters need block light 0, sky light below a random 0..31
                and the light sky and blocks give together at or below a
                random 0..7
     Nether     no sky; the light at or below 7 for the monsters that care
                (endermen, skeletons, wither skeletons), and every monster
                in the dark enough that it would walk there (light 11 or
                less, from the Nether's ambient light)
     End        no sky light; block light 0
   Animals need their ground (grass for most) and raw light above 8. Passive
   animals mostly come with the world: the first time an Overworld chunk is
   seen there is a 10% chance (7% in the snow) of a group of the biome's
   animals in it. A structure's own mobs (villagers, shulkers, guardians...)
   come with it too, once, the first time its chunk is seen.
--------------------------------------------------------------------------- */
import { TYPES } from './mobs.js?v=107';
import { BIOMES } from '../biomes.js?v=107';
import { B, BLOCKS, SOLID, FLUID, OPAQUE } from '../blocks.js?v=107';
import { SEA, Y0 } from '../world-const.js?v=107';
import { DIMS } from '../dims.js?v=107';
import { I } from '../items.js?v=107';

const R = () => Math.random();
const RI = n => Math.floor(Math.random() * n);
export const CAPS = { monster: 70, creature: 10, ambient: 15, water_creature: 5, water_ambient: 20, underground_water_creature: 5, axolotls: 5 };
// how far off a mob of each category goes at once (water ambient 64, the rest 128); beyond 32 it may go at random
export const DESPAWN = { monster: 128, creature: 128, ambient: 128, water_creature: 128, water_ambient: 64, underground_water_creature: 128, axolotls: 128, misc: 128 };

// spawn lists: [type, weight, min, max]
const MONSTERS = [['spider', 100, 4, 4], ['zombie', 95, 4, 4], ['zombie_villager', 5, 1, 1], ['skeleton', 100, 4, 4], ['creeper', 100, 4, 4], ['slime', 100, 4, 4], ['enderman', 10, 1, 4], ['witch', 5, 1, 1]];
const DESERT_M = [['spider', 100, 4, 4], ['zombie', 19, 4, 4], ['zombie_villager', 1, 1, 1], ['husk', 80, 4, 4], ['skeleton', 100, 4, 4], ['creeper', 100, 4, 4], ['slime', 100, 4, 4], ['enderman', 10, 1, 4], ['witch', 5, 1, 1]];
const SNOWY_M = [['spider', 100, 4, 4], ['zombie', 95, 4, 4], ['zombie_villager', 5, 1, 1], ['skeleton', 20, 4, 4], ['stray', 80, 4, 4], ['creeper', 100, 4, 4], ['slime', 100, 4, 4], ['enderman', 10, 1, 4], ['witch', 5, 1, 1]];
const SWAMP_M = [['spider', 100, 4, 4], ['zombie', 95, 4, 4], ['zombie_villager', 5, 1, 1], ['skeleton', 70, 4, 4], ['bogged', 50, 4, 4], ['creeper', 100, 4, 4], ['slime', 100, 4, 4], ['enderman', 10, 1, 4], ['witch', 5, 1, 1]];
const OCEAN_M = MONSTERS.concat([['drowned', 5, 1, 1]]);
const RIVER_M = MONSTERS.concat([['drowned', 100, 1, 1]]);
const FARM = [['sheep', 12, 4, 4], ['pig', 10, 4, 4], ['chicken', 10, 4, 4], ['cow', 8, 4, 4]];
const SNOWY = new Set(['snowy_plains', 'ice_spikes', 'snowy_taiga', 'frozen_river', 'snowy_beach', 'grove', 'snowy_slopes', 'frozen_peaks', 'jagged_peaks', 'frozen_ocean', 'deep_frozen_ocean']);
function monstersOf(b) {
  if (b === 'mushroom_fields' || b === 'deep_dark') return [];
  if (b === 'desert') return DESERT_M;
  if (b === 'swamp' || b === 'mangrove_swamp') return SWAMP_M;
  if (SNOWY.has(b) && !/ocean|river/.test(b)) return SNOWY_M;
  if (/river/.test(b)) return RIVER_M;
  if (/ocean/.test(b)) return OCEAN_M;
  return MONSTERS;
}
function creaturesOf(b) {
  switch (b) {
    case 'plains': case 'sunflower_plains': return FARM.concat([['horse', 5, 2, 6], ['donkey', 1, 1, 3]]);
    case 'forest': case 'flower_forest': case 'birch_forest': case 'old_growth_birch_forest': case 'windswept_forest':
      return FARM.concat(b === 'forest' ? [['wolf', 5, 4, 4]] : b === 'flower_forest' ? [['rabbit', 4, 2, 3]] : []);
    case 'dark_forest': return FARM;
    case 'taiga': case 'old_growth_pine_taiga': case 'old_growth_spruce_taiga': return FARM.concat([['wolf', 8, 4, 4], ['rabbit', 4, 2, 3], ['fox', 8, 2, 4]]);
    case 'snowy_taiga': return FARM.concat([['wolf', 8, 4, 4], ['rabbit', 4, 2, 3], ['fox', 8, 2, 4]]);
    case 'snowy_plains': case 'ice_spikes': return [['rabbit', 10, 2, 3], ['polar_bear', 1, 1, 2]];
    case 'desert': return [['rabbit', 4, 2, 3]];
    case 'savanna': case 'savanna_plateau': case 'windswept_savanna': return FARM.concat([['horse', 1, 2, 6], ['donkey', 1, 1, 1]]).concat(b === 'savanna_plateau' ? [['llama', 8, 4, 4]] : []);
    case 'swamp': case 'mangrove_swamp': return FARM.concat([['frog', 10, 2, 5]]);
    case 'meadow': return [['donkey', 1, 1, 2], ['rabbit', 2, 2, 6], ['sheep', 2, 2, 4]];
    case 'cherry_grove': return [['pig', 1, 1, 2], ['rabbit', 2, 2, 6], ['sheep', 2, 2, 4]];
    case 'grove': return [['wolf', 1, 1, 1], ['rabbit', 8, 2, 3], ['fox', 4, 2, 4]];
    case 'snowy_slopes': case 'frozen_peaks': case 'jagged_peaks': return [['goat', 5, 1, 3], ['rabbit', 4, 2, 3]];
    case 'windswept_hills': case 'windswept_gravelly_hills': return FARM.concat([['llama', 5, 4, 6]]);
    case 'jungle': case 'sparse_jungle': case 'bamboo_jungle': return FARM.concat([['chicken', 10, 4, 4], ['parrot', 40, 1, 2], ['ocelot', 2, 1, 3]]);
    case 'mushroom_fields': return [['mooshroom', 8, 4, 8]];
    case 'beach': return [['turtle', 5, 2, 5]];
    case 'river': case 'ocean': case 'deep_ocean': return [];
    default: return /ocean|river|beach|shore|peaks|badlands/.test(b) ? [] : FARM;
  }
}
const WATER_CREATURES = {
  river: [['squid', 2, 1, 4]], frozen_river: [['squid', 2, 1, 4]],
  ocean: [['squid', 1, 1, 4], ['dolphin', 1, 1, 2], ['nautilus', 5, 1, 1]], deep_ocean: [['squid', 1, 1, 4], ['dolphin', 1, 1, 2], ['nautilus', 5, 1, 1]],
  warm_ocean: [['nautilus', 5, 1, 1], ['squid', 10, 4, 4], ['dolphin', 2, 1, 2]],
  lukewarm_ocean: [['squid', 10, 1, 2], ['dolphin', 2, 1, 2], ['nautilus', 5, 1, 1]], deep_lukewarm_ocean: [['squid', 8, 1, 4], ['dolphin', 2, 1, 2], ['nautilus', 5, 1, 1]],
  cold_ocean: [['squid', 3, 1, 4], ['nautilus', 2, 1, 1]], deep_cold_ocean: [['squid', 3, 1, 4], ['nautilus', 2, 1, 1]],
  frozen_ocean: [['squid', 1, 1, 4], ['nautilus', 2, 1, 1]], deep_frozen_ocean: [['squid', 1, 1, 4], ['nautilus', 2, 1, 1]],
};
function waterOf(b) { return WATER_CREATURES[b] || []; }
function fishOf(b) {
  if (/river/.test(b)) return [['salmon', 5, 1, 5]];
  if (/warm_ocean|lukewarm/.test(b)) return [['tropical_fish', 25, 8, 8], ['pufferfish', 15, 1, 3], ['cod', /lukewarm/.test(b) ? 15 : 0, 3, 6]];
  if (/cold|frozen/.test(b)) return [['cod', 15, 3, 6], ['salmon', 15, 1, 5]];
  if (/ocean/.test(b)) return [['cod', 10, 3, 6]];
  return [];
}

/* ---- the Nether, by biome (the wiki's tables) ---- */
const NETHER = {
  nether_wastes: { monster: [['ghast', 50, 4, 4], ['zombified_piglin', 100, 4, 4], ['magma_cube', 2, 4, 4], ['enderman', 1, 4, 4], ['piglin', 15, 4, 4]], creature: [['strider', 60, 2, 4]] },
  soul_sand_valley: { monster: [['skeleton', 20, 4, 4], ['ghast', 50, 4, 4], ['enderman', 1, 1, 4]], creature: [['strider', 60, 2, 4]] },
  crimson_forest: { monster: [['zombified_piglin', 1, 2, 4], ['hoglin', 9, 3, 4], ['piglin', 5, 3, 4]], creature: [['strider', 60, 2, 4]] },
  warped_forest: { monster: [['enderman', 1, 1, 4]], creature: [['strider', 60, 2, 4]] },
  basalt_deltas: { monster: [['ghast', 40, 1, 1], ['magma_cube', 100, 2, 5]], creature: [['strider', 60, 2, 4]] },
};
/* Spawn costs (the game's spawn_costs): a mob of a kind with a cost can
   only appear where the "charge" of its kind already about, divided by the
   distance to each, times its own charge, stays within the budget. */
const COSTS = {
  soul_sand_valley: { skeleton: [0.7, 0.15], ghast: [0.7, 0.15], enderman: [0.7, 0.15], strider: [0.7, 0.15] },
  warped_forest: { enderman: [1, 0.12] },
};
const END = [['enderman', 10, 4, 4]];
/* Structures with lists of their own, used inside them in place of the
   biome's (the game's spawn_overrides). */
const STRUCT = {
  fortress: { monster: [['blaze', 10, 2, 3], ['zombified_piglin', 5, 4, 4], ['wither_skeleton', 8, 5, 5], ['skeleton', 2, 5, 5], ['magma_cube', 3, 4, 4]] },
  swamp_hut: { monster: [['witch', 1, 1, 1]], creature: [['cat', 1, 1, 1]] },
  monument: { monster: [['guardian', 1, 2, 4]], underground_water_creature: [], axolotls: [] },
  pillager_outpost: { monster: [['pillager', 1, 1, 1]] },
};
const NETHER_BRICKS = new Set(['nether_bricks', 'red_nether_bricks', 'cracked_nether_bricks', 'chiseled_nether_bricks', 'nether_brick_stairs', 'nether_brick_fence']);

const pick = list => {
  const ok = list.filter(e => TYPES[e[0]] && e[1] > 0);
  let tot = 0; for (const e of ok) tot += e[1];
  if (!tot) return null;
  let r = RI(tot);
  for (const e of ok) { if (r < e[1]) return e; r -= e[1]; }
  return null;
};

export class Spawner {
  constructor(m) { this.m = m; this.counts = {}; this.charges = []; }
  get dim() { return this.m.world.dim || 'overworld'; }
  biome(x, z) { const b = BIOMES[this.m.world.biomeAt(x, z)]; return b ? b.name : this.dim === 'the_nether' ? 'nether_wastes' : this.dim === 'the_end' ? 'the_end' : 'plains'; }
  // the structures that reach the chunk a block is in (as the generator left them)
  structuresAt(x, z) {
    const c = this.m.world.chunks.get(Math.floor(x / 16) + ',' + Math.floor(z / 16));
    return c && c.structs && c.structs.structures ? c.structs.structures : null;
  }
  /* Is (x, y, z) inside a structure with its own list? The bounding boxes
     stay in the workers, so this goes by what is known on this side: the
     chunk is one a structure reaches, and the ground is the structure's
     (a fortress's nether bricks, the hut's spruce floor); a monument or
     an outpost counts for the whole of the chunks it reaches. */
  structureAt(x, y, z) {
    const list = this.structuresAt(x, z);
    if (!list) return null;
    const T = this.m.t;
    for (const s of list) {
      if (!STRUCT[s.type]) continue;
      if (s.type === 'fortress') {
        for (let d = 1; d <= 2; d++) { const b = BLOCKS[T.get(x, y - d, z)]; if (b && NETHER_BRICKS.has(b.name)) return s.type; if (b && b.solid) break; }
        continue;
      }
      if (s.type === 'swamp_hut') { const b = BLOCKS[T.get(x, y - 1, z)]; if (b && b.name === 'spruce_planks') return s.type; continue; }
      if (s.type === 'monument') { if (y + Y0 >= 38 && y + Y0 <= 62) return s.type; continue; }
      return s.type;
    }
    return null;
  }

  /* ---- the rules ---- */
  // can something stand here: a full-topped block under it, room for its box, not in a fluid
  onGround(C, x, y, z) {
    const T = this.m.t, below = T.get(x, y - 1, z);
    if (!below || !SOLID[below] || FLUID[below]) return false;
    const d = BLOCKS[below];
    if (d.shape !== 'cube' || below === B.bedrock || below === B.barrier || d.leaves || d.pass === 'translucent' || /glass|ice$/.test(d.name)) return false;
    for (let i = 0; i < Math.ceil(C.H || 1.8); i++) {
      const b = T.get(x, y + i, z);
      if (b && (SOLID[b] || FLUID[b])) return false;
      if (b && BLOCKS[b].name === 'powder_snow') return false;
    }
    const hw = (C.W || 0.6) / 2;
    return !T.boxHits(x + 0.5 - hw, y, z + 0.5 - hw, x + 0.5 + hw, y + (C.H || 1.8), z + 0.5 + hw);
  }
  inWater(C, x, y, z) {
    const T = this.m.t;
    return FLUID[T.get(x, y, z)] === 1 && FLUID[T.get(x, y - 1, z)] === 1 && !SOLID[T.get(x, y + 1, z)];
  }
  // the sky light the rules see: none in the Nether and the End (neither has sky light in the game)
  sky(x, y, z) { return this.dim === 'overworld' ? this.m.t.sky(x, y, z) : 0; }
  // the light with the time of day left out (animals' "bright enough": above 8)
  rawLight(x, y, z) { return Math.max(this.sky(x, y, z), this.m.t.block(x, y, z)); }
  brightEnough(x, y, z) { return this.rawLight(x, y, z) > 8; }
  // the darkness monsters need (the game's isDarkEnoughToSpawn, by dimension)
  darkEnough(x, y, z) {
    const T = this.m.t, dim = this.dim;
    const sky = this.sky(x, y, z);
    if (sky > RI(32)) return false;
    const bl = T.block(x, y, z);
    if (bl > (dim === 'the_nether' ? 15 : 0)) return false;
    // a thunderstorm darkens the sky as much as night
    const dark = this.m.thundering() ? Math.max(10, this.m.skyDarken()) : this.m.skyDarken();
    const raw = Math.max(sky - dark, bl);
    return raw <= (dim === 'the_nether' ? 7 : RI(8));
  }
  // a monster spawns only where it would walk (0.5 - brightness >= 0): light 11 or less in the Nether
  walkOk(x, y, z) { return this.m.brightness(x, y, z) <= 0.5; }
  monsterRules(C, x, y, z) { return this.m.difficulty !== 'peaceful' && this.darkEnough(x, y, z) && this.onGround(C, x, y, z) && this.walkOk(x, y, z); }
  rules(C, type, x, y, z, cat) {
    const m = this.m, T = m.t;
    if (C.checkSpawn) return C.checkSpawn(this, x, y, z);
    if (cat === 'monster') return this.monsterRules(C, x, y, z);
    if (cat === 'creature') {
      const below = T.get(x, y - 1, z), on = C.SPAWN_ON;
      const ground = on ? on.some(n => B[n] === below) : below === B.grass_block;
      return ground && this.brightEnough(x, y, z) && this.onGround(C, x, y, z);
    }
    return false;
  }
  // no closer than 24 to the world spawn (the game checks this in every dimension)
  nearWorldSpawn(x, y, z) {
    const s = this.m.hooks.spawnPoint ? this.m.hooks.spawnPoint() : null;
    if (!s || this.dim !== 'overworld') return false;
    if (Math.abs(x - s.x) > 24 || Math.abs(z - s.z) > 24) return false;
    // the spawn point stands on the ground there
    const g = this.m.t.motionTop(Math.floor(s.x), Math.floor(s.z));
    const sy = s.y !== undefined ? s.y : g > 0 ? g : y;
    return (x + 0.5 - s.x - 0.5) ** 2 + (y - sy) ** 2 + (z + 0.5 - s.z - 0.5) ** 2 < 576;
  }

  /* ---- spawn costs ---- */
  costOf(type, x, z) { const c = COSTS[this.biome(x, z)]; return c ? c[type] || null : null; }
  // the charges of everything about, gathered once a tick
  gatherCharges() {
    const out = this.charges; out.length = 0;
    if (this.dim !== 'the_nether') return;
    for (const e of this.m.list) {
      if (e.removed || e.dead || e.persistent || !e.constructor.CATEGORY) continue;
      const c = this.costOf(e.type, Math.floor(e.pos.x), Math.floor(e.pos.z));
      if (c) out.push(e.pos.x, e.pos.y, e.pos.z, c[0]);
    }
  }
  costOk(type, x, y, z) {
    const c = this.costOf(type, x, z);
    if (!c) return true;
    const q = this.charges;
    let e = 0;
    for (let i = 0; i < q.length; i += 4) {
      const d = Math.hypot(q[i] - x - 0.5, q[i + 1] - y, q[i + 2] - z - 0.5);
      e += d > 0 ? q[i + 3] * c[0] / d : Infinity;
    }
    return e <= c[1];
  }

  /* ---- the cycle ---- */
  countsNow() {
    const cnt = this.counts;
    for (const k in CAPS) cnt[k] = 0;
    for (const e of this.m.list) {
      if (e.removed || e.dead || e.persistent) continue;
      const c = e.constructor.CATEGORY;
      if (c && c in cnt) cnt[c]++;
    }
    return cnt;
  }
  tick() {
    const m = this.m, P = m.P, W = m.world;
    if (m.gone) return;
    const cnt = this.countsNow();
    const pcx = Math.floor(P.pos.x / 16), pcz = Math.floor(P.pos.z / 16);
    const R0 = Math.min(8, W.renderDist || 8);
    // the chunks in range (looked up again when you move to another chunk, or every second)
    const chunks = this.chunkList || (this.chunkList = []);
    if (pcx !== this.lcx || pcz !== this.lcz || m.age % 20 === 0) {
      this.lcx = pcx; this.lcz = pcz;
      chunks.length = 0;
      for (let dz = -R0; dz <= R0; dz++) for (let dx = -R0; dx <= R0; dx++) {
        const c = W.chunks.get((pcx + dx) + ',' + (pcz + dz));
        if (c) chunks.push(c);
      }
    }
    if (!chunks.length) return;
    const scale = chunks.length / 289;
    const animals = m.age % 400 === 0;
    const cats = [];
    if (m.difficulty !== 'peaceful' && cnt.monster < CAPS.monster * scale) cats.push('monster');
    if (animals && cnt.creature < CAPS.creature * scale) cats.push('creature');
    if (cnt.ambient < CAPS.ambient * scale) cats.push('ambient');
    if (cnt.water_creature < CAPS.water_creature * scale) cats.push('water_creature');
    if (cnt.water_ambient < CAPS.water_ambient * scale) cats.push('water_ambient');
    if (cnt.underground_water_creature < CAPS.underground_water_creature * scale) cats.push('underground_water_creature');
    if (!cats.length) return;
    this.gatherCharges();
    // one try per chunk per category, in a shuffled order so no side is favoured
    for (let i = chunks.length - 1; i > 0; i--) { const j = RI(i + 1); const t = chunks[i]; chunks[i] = chunks[j]; chunks[j] = t; }
    for (const c of chunks) for (const cat of cats) {
      if (cnt[cat] >= CAPS[cat] * scale) continue;
      cnt[cat] += this.tryChunk(c, cat);
    }
  }
  // the list for a category at a spot, by dimension, biome and structure
  listFor(cat, b, y, x, z) {
    const dim = this.dim;
    if (x !== undefined) {
      const s = this.structureAt(x, y, z);
      if (s && STRUCT[s][cat] !== undefined) return STRUCT[s][cat];
    }
    if (dim === 'the_nether') { const n = NETHER[b] || NETHER.nether_wastes; return n[cat] || []; }
    if (dim === 'the_end') return cat === 'monster' ? END : [];
    if (b === 'the_void') return [];
    if (cat === 'monster') return monstersOf(b);
    if (cat === 'creature') return creaturesOf(b);
    if (cat === 'ambient') return [['bat', 10, 8, 8]];
    if (cat === 'water_creature') return waterOf(b);
    if (cat === 'water_ambient') return fishOf(b);
    if (cat === 'underground_water_creature') return y < 30 - Y0 ? [['glow_squid', 10, 4, 6]] : [];
    return [];
  }
  // the bottom of the dimension, as a height in the engine (the Nether and the End start at y 0)
  get yMin() { return Math.max(1, (DIMS[this.dim] ? DIMS[this.dim].minY : -64) - Y0); }
  tryChunk(c, cat) {
    const m = this.m, T = m.t, P = m.P;
    const x0 = c.cx * 16 + RI(16), z0 = c.cz * 16 + RI(16);
    const top = T.surface(x0, z0);
    const lo = this.yMin;
    if (top < lo) return 0;
    // from the bottom to just above the top block (the game's WORLD_SURFACE height + 1)
    const y = lo + RI(top - lo + 1);
    if (OPAQUE[T.get(x0, y, z0)]) return 0;
    let made = 0;
    for (let k = 0; k < 3; k++) {
      let x = x0, z = z0, entry = null, inPack = 0;
      let steps = Math.ceil(R() * 4);
      for (let l = 0; l < steps; l++) {
        x += RI(6) - RI(6); z += RI(6) - RI(6);
        const d2 = (x + 0.5 - P.pos.x) ** 2 + (y - P.pos.y) ** 2 + (z + 0.5 - P.pos.z) ** 2;
        if (d2 <= 576) continue;
        if (this.nearWorldSpawn(x, y, z)) continue;
        if (!T.loaded(x, z)) continue;
        if (!entry) {
          entry = pick(this.listFor(cat, this.biome(x, z), y, x, z));
          if (!entry) break;
          // the pack's size is the number of steps it takes from here on
          steps = entry[2] + RI(1 + entry[3] - entry[2]);
        }
        const C = TYPES[entry[0]];
        const far = DESPAWN[C.CATEGORY || cat] || 128;
        // monsters never appear where they would vanish at once; animals may
        if (d2 > far * far && (C.CATEGORY || cat) !== 'creature') continue;
        if (!this.rules(C, entry[0], x, y, z, cat)) continue;
        if (!this.costOk(entry[0], x, y, z)) continue;
        const e = m.spawn(entry[0], x + 0.5, y, z + 0.5, { natural: true, group: inPack });
        if (!e) continue;
        const cost = this.costOf(entry[0], x, z);
        if (cost) this.charges.push(e.pos.x, e.pos.y, e.pos.z, cost[0]);
        made++; inPack++;
        if (made >= (C.MAX_PER_CHUNK || 4)) return made;
      }
    }
    return made;
  }

  /* ---- animals that come with the world ----
     The first time an Overworld chunk is seen: 10% of the time (7% in the
     snow), a group of one kind of the biome's animals, each on the top
     block of a random column near the first. */
  populate(cx, cz) {
    const m = this.m, T = m.t;
    if (this.dim !== 'overworld') return;
    const b0 = this.biome(cx * 16 + 8, cz * 16 + 8);
    if (b0 === 'the_void') return;
    const p = SNOWY.has(b0) || b0 === 'ice_spikes' ? 0.07 : 0.1;
    let tries = 0;
    while (R() < p && tries++ < 4) {
      const x0 = cx * 16 + RI(16), z0 = cz * 16 + RI(16);
      const entry = pick(creaturesOf(this.biome(x0, z0)));
      if (!entry) return;
      const C = TYPES[entry[0]];
      const n = entry[2] + RI(1 + entry[3] - entry[2]);
      let x = x0, z = z0, made = 0;
      for (let i = 0; i < n * 4 && made < n; i++) {
        const y = T.motionTop(x, z);
        if (y > 0 && this.onGround(C, x, y, z) && !FLUID[T.get(x, y - 1, z)]) {
          const e = m.spawn(entry[0], x + 0.5, y, z + 0.5, { natural: true, group: made });
          if (e) made++;
        }
        x += RI(5) - RI(5); z += RI(5) - RI(5);
        // stay in this chunk
        while (x < cx * 16 || x >= cx * 16 + 16 || z < cz * 16 || z >= cz * 16 + 16) { x = cx * 16 + RI(16); z = cz * 16 + RI(16); }
      }
    }
  }
  /* ---- a structure's own mobs, once ----
     The villagers, golems and cats of a village, a hut's witch, an end
     city's shulkers, a monument's guardians: what the structure left in the
     chunk when it was made. They stay (the game marks them persistent). */
  structureMobs(c) {
    const list = c.structs && c.structs.entities;
    if (!list || !list.length) return 0;
    let n = 0;
    for (const s of list) {
      if (s.type === 'item_frame') { if (this.structureFrame(s)) n++; continue; }
      if (!TYPES[s.type]) continue;
      const e = this.m.spawn(s.type, s.x, s.y - Y0, s.z, Object.assign({ natural: true, structure: true }, s));
      if (e) { e.persistent = true; n++; }
    }
    return n;
  }
  /* An item frame a structure left (the end ship's elytra): frames are a block plus a details entry here
     (details.js hangFrame), not an entity. facing is the way the frame looks out (piece.js NORTH 0, EAST 1,
     SOUTH 2, WEST 3); the block meta is hangFrame's face (+x 1, -x 0, +z 5, -z 4). If the given side has no
     wall behind it, the first side that has one is used. */
  structureFrame(s) {
    const L = typeof window !== 'undefined' ? window.__lc2 : null, D = L && L.game && L.game.details;
    const w = this.m.world, b = B.lc2_item_frame;
    if (!w || b === undefined) return false;
    const x = Math.floor(s.x), y = Math.floor(s.y - Y0), z = Math.floor(s.z);
    const cur = w.get(x, y, z);
    if (cur && !BLOCKS[cur].replaceable) return false;
    const OUT = [[0, -1], [1, 0], [0, 1], [-1, 0]], META = [4, 1, 5, 0];
    let f = (s.facing | 0) & 3;
    const wall = d => SOLID[w.get(x - OUT[d][0], y, z - OUT[d][1])];
    if (!wall(f)) for (let d = 0; d < 4; d++) if (wall(d)) { f = d; break; }
    w.set(x, y, z, b, META[f]);
    if (D && D.entry) {
      const e = D.entry(x, y, z, 'frame');
      const id = s.item ? I[s.item] : undefined;
      e.item = id !== undefined ? { id, count: 1 } : null; e.rot = 0;
      D.changed(e);
    }
    return true;
  }
}
