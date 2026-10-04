/* ---------------------------------------------------------------------------
   Leoncraft 2 - fire, by the game's rules (Minecraft Wiki, Java Edition).

   Fire ticks every 30-39 ticks. Each time it ages (0-15), may go out in the
   rain (20% + 3% an age), goes out with nothing flammable beside it unless it
   stands on something solid and is young, and at age 15 on something that
   cannot burn. It eats its neighbours by their flammability (a 1 in 300
   roll beside it, 250 above and below, 50 less in humid biomes), the burnt
   block becoming fire or air, TNT being lit. It jumps into air within 3x6x3
   (more unlikely the higher above) by the encouragement of what is round
   that air: (encouragement + 40 + 7 x difficulty) / (age + 30) out of 100.
   Netherrack and magma burn for ever. Soul fire sits on soul sand and soul
   soil and never spreads. Lava lights flammable blocks round it on its own
   random ticks.

   Flint and steel (or a fire charge) lights a fire on the face you click,
   lights TNT, campfires and candles.
--------------------------------------------------------------------------- */
import { B, BLOCKS, FLUID } from '../blocks.js?v=9';

const RI = (s, n) => Math.floor(s.rng() * n);
const NB6 = [[1, 0, 0], [-1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];
const HUMID = /jungle|swamp|mushroom/;

// [encouragement (catches), flammability (burns away)] from the wiki's table
export const FLAME = new Map();
function flame(test, e, f) { for (const d of BLOCKS) if (d && test(d.name, d)) FLAME.set(d.id, [e, f]); }
flame(n => /_planks$/.test(n) && !/crimson|warped/.test(n), 5, 20);
flame(n => /_(slab|stairs|fence|fence_gate)$/.test(n) && /^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo)/.test(n), 5, 20);
flame(n => /_(log|wood)$/.test(n) && !/crimson|warped/.test(n) || /^stripped_.*_(log|wood)$/.test(n) && !/crimson|warped/.test(n), 5, 5);
flame(n => /^bamboo_(block|mosaic|mosaic_slab|mosaic_stairs)$/.test(n), 5, 20);
flame((n, d) => d.leaves, 30, 60);
flame(n => n === 'bookshelf' || n === 'chiseled_bookshelf' || n === 'lectern', 30, 20);
flame(n => n === 'tnt', 15, 100);
flame(n => /^(short_grass|tall_grass|tall_grass_top_block|fern|large_fern|large_fern_top_block|dead_bush|sweet_berry_bush|small_dripleaf|pink_petals|spore_blossom|wildflowers|leaf_litter|bush|firefly_bush|short_dry_grass|tall_dry_grass)$/.test(n), 60, 100);
flame(n => /^(dandelion|poppy|blue_orchid|allium|azure_bluet|red_tulip|orange_tulip|white_tulip|pink_tulip|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|torchflower|sunflower|lilac|rose_bush|peony|pitcher_plant)(_top_block)?$/.test(n), 60, 100);
flame(n => /_wool$/.test(n), 30, 60);
flame(n => /_carpet$/.test(n) && n !== 'moss_carpet', 60, 20);
flame(n => n === 'vine' || n === 'glow_lichen' || n === 'big_dripleaf' || n === 'big_dripleaf_stem', 15, 100);
flame(n => n === 'cave_vines' || n === 'cave_vines_plant', 15, 60);
flame(n => n === 'coal_block', 5, 5);
flame(n => n === 'hay_block', 60, 20);
flame(n => n === 'target', 15, 20);
flame(n => n === 'dried_kelp_block', 30, 60);
flame(n => n === 'scaffolding' || n === 'bamboo', 60, 60);
flame(n => n === 'composter' || n === 'beehive' || n === 'bee_nest' || n === 'mangrove_roots', 5, 20);
flame(n => n === 'azalea' || n === 'flowering_azalea' || n === 'hanging_roots', 30, 60);
flame(n => n === 'moss_block' || n === 'moss_carpet' || n === 'pale_moss_block' || n === 'pale_moss_carpet', 5, 100);
flame(n => /_bed$/.test(n), 0, 0);
export const burns = b => (FLAME.get(b) || [0, 0])[1];
export const catches = b => (FLAME.get(b) || [0, 0])[0];
export const flammable = b => FLAME.has(b) && FLAME.get(b)[0] > 0;

export function installFire(sim) {
  const fire = B.fire, soul = B.soul_fire;
  const isAir = b => !b || BLOCKS[b].name === 'cave_air';
  const sturdyTop = b => b && BLOCKS[b].solid && (BLOCKS[b].shape === 'cube' || BLOCKS[b].shape === 'slab' || BLOCKS[b].shape === 'stairs');
  const nextToFuel = (x, y, z) => { for (const [dx, dy, dz] of NB6) if (flammable(sim.get(x + dx, y + dy, z + dz))) return true; return false; };
  const infiniburn = b => b === B.netherrack || b === B.magma_block || (sim.dimension() === 'end' && b === B.bedrock);
  const soulBase = b => b === B.soul_sand || b === B.soul_soil;
  // can a fire stand here?
  sim.fireCanStay = (x, y, z) => sturdyTop(sim.get(x, y - 1, z)) || nextToFuel(x, y, z);
  // the odds a fire jumps into this air: the best encouragement of what is round it
  const igniteOdds = (x, y, z) => {
    if (!isAir(sim.get(x, y, z))) return 0;
    let o = 0;
    for (const [dx, dy, dz] of NB6) o = Math.max(o, catches(sim.get(x + dx, y + dy, z + dz)));
    return o;
  };
  const nearRain = (x, y, z) => sim.weather.rainingAt(x, y, z) || sim.weather.rainingAt(x - 1, y, z) || sim.weather.rainingAt(x + 1, y, z)
    || sim.weather.rainingAt(x, y, z - 1) || sim.weather.rainingAt(x, y, z + 1);
  // put a fire down (soul fire on soul sand), with its first tick 30-39 ticks off
  sim.lightFire = (x, y, z, age) => {
    const below = sim.get(x, y - 1, z);
    const id = soulBase(below) ? soul : fire;
    if (id === fire && !sim.fireCanStay(x, y, z)) return false;
    sim.set(x, y, z, id, age || 0);
    return true;
  };
  const burnOut = (x, y, z, chance, age) => {
    const b = sim.get(x, y, z);
    if (RI(sim, chance) >= burns(b)) return;
    const wasTnt = b === B.tnt;
    if (RI(sim, age + 10) < 5 && !sim.weather.rainingAt(x, y, z)) {
      const j = Math.min(age + Math.floor(RI(sim, 5) / 4), 15);
      sim.set(x, y, z, fire, j);
    } else sim.set(x, y, z, 0, 0);
    if (wasTnt && sim.primeTnt) sim.primeTnt(x, y, z, null, 80);
  };
  sim.on('fire', {
    // a fire that appears (lit, spread, or placed) starts ticking
    onPlace(s, x, y, z) { s.schedule(x, y, z, 30 + RI(s, 10)); },
    tick(s, x, y, z, m) {
      if (!s.fireCanStay(x, y, z)) { s.set(x, y, z, 0, 0); return; }
      const below = s.get(x, y - 1, z), inf = infiniburn(below);
      const age = m & 15;
      if (!inf && s.weather.raining && nearRain(x, y, z) && s.rng() < 0.2 + age * 0.03) { s.set(x, y, z, 0, 0); return; }
      const na = Math.min(15, age + Math.floor(RI(s, 3) / 2));
      if (na !== age) { s.quietSet(x, y, z, fire, na); }
      if (!inf) {
        if (!nextToFuel(x, y, z)) {
          if (!sturdyTop(below) || age > 3) s.set(x, y, z, 0, 0);
          else s.schedule(x, y, z, 30 + RI(s, 10));
          return;
        }
        if (age === 15 && RI(s, 4) === 0 && !flammable(below)) { s.set(x, y, z, 0, 0); return; }
      }
      const humid = HUMID.test(s.biomeAt(x, z).name), k = humid ? -50 : 0;
      burnOut(x + 1, y, z, 300 + k, age); burnOut(x - 1, y, z, 300 + k, age);
      burnOut(x, y - 1, z, 250 + k, age); burnOut(x, y + 1, z, 250 + k, age);
      burnOut(x, y, z - 1, 300 + k, age); burnOut(x, y, z + 1, 300 + k, age);
      const diff = s.difficulty === undefined ? 2 : s.difficulty;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 4; dy++) {
        if (!dx && !dy && !dz) continue;
        let l = 100;
        if (dy > 1) l += (dy - 1) * 100;
        const odds = igniteOdds(x + dx, y + dy, z + dz);
        if (odds <= 0) continue;
        let j = Math.floor((odds + 40 + diff * 7) / (age + 30));
        if (humid) j = Math.floor(j / 2);
        if (j > 0 && RI(s, l) <= j && !(s.weather.raining && nearRain(x + dx, y + dy, z + dz))) {
          s.set(x + dx, y + dy, z + dz, fire, Math.min(15, age + Math.floor(RI(s, 5) / 4)));
        }
      }
      if (s.get(x, y, z) === fire) s.schedule(x, y, z, 30 + RI(s, 10));
    },
    neighbor(s, x, y, z) { if (!s.fireCanStay(x, y, z)) s.set(x, y, z, 0, 0); },
    loot() { return []; },
  });
  if (soul !== undefined) sim.on('soul_fire', {
    neighbor(s, x, y, z) { if (!soulBase(s.get(x, y - 1, z))) s.set(x, y, z, 0, 0); },
    loot() { return []; },
  });

  /* ---- lava lights what is round it ---- */
  sim.on('lava', {
    random(s, x, y, z) {
      const i = RI(s, 3);
      if (i > 0) {
        let px = x, py = y, pz = z;
        for (let j = 0; j < i; j++) {
          px += RI(s, 3) - 1; py += 1; pz += RI(s, 3) - 1;
          if (!s.w.loaded(px, pz)) return;
          const b = s.get(px, py, pz);
          if (isAir(b)) { if (nextToFuel(px, py, pz)) { s.set(px, py, pz, fire, 0); return; } }
          else if (BLOCKS[b].solid) return;
        }
      } else {
        for (let k = 0; k < 3; k++) {
          const px = x + RI(s, 3) - 1, pz = z + RI(s, 3) - 1;
          if (!s.w.loaded(px, pz)) return;
          if (isAir(s.get(px, y + 1, pz)) && flammable(s.get(px, y, pz))) s.set(px, y + 1, pz, fire, 0);
        }
      }
    },
  });

  /* ---- flint and steel, fire charges ---- */
  const prev = sim.useItem;
  sim.useItem = (held, hit, heldId, sneaking) => {
    if (prev && prev(held, hit, heldId, sneaking)) return true;
    if (held !== 'flint_and_steel' && held !== 'fire_charge') return false;
    const b = sim.get(hit.x, hit.y, hit.z), n = b ? BLOCKS[b].name : '';
    // a fire charge is used up; flint and steel wears by 1 (interact.js passes wornHeld to the hand)
    if (n === 'tnt') { sim.set(hit.x, hit.y, hit.z, 0, 0); sim.primeTnt(hit.x, hit.y, hit.z, sim.player, 80); if (held === 'fire_charge') sim.usedHeld = true; else sim.wornHeld = 1; return true; }
    const f = hit.face, x = hit.x + f[0], y = hit.y + f[1], z = hit.z + f[2];
    if (!isAir(sim.get(x, y, z))) return false;
    if (!sim.lightFire(x, y, z, 0)) return false;
    if (held === 'fire_charge') sim.usedHeld = true; else sim.wornHeld = 1;
    return true;
  };

  /* ---- standing in fire hurts (1 every half second in survival) ---- */
  (sim.tickers = sim.tickers || []).push(() => {
    const g = sim.game;
    if (!g || g.mode === 'creative' || !g.survival) return;
    const p = sim.player.pos, b = sim.get(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
    const b2 = sim.get(Math.floor(p.x), Math.floor(p.y + 1), Math.floor(p.z));
    if (b === fire || b === soul || b2 === fire || b2 === soul) { if (sim.n % 10 === 0) g.survival.hurt(b === soul || b2 === soul ? 2 : 1); }
  });
}
