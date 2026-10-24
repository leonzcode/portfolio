/* ---------------------------------------------------------------------------
   Leoncraft 2 - farming: hoes, seeds, bone meal and what crops drop.

   A hoe turns grass, dirt and dirt paths into farmland (coarse dirt into
   dirt) when the block above is air and you did not click its underside.
   Seeds and plants only go where they can grow: crops and stems on
   farmland, nether wart on soul sand, saplings and berries on dirt, cane
   beside water, cactus on sand. Bone meal ages a crop 2 to 5 stages
   (beetroot 0 or 1), gives a sapling a 45% chance at its next stage, and on
   grass scatters grass and flowers round it. Crops drop by the game's loot
   tables: ripe wheat one wheat and 1 + Binomial(3, 4/7) seeds, and so on.

   Items (bone meal, hoes, flint and steel...) come from the items code when
   it is there: names are looked up through window.__lc2.itemName / itemId if
   they exist, else as block names, so this works on its own too.
--------------------------------------------------------------------------- */
import { B, BLOCKS, FLUID } from '../blocks.js?v=107';
import { isDirt } from './plants.js?v=107';
import { boneMeal as bambooBoneMeal, placed as bambooPlaced, bambooMeta, SMALL as BAMBOO_SMALL } from './bamboo.js?v=107';
import { I, itemName as itemNameOf } from '../items.js?v=107';

const RI = (sim, n) => Math.floor(sim.rng() * n);
const binom = (sim, n, p) => { let k = 0; for (let i = 0; i < n; i++) if (sim.rng() < p) k++; return k; };
const between = (sim, a, b) => a + RI(sim, b - a + 1);

// the name of an item or block id
export function itemName(id) { return itemNameOf(id); }
// an item's id from its name: the items code's, else a block that is that item (wheat is the seeds), else a block
const byItemOf = new Map();
export function resolveItem(name) {
  if (I[name] !== undefined) return I[name];
  if (!byItemOf.size) for (const d of BLOCKS) if (d && d.itemOf) byItemOf.set(d.itemOf, d.id);
  if (byItemOf.has(name)) return byItemOf.get(name);
  return B[name] !== undefined && BLOCKS[B[name]].item !== false ? B[name] : 0;
}

const CROPS = { wheat: 7, carrots: 7, potatoes: 7, beetroots: 3, melon_stem: 7, pumpkin_stem: 7, torchflower_crop: 2 };
const FLOWERS = ['dandelion', 'poppy'];

export function installFarming(sim) {
  /* ---- what crops drop (the game's loot tables, without Fortune) ---- */
  const lootBy = {
    wheat: (s, m) => ((m & 7) >= 7 ? [['wheat', 1], ['wheat_seeds', 1 + binom(s, 3, 0.5714286)]] : [['wheat_seeds', 1]]),
    carrots: (s, m) => [['carrot', (m & 7) >= 7 ? 1 + binom(s, 3, 0.5714286) : 1]],
    potatoes: (s, m) => ((m & 7) >= 7 ? [['potato', 1 + binom(s, 3, 0.5714286)]].concat(s.rng() < 0.02 ? [['poisonous_potato', 1]] : []) : [['potato', 1]]),
    beetroots: (s, m) => ((m & 7) >= 3 ? [['beetroot', 1], ['beetroot_seeds', 1 + binom(s, 3, 0.5714286)]] : [['beetroot_seeds', 1]]),
    nether_wart: (s, m) => [['nether_wart', (m & 7) >= 3 ? between(s, 2, 4) : 1]],
    sweet_berry_bush: (s, m) => ((m & 7) >= 3 ? [['sweet_berries', between(s, 2, 3)]] : (m & 7) === 2 ? [['sweet_berries', between(s, 1, 2)]] : []),
    cocoa: (s, m) => [['cocoa_beans', ((m >> 3) & 3) >= 2 ? between(s, 2, 3) : 1]],
    melon: s => [['melon_slice', between(s, 3, 7)]],
    melon_stem: (s, m) => { const n = binom(s, 3, ((m & 7) + 1) / 15); return n ? [['melon_seeds', n]] : []; },
    pumpkin_stem: (s, m) => { const n = binom(s, 3, ((m & 7) + 1) / 15); return n ? [['pumpkin_seeds', n]] : []; },
    attached_melon_stem: s => { const n = binom(s, 3, 8 / 15); return n ? [['melon_seeds', n]] : []; },
    attached_pumpkin_stem: s => { const n = binom(s, 3, 8 / 15); return n ? [['pumpkin_seeds', n]] : []; },
    short_grass: s => (s.rng() < 0.125 ? [['wheat_seeds', 1]] : []),
    tall_grass: s => (s.rng() < 0.125 ? [['wheat_seeds', 1]] : []),
    fern: s => (s.rng() < 0.125 ? [['wheat_seeds', 1]] : []),
  };
  for (const n in lootBy) if (B[n] !== undefined) sim.on(n, { loot: (s, b, m) => lootBy[n](s, m) });

  /* ---- sweet berries are picked by hand: 2-3 ripe, 1-2 not quite, back to age 1 ---- */
  sim.on('sweet_berry_bush', {
    use(s, x, y, z, m, held) {
      const age = m & 7;
      if (age !== 3 && held === 'bone_meal') return false;
      if (age <= 1) return false;
      s.dropItem(x + 0.5, y + 0.5, z + 0.5, 'sweet_berries', age === 3 ? between(s, 2, 3) : between(s, 1, 2));
      s.set(x, y, z, B.sweet_berry_bush, 1);
      return true;
    },
  });

  /* ---- where seeds and plants may go ---- */
  // what each kind of ground plant may stand on (Minecraft Wiki; the game's mayPlaceOn): null when it is not one of them
  const nm = b => (b ? BLOCKS[b].name : '');
  const SANDY = b => /^(sand|red_sand|suspicious_sand|suspicious_gravel)$|terracotta$/.test(nm(b));
  const dirtOrFarm = b => isDirt(b) || b === B.farmland;
  const NETHER_SOIL = b => /^(crimson_nylium|warped_nylium|soul_soil|mycelium)$/.test(nm(b)) || dirtOrFarm(b);
  const skyAbove = (x, y, z) => { for (let k = 1; k < 64; k++) { const c = sim.get(x, y + k, z); if (c && BLOCKS[c].opacity >= 15) return false; } return true; };
  const FLOWERS = /^(short_grass|fern|tall_grass|large_fern|dandelion|golden_dandelion|torchflower|poppy|blue_orchid|allium|azure_bluet|red_tulip|orange_tulip|white_tulip|pink_tulip|oxeye_daisy|cornflower|lily_of_the_valley|sunflower|lilac|rose_bush|peony|pitcher_plant|pink_petals|wildflowers|bush|firefly_bush|open_eyeblossom|closed_eyeblossom|cactus_flower|red_shrub)$/;
  const SOIL = n => {
    if (FLOWERS.test(n)) return n === 'cactus_flower' ? (b => b === B.cactus || dirtOrFarm(b)) : dirtOrFarm;
    if (n === 'wither_rose') return b => dirtOrFarm(b) || /^(netherrack|soul_sand|soul_soil)$/.test(nm(b));
    if (n === 'dead_bush' || n === 'short_dry_grass' || n === 'tall_dry_grass') return b => SANDY(b) || dirtOrFarm(b);
    // mushrooms: mycelium, podzol and nylium at any light; otherwise a full block out of the daylight
    if (n === 'brown_mushroom' || n === 'red_mushroom') return (b, x, y, z) => /^(mycelium|podzol|crimson_nylium|warped_nylium)$/.test(nm(b)) || (b && BLOCKS[b].shape === 'cube' && BLOCKS[b].opacity >= 15 && !skyAbove(x, y, z));
    if (/^(crimson|warped)_(fungus|roots)$|^nether_sprouts$/.test(n)) return NETHER_SOIL;
    return null;
  };
  const FARMLAND_ONLY = new Set(['wheat', 'carrots', 'potatoes', 'beetroots', 'melon_stem', 'pumpkin_stem', 'torchflower_crop', 'pitcher_crop']);
  const SAPLINGS = /_sapling$|^mangrove_propagule$|^azalea$|^flowering_azalea$|^sweet_berry_bush$|^bamboo$/;
  (sim.placers = sim.placers || []).push((list) => {
    for (const [x, y, z, id] of list) {
      const d = BLOCKS[id];
      if (!d) continue;
      // the top half of a two-block plant stands on its own bottom half, which is what is judged
      if (list.some(e => e[0] === x && e[1] === y - 1 && e[2] === z)) continue;
      const below = sim.get(x, y - 1, z);
      if (FARMLAND_ONLY.has(d.name) && below !== B.farmland) return [];
      if (d.name === 'nether_wart' && below !== B.soul_sand) return [];
      if (SAPLINGS.test(d.name) && !(isDirt(below) || below === B.farmland || (d.name === 'bamboo' && (below === B.bamboo || below === B.sand || below === B.gravel || below === B.red_sand)))) return [];
      if (d.name === 'cactus' && !(below === B.sand || below === B.red_sand || below === B.cactus)) return [];
      // (the game's canSurvive) what hangs needs something above it: weeping vines, spore blossoms, hanging roots,
      // pale hanging moss (also under leaves); twisting vines something below; sea grass and kelp water to stand in;
      // big dripleaf its ground, small dripleaf clay or moss (or, under water, dirt); chorus end stone or chorus
      const above = sim.get(x, y + 1, z), here = sim.get(x, y, z);
      const sturdy = b => !!b && !!BLOCKS[b] && !!BLOCKS[b].solid && BLOCKS[b].shape === 'cube';
      const n = d.name;
      if (/^(weeping_vines|spore_blossom|hanging_roots|pale_hanging_moss)$/.test(n) && !(sturdy(above) || above === id || nm(above) === n + '_plant'
        || (n === 'pale_hanging_moss' && /_leaves$/.test(nm(above))))) return [];
      if (n === 'twisting_vines' && !(sturdy(below) || below === id || nm(below) === 'twisting_vines_plant')) return [];
      if (/^(seagrass|tall_seagrass|kelp)$/.test(n) && !(FLUID[here] === 1 && (sturdy(below) || below === id || nm(below) === 'kelp_plant'))) return [];
      if (n === 'big_dripleaf' && !(/^(clay|dirt|coarse_dirt|grass_block|farmland|moss_block|pale_moss_block|mud|muddy_mangrove_roots|mycelium|podzol|rooted_dirt)$/.test(nm(below)) || /^big_dripleaf/.test(nm(below)))) return [];
      if (n === 'small_dripleaf' && !(/^(clay|moss_block)$/.test(nm(below)) || (FLUID[here] === 1 && (isDirt(below) || below === B.farmland)))) return [];
      if ((n === 'chorus_plant' || n === 'chorus_flower') && !(below === B.end_stone || below === B.chorus_plant)) return [];
      // a vine holds on to a full block beside it or above it; cocoa grows only on the side of a jungle log
      const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, c]) => sim.get(x + a, y, z + c));
      if (n === 'vine' && !(sides.some(sturdy) || sturdy(above) || above === id)) return [];
      if (n === 'cocoa' && !sides.some(b => /^(stripped_)?jungle_(log|wood)$/.test(nm(b)))) return [];
      // flowers, grass and the rest of the ground plants want soil under them, as the game's mayPlaceOn says
      const soil = SOIL(d.name);
      if (soil && !list.some(e => e[0] === x && e[1] === y - 1 && e[2] === z) && !soil(below, x, y, z)) return [];
      if (d.name === 'sugar_cane') {
        if (below !== B.sugar_cane) {
          if (!below || !/^(grass_block|dirt|coarse_dirt|podzol|mycelium|rooted_dirt|moss_block|mud|sand|red_sand|suspicious_sand|pale_moss_block)$/.test(BLOCKS[below].name)) return [];
          let wet = false;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = sim.get(x + dx, y - 1, z + dz); if (FLUID[n] === 1 || (n && BLOCKS[n].waterlogged)) wet = true; }
          if (!wet) return [];
        }
      }
    }
    // bamboo: a sapling on the ground, a stalk on a sapling or on bamboo (sim/bamboo.js placed)
    return list.map(e => {
      if (e[3] !== B.bamboo) return e;
      const [b, m] = bambooPlaced(sim.get(e[0], e[1] - 1, e[2]), sim.meta(e[0], e[1] - 1, e[2]), sim.get(e[0], e[1] + 1, e[2]), sim.meta(e[0], e[1] + 1, e[2]));
      return [e[0], e[1], e[2], b, m];
    });
  });

  /* ---- things in the hand ---- */
  const prev = sim.useItem;
  sim.useItem = (held, hit, heldId, sneaking) => {
    if (prev && prev(held, hit, heldId, sneaking)) return true;
    if (/_hoe$/.test(held)) return till(sim, hit);
    // bone meal that took is used up (interact.js hands it to the hand, which keeps it in creative) and makes its sound
    if (held === 'bone_meal') { if (!boneMeal(sim, hit.x, hit.y, hit.z)) return false; sim.usedHeld = true; return true; }
    return false;
  };
  sim.boneMeal = (x, y, z) => boneMeal(sim, x, y, z);
}

function till(sim, hit) {
  const { x, y, z } = hit;
  if (hit.face && hit.face[1] === -1) return false;
  const a = sim.get(x, y + 1, z);
  if (a && !(BLOCKS[a].name === 'cave_air')) return false;
  const b = sim.get(x, y, z), n = b ? BLOCKS[b].name : '';
  if (n === 'grass_block' || n === 'dirt' || n === 'dirt_path') { sim.set(x, y, z, B.farmland, 0); sim.consumeHeld && sim.consumeHeld('hoe'); return true; }
  if (n === 'coarse_dirt') { sim.set(x, y, z, B.dirt, 0); return true; }
  if (n === 'rooted_dirt') { sim.set(x, y, z, B.dirt, 0); sim.dropItem(x + 0.5, y + 1, z + 0.5, 'hanging_roots', 1); return true; }
  return false;
}

/* Bone meal on a block: true if it took (and the meal is used up). */
function boneMeal(sim, x, y, z) {
  const b = sim.get(x, y, z);
  if (!b) return false;
  const d = BLOCKS[b], n = d.name, m = sim.meta(x, y, z);
  if (CROPS[n] !== undefined) {
    const age = m & 7, max = CROPS[n];
    if (age >= max) return false;
    let inc = between(sim, 2, 5);
    if (n === 'beetroots') inc = Math.floor(inc / 3);
    sim.set(x, y, z, b, Math.min(max, age + inc));
    return true;
  }
  if (/_sapling$|^mangrove_propagule$/.test(n)) {
    if (sim.rng() < 0.45) { if (!(m & 1)) sim.set(x, y, z, b, m | 1); else sim.growTree(x, y, z); }
    return true;
  }
  if (n === 'sweet_berry_bush') { if ((m & 7) >= 3) return false; sim.set(x, y, z, b, (m & 7) + 1); return true; }
  // a cave vine without glow berries grows them
  if (n === 'cave_vines' || n === 'cave_vines_plant') { if (m & 1) return false; sim.set(x, y, z, b, m | 1); return true; }
  // a small shelf mushroom grows large (meta bit 3); it never grows on its own
  if (n === 'shelf_mushroom') { if (m & 8) return false; sim.set(x, y, z, b, m | 8); return true; }
  if (n === 'cocoa') { const age = (m >> 3) & 3; if (age >= 2) return false; sim.set(x, y, z, b, (m & 7) | ((age + 1) << 3)); return true; }
  // (sim/bamboo.js: the game's performBonemeal; a sapling grows its first stalk as a random tick does)
  if (n === 'bamboo_sapling') {
    if (sim.get(x, y + 1, z)) return false;
    sim.set(x, y, z, B.bamboo, 0); sim.set(x, y + 1, z, B.bamboo, bambooMeta(0, BAMBOO_SMALL, 0));
    return true;
  }
  if (n === 'bamboo') return bambooBoneMeal(sim, x, y, z, () => sim.rng(), (ax, ay, az) => !sim.get(ax, ay, az));
  if (n === 'short_grass' || n === 'fern') {
    const tall = n === 'fern' ? 'large_fern' : 'tall_grass';
    if (sim.get(x, y + 1, z)) return false;
    sim.set(x, y, z, B[tall], 0); sim.set(x, y + 1, z, B[tall + '_top_block'], 0);
    return true;
  }
  if (/^(sunflower|lilac|rose_bush|peony)$/.test(n)) { sim.dropItem(x + 0.5, y + 0.5, z + 0.5, n, 1); return true; }
  if (n === 'kelp' || n === 'kelp_plant') {
    let top = y; while (sim.get(x, top + 1, z) === B.kelp_plant || sim.get(x, top + 1, z) === B.kelp) top++;
    if (FLUID[sim.get(x, top + 1, z)] !== 1) return false;
    sim.set(x, top, z, B.kelp_plant, 0); sim.set(x, top + 1, z, B.kelp, 0);
    return true;
  }
  if (n === 'grass_block') {
    if (sim.get(x, y + 1, z)) return false;
    // the game's walk: 128 tries, each wandering up to i/16 steps from the block
    outer: for (let i = 0; i < 128; i++) {
      let px = x, py = y + 1, pz = z;
      for (let j = 0; j < i / 16; j++) {
        px += sim.rng() * 3 - 1 | 0; py += (sim.rng() * 3 - 1 | 0) * Math.floor(sim.rng() * 3) >> 1; pz += sim.rng() * 3 - 1 | 0;
        if (sim.get(px, py - 1, pz) !== B.grass_block || sim.get(px, py, pz)) continue outer;
      }
      if (sim.get(px, py, pz) || sim.get(px, py - 1, pz) !== B.grass_block) continue;
      if (sim.rng() < 0.125) sim.set(px, py, pz, B[FLOWERS[RI(sim, FLOWERS.length)]], 0);
      else sim.set(px, py, pz, B.short_grass, 0);
    }
    return true;
  }
  return false;
}
