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
import { B, BLOCKS, FLUID } from '../blocks.js?v=9';
import { isDirt } from './plants.js?v=9';

const RI = (sim, n) => Math.floor(sim.rng() * n);
const binom = (sim, n, p) => { let k = 0; for (let i = 0; i < n; i++) if (sim.rng() < p) k++; return k; };
const between = (sim, a, b) => a + RI(sim, b - a + 1);

// the name of an item or block id
export function itemName(id) {
  const L = window.__lc2;
  if (L && typeof L.itemName === 'function') { const n = L.itemName(id); if (n) return n; }
  const d = BLOCKS[id];
  return d ? d.name : '';
}
// an item's id from its name: the items code's, else a block that is that item (wheat is the seeds), else a block
const byItemOf = new Map();
export function resolveItem(name) {
  const L = window.__lc2;
  if (L && typeof L.itemId === 'function') { const id = L.itemId(name); if (id) return id; }
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
  const FARMLAND_ONLY = new Set(['wheat', 'carrots', 'potatoes', 'beetroots', 'melon_stem', 'pumpkin_stem', 'torchflower_crop', 'pitcher_crop']);
  const SAPLINGS = /_sapling$|^mangrove_propagule$|^azalea$|^flowering_azalea$|^sweet_berry_bush$|^bamboo$/;
  (sim.placers = sim.placers || []).push((list) => {
    for (const [x, y, z, id] of list) {
      const d = BLOCKS[id];
      if (!d) continue;
      const below = sim.get(x, y - 1, z);
      if (FARMLAND_ONLY.has(d.name) && below !== B.farmland) return [];
      if (d.name === 'nether_wart' && below !== B.soul_sand) return [];
      if (SAPLINGS.test(d.name) && !(isDirt(below) || below === B.farmland || (d.name === 'bamboo' && (below === B.bamboo || below === B.sand || below === B.gravel || below === B.red_sand)))) return [];
      if (d.name === 'cactus' && !(below === B.sand || below === B.red_sand || below === B.cactus)) return [];
      if (d.name === 'sugar_cane') {
        if (below !== B.sugar_cane) {
          if (!below || !/^(grass_block|dirt|coarse_dirt|podzol|mycelium|rooted_dirt|moss_block|mud|sand|red_sand|suspicious_sand|pale_moss_block)$/.test(BLOCKS[below].name)) return [];
          let wet = false;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = sim.get(x + dx, y - 1, z + dz); if (FLUID[n] === 1 || (n && BLOCKS[n].waterlogged)) wet = true; }
          if (!wet) return [];
        }
      }
    }
    // bamboo stands up
    return list.map(e => (e[3] === B.bamboo ? [e[0], e[1], e[2], e[3], 4] : e));
  });

  /* ---- things in the hand ---- */
  const prev = sim.useItem;
  sim.useItem = (held, hit, heldId, sneaking) => {
    if (prev && prev(held, hit, heldId, sneaking)) return true;
    if (/_hoe$/.test(held)) return till(sim, hit);
    if (held === 'bone_meal') return boneMeal(sim, hit.x, hit.y, hit.z);
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
  if (n === 'cocoa') { const age = (m >> 3) & 3; if (age >= 2) return false; sim.set(x, y, z, b, (m & 7) | ((age + 1) << 3)); return true; }
  if (n === 'bamboo' || n === 'bamboo_sapling') {
    let top = y; while (sim.get(x, top + 1, z) === B.bamboo) top++;
    let h = 0; while (sim.get(x, y - h - 1, z) === B.bamboo) h++;
    const grow = between(sim, 1, 2);
    let made = false;
    for (let i = 0; i < grow; i++) {
      const total = top - y + h + 1;
      if (total >= 16 || sim.get(x, top + 1, z)) break;
      sim.set(x, top + 1, z, B.bamboo, 4); top++; made = true;
    }
    return made;
  }
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
