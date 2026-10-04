/* ---------------------------------------------------------------------------
   Leoncraft 2 - where mobs come from, by the Minecraft Wiki's spawning rules
   (Java Edition, 1.18 and later).

   Every tick, each chunk within 8 chunks of the player (and the simulation
   distance, which is the render distance here) gets one try per mob
   category that is under its cap. The caps are per 17 x 17 chunks and
   scale with how many chunks are in range:
     monster 70, creature 10 (tried only every 400 ticks), ambient 15,
     water creature 5, water ambient 20, underground water creature 5.
   A try picks a column in the chunk and a height between the bottom of the
   world and the top block there; a solid block there ends it. Then up to
   three packs: each walks up to four times by -5..+5 across, and at each
   step, if the spot is more than 24 blocks from the player (and within
   128), a mob of a kind chosen by the biome's weights may appear there if
   its spawn rules allow; four in a chunk at most.

   Monsters need darkness: block light 0, sky light below a random 0..31,
   and the light the sky and blocks give together at or below a random 0..7.
   Animals need grass under them and light above 8. Passive animals mostly
   come with the world: the first time a chunk is seen, there is a 10%
   chance of a group of the biome's animals in it.
--------------------------------------------------------------------------- */
import { TYPES } from './mobs.js?v=8';
import { BIOMES } from '../biomes.js?v=8';
import { B, BLOCKS, SOLID, FLUID, OPAQUE } from '../blocks.js?v=8';
import { SEA, Y0 } from '../world-const.js?v=8';

const R = () => Math.random();
const RI = n => Math.floor(Math.random() * n);
export const CAPS = { monster: 70, creature: 10, ambient: 15, water_creature: 5, water_ambient: 20, underground_water_creature: 5, axolotls: 5 };

// spawn lists: [type, weight, min, max]
const MONSTERS = [['spider', 100, 4, 4], ['zombie', 95, 4, 4], ['zombie_villager', 5, 1, 1], ['skeleton', 100, 4, 4], ['creeper', 100, 4, 4], ['slime', 100, 4, 4], ['enderman', 10, 1, 4], ['witch', 5, 1, 1]];
const DESERT_M = [['spider', 100, 4, 4], ['zombie', 19, 4, 4], ['zombie_villager', 1, 1, 1], ['husk', 80, 4, 4], ['skeleton', 100, 4, 4], ['creeper', 100, 4, 4], ['slime', 100, 4, 4], ['enderman', 10, 1, 4], ['witch', 5, 1, 1]];
const SNOWY_M = [['spider', 100, 4, 4], ['zombie', 95, 4, 4], ['zombie_villager', 5, 1, 1], ['skeleton', 20, 4, 4], ['stray', 80, 4, 4], ['creeper', 100, 4, 4], ['slime', 100, 4, 4], ['enderman', 10, 1, 4], ['witch', 5, 1, 1]];
const OCEAN_M = MONSTERS.concat([['drowned', 5, 1, 1]]);
const RIVER_M = MONSTERS.concat([['drowned', 100, 1, 1]]);
const FARM = [['sheep', 12, 4, 4], ['pig', 10, 4, 4], ['chicken', 10, 4, 4], ['cow', 8, 4, 4]];
const SNOWY = new Set(['snowy_plains', 'ice_spikes', 'snowy_taiga', 'frozen_river', 'snowy_beach', 'grove', 'snowy_slopes', 'frozen_peaks', 'jagged_peaks', 'frozen_ocean', 'deep_frozen_ocean']);
function monstersOf(b) {
  if (b === 'mushroom_fields') return [];
  if (b === 'desert') return DESERT_M;
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
    case 'snowy_plains': case 'ice_spikes': return [['rabbit', 10, 2, 3]];
    case 'desert': return [['rabbit', 4, 2, 3]];
    case 'savanna': case 'savanna_plateau': case 'windswept_savanna': return FARM.concat([['horse', 1, 2, 6], ['donkey', 1, 1, 1]]);
    case 'swamp': case 'mangrove_swamp': return FARM.concat([['frog', 10, 2, 5]]);
    case 'meadow': return [['donkey', 1, 1, 2], ['rabbit', 2, 2, 6], ['sheep', 2, 2, 4]];
    case 'cherry_grove': return [['pig', 1, 1, 2], ['rabbit', 2, 2, 6], ['sheep', 2, 2, 4]];
    case 'grove': return [['wolf', 1, 1, 1], ['rabbit', 8, 2, 3], ['fox', 4, 2, 4]];
    case 'snowy_slopes': case 'frozen_peaks': case 'jagged_peaks': return [['goat', 5, 1, 3], ['rabbit', 4, 2, 3]];
    case 'windswept_hills': case 'windswept_gravelly_hills': return FARM.concat([['llama', 5, 4, 6]]);
    case 'jungle': case 'sparse_jungle': case 'bamboo_jungle': return FARM.concat([['chicken', 10, 4, 4]]);
    case 'mushroom_fields': return [['mooshroom', 8, 4, 8]];
    case 'beach': return [['turtle', 5, 2, 5]];
    case 'river': case 'ocean': case 'deep_ocean': return [];
    default: return /ocean|river|beach|shore|peaks|badlands/.test(b) ? [] : FARM;
  }
}
function waterOf(b) {
  if (/river/.test(b)) return [['squid', 2, 1, 4]];
  if (/ocean/.test(b)) return [['squid', /deep/.test(b) ? 1 : 10, 1, 4]].concat(/warm|lukewarm/.test(b) ? [['dolphin', 2, 1, 2]] : []);
  return [];
}
function fishOf(b) {
  if (/river/.test(b)) return [['salmon', 5, 1, 5]];
  if (/warm_ocean|lukewarm/.test(b)) return [['tropical_fish', 25, 8, 8], ['pufferfish', 15, 1, 3], ['cod', /lukewarm/.test(b) ? 15 : 0, 3, 6]];
  if (/cold|frozen/.test(b)) return [['cod', 15, 3, 6], ['salmon', 15, 1, 5]];
  if (/ocean/.test(b)) return [['cod', 10, 3, 6]];
  return [];
}
const pick = list => {
  const ok = list.filter(e => TYPES[e[0]] && e[1] > 0);
  let tot = 0; for (const e of ok) tot += e[1];
  if (!tot) return null;
  let r = RI(tot);
  for (const e of ok) { if (r < e[1]) return e; r -= e[1]; }
  return null;
};

export class Spawner {
  constructor(m) { this.m = m; this.counts = {}; }
  biome(x, z) { const b = BIOMES[this.m.world.biomeAt(x, z)]; return b ? b.name : 'plains'; }
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
  // the darkness monsters need
  darkEnough(x, y, z) {
    const T = this.m.t;
    if (T.sky(x, y, z) > RI(32)) return false;
    if (T.block(x, y, z) > 0) return false;
    return this.m.rawBrightness(x, y, z) <= RI(8);
  }
  rules(C, type, x, y, z, cat) {
    const m = this.m, T = m.t;
    if (C.checkSpawn) return C.checkSpawn(this, x, y, z);
    if (cat === 'monster') return m.difficulty !== 'peaceful' && this.darkEnough(x, y, z) && this.onGround(C, x, y, z);
    if (cat === 'creature') return T.get(x, y - 1, z) === B.grass_block && m.rawBrightness(x, y, z) > 8 && this.onGround(C, x, y, z);
    return false;
  }

  tick() {
    const m = this.m, P = m.P, W = m.world;
    if (m.gone) return;
    // count what there is, by category
    const cnt = this.counts;
    for (const k in CAPS) cnt[k] = 0;
    for (const e of m.list) { if (e.removed || e.dead) continue; const c = e.constructor.CATEGORY; if (c && c in cnt) cnt[c]++; }
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
    // one try per chunk per category, in a shuffled order so no side is favoured
    for (let i = chunks.length - 1; i > 0; i--) { const j = RI(i + 1); const t = chunks[i]; chunks[i] = chunks[j]; chunks[j] = t; }
    for (const c of chunks) for (const cat of cats) {
      if (cnt[cat] >= CAPS[cat] * scale) continue;
      cnt[cat] += this.tryChunk(c, cat);
    }
  }
  listFor(cat, b, y) {
    if (cat === 'monster') return monstersOf(b);
    if (cat === 'creature') return creaturesOf(b);
    if (cat === 'ambient') return [['bat', 10, 8, 8]];
    if (cat === 'water_creature') return waterOf(b);
    if (cat === 'water_ambient') return fishOf(b);
    if (cat === 'underground_water_creature') return y < 30 - Y0 ? [['glow_squid', 10, 4, 6]] : [];
    return [];
  }
  tryChunk(c, cat) {
    const m = this.m, T = m.t, P = m.P;
    const x0 = c.cx * 16 + RI(16), z0 = c.cz * 16 + RI(16);
    const top = T.surface(x0, z0);
    if (top < 1) return 0;
    const y = 1 + RI(top + 1);
    if (OPAQUE[T.get(x0, y, z0)]) return 0;
    let made = 0;
    for (let k = 0; k < 3; k++) {
      let x = x0, z = z0, entry = null, group = 0, inPack = 0;
      const steps = Math.ceil(R() * 4);
      for (let l = 0; l < steps; l++) {
        x += RI(6) - RI(6); z += RI(6) - RI(6);
        const d2 = (x + 0.5 - P.pos.x) ** 2 + (y - P.pos.y) ** 2 + (z + 0.5 - P.pos.z) ** 2;
        if (d2 <= 576) continue;
        if (!T.loaded(x, z)) continue;
        if (!entry) {
          entry = pick(this.listFor(cat, this.biome(x, z), y));
          if (!entry) return made;
          group = entry[2] + RI(1 + entry[3] - entry[2]);
        }
        const C = TYPES[entry[0]];
        if (d2 > 128 * 128 && !(C.DESPAWN && d2 < C.DESPAWN * C.DESPAWN)) continue;
        if ((C.DESPAWN || 128) ** 2 < d2) continue;
        if (!this.rules(C, entry[0], x, y, z, cat)) continue;
        const e = m.spawn(entry[0], x + 0.5, y, z + 0.5, { natural: true, group: inPack });
        if (!e) continue;
        made++; inPack++;
        if (made >= (C.MAX_PER_CHUNK || 4)) return made;
        if (inPack >= group) break;
      }
    }
    return made;
  }

  /* ---- animals that come with the world ----
     The first time a chunk is seen: 10% of the time, a group of one kind of
     the biome's animals, each on the top block of a random column near the
     first. */
  populate(cx, cz) {
    const m = this.m, T = m.t;
    let tries = 0;
    while (R() < 0.1 && tries++ < 4) {
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
          if (e) { e.persistent = true; made++; }
        }
        x += RI(5) - RI(5); z += RI(5) - RI(5);
        // stay in this chunk
        while (x < cx * 16 || x >= cx * 16 + 16 || z < cz * 16 || z >= cz * 16 + 16) { x = cx * 16 + RI(16); z = cz * 16 + RI(16); }
      }
    }
  }
}
