/* ---------------------------------------------------------------------------
   The first Leoncraft's terrain (legacy/minecraft.html), made here exactly as
   it makes it, for worlds brought over from it (lc1convert.js): the same seed
   gives the same chunk, block for block. Its noise, its terrain height, its
   biomes, ores and caves, its water, its trees and its Nether are copied
   from minecraft.html (makeNoise, terrainHeight, biomeAt, growTree,
   Chunk.generate, oreOrStone, genNether and the rest) and must stay as they
   are there.

   A chunk is a Uint16Array of the first Leoncraft's own block ids (its
   STABLE_BLOCK_NAMES, the index plus one, 0 air), 16 x 16 x 144, at
   (y * 16 + z) * 16 + x, as its Chunk keeps them.

   This file is shared: the same text is at mlhub apps/mc/lc1gen.js (the
   server's import). It has no imports or exports, so a page or a worker
   imports it for what it sets (globalThis.LC1Gen) and Node requires it.
--------------------------------------------------------------------------- */
(function (make) {
  if (typeof module === 'object' && module.exports) module.exports = make();
  else globalThis.LC1Gen = make();
})(function () {
  'use strict';
  const CH = 16, WH = 144, SEA = 30;
  const NETHER_LAVA = 20, NETHER_TOP = 72;
  // the ids the generator puts down (minecraft.html STABLE_BLOCK_NAMES: id = index + 1; a name listed twice keeps the later)
  const ID = {
    grass: 1, dirt: 2, stone: 3, bedrock: 5, sand: 6, oak_log: 8, oak_leaves: 10, coal_ore: 11, iron_ore: 12, gold_ore: 13,
    diamond_ore: 14, redstone_ore: 15, water: 17, snow: 20, netherrack: 23, glowstone: 24, spruce_log: 30, birch_log: 32,
    soul_sand: 114, nether_quartz_ore: 134, spruce_leaves: 142, birch_leaves: 143, lava: 543, crimson_nylium: 547,
    warped_nylium: 548, soul_soil: 546, basalt: 294, blackstone: 288, ancient_debris: 551, magma_block: 545,
    gilded_blackstone: 289, warped_stem: 342, crimson_stem: 340, warped_wart_block: 317, nether_wart_block: 316,
    shroomlight: 318, twisting_vines: 540, weeping_vines: 539, warped_fungus: 550, crimson_fungus: 549, bone_block: 322, fire: 542,
  };

  function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function makeNoise(seed) {
    const p = new Uint8Array(512); const perm = [];
    for (let i = 0; i < 256; i++) perm[i] = i;
    let s = seed >>> 0; const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 255; i > 0; i--) { const j = (rand() * (i + 1)) | 0; [perm[i], perm[j]] = [perm[j], perm[i]]; }
    for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
    const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
    const lerp = (a, b, t) => a + (b - a) * t;
    const grad = (h, x, y) => { const u = (h & 1) ? x : -x, v = (h & 2) ? y : -y; return u + v; };
    function n2(x, y) {
      const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
      x -= Math.floor(x); y -= Math.floor(y);
      const u = fade(x), v = fade(y);
      const A = p[X] + Y, Bb = p[X + 1] + Y;
      return lerp(lerp(grad(p[A], x, y), grad(p[Bb], x - 1, y), u),
        lerp(grad(p[A + 1], x, y - 1), grad(p[Bb + 1], x - 1, y - 1), u), v);
    }
    function n3(x, y, z) { return (n2(x, y + z * 0.37) + n2(y + 31.4, z - x * 0.19)) * 0.5; }
    return { n2, n3 };
  }

  // the generator for one seed (the first Leoncraft always takes it as seed >>> 0)
  function create(seedIn) {
    const seed = seedIn >>> 0;
    const noise = makeNoise(seed);
    const B = Object.assign({}, ID);
    B.log = B.oak_log; B.leaves = B.oak_leaves; B.coal = B.coal_ore; B.iron = B.iron_ore; B.gold = B.gold_ore;
    B.diamond = B.diamond_ore; B.redstone = B.redstone_ore;

    function terrainHeight(x, z) {
      const cont = noise.n2(x * 0.006, z * 0.006);
      const hills = noise.n2(x * 0.02, z * 0.02) * 0.6;
      const rough = noise.n2(x * 0.06, z * 0.06) * 0.25;
      let h = SEA + 2 + (cont * 22 + hills * 10 + rough * 5);
      const mt = noise.n2(x * 0.0035 + 100, z * 0.0035 - 100);
      if (mt > 0.35) h += (mt - 0.35) * 70;
      return Math.max(4, Math.min(WH - 6, Math.round(h)));
    }
    function netherFloor(x, z) {
      const broad = noise.n2(x * 0.0075 + 3100, z * 0.0075 - 3100);
      const hills = noise.n2(x * 0.024 - 900, z * 0.024 + 900);
      const rough = noise.n2(x * 0.06 + 40, z * 0.06 + 40) * 0.35;
      return Math.max(3, Math.min(46, Math.round(24 + broad * 9 + hills * 10 + rough * 6)));
    }
    function netherRoof(x, z) {
      const a = noise.n2(x * 0.028 - 1700, z * 0.028 + 1700);
      return Math.max(46, Math.min(64, Math.round(55 + a * 8)));
    }
    function netherBiome(x, z) {
      const t = noise.n2(x * 0.005 + 1200, z * 0.005 - 1200);
      if (t < -0.42) return 'soul';
      if (t < -0.16) return 'basalt';
      if (t > 0.46) return 'warped';
      if (t > 0.16) return 'crimson';
      return 'waste';
    }
    function biomeAt(x, z) {
      const t = noise.n2(x * 0.004 + 500, z * 0.004 + 500);
      if (t < -0.35) return 'desert';
      if (t > 0.45) return 'snow';
      return 'plains';
    }
    const biomeFor = (cx, cz) => biomeAt(cx * CH + 8, cz * CH + 8);
    const h_here = (x, z) => terrainHeight(x, z);
    function oreOrStone(x, y, z) {
      const n = noise.n3(x * 0.09 + seed * 0.01, y * 0.09, z * 0.09);
      if (y < 14 && n > 0.72) return B.diamond;
      if (y < 24 && n > 0.66) return B.gold;
      if (n > 0.62) return B.redstone;
      if (n > 0.55) return B.iron;
      if (n > 0.48) return B.coal;
      const c = noise.n3(x * 0.055 - 99, y * 0.09, z * 0.055 + 99);
      if (c > 0.62 && y > 2 && y < h_here(x, z) - 2) return 0;
      return B.stone;
    }
    // the generator's three trees (oak, birch, spruce: the only kinds a chunk grows), growTree's shapes for them
    function growTree(kind, x, y, z, r, put) {
      const log = B[kind + '_log'] || B.log;
      const leaf = B[kind + '_leaves'] || B.leaves;
      const ri = n => (r() * n) | 0;
      const leafAt = (px, py, pz) => put(px, py, pz, leaf, true);
      const logAt = (px, py, pz) => put(px, py, pz, log, false);
      const plate = (cx, cy, cz, rad, keep) => {
        for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
          const ax = Math.abs(dx), az = Math.abs(dz);
          if (rad > 0 && ax === rad && az === rad && r() >= keep) continue;
          if (rad >= 3 && ax + az > rad + 1) continue;
          leafAt(cx + dx, cy, cz + dz);
        }
      };
      if (kind === 'oak' || kind === 'birch') {
        const h = (kind === 'birch' ? 5 : 4) + ri(3), top = y + h - 1;
        for (let i = 0; i < h; i++) logAt(x, y + i, z);
        plate(x, top - 2, z, 2, 0.2); plate(x, top - 1, z, 2, 0.2);
        plate(x, top, z, 1, 1); plate(x, top + 1, z, 1, 0);
        return;
      }
      // spruce
      const h = 6 + ri(4), top = y + h - 1;
      for (let i = 0; i < h; i++) logAt(x, y + i, z);
      leafAt(x, top + 1, z);
      for (let yy = top; yy >= y + 2; yy--) {
        const d = top - yy;
        const rad = Math.min(2, 1 + ((d / 2) | 0));
        plate(x, yy, z, rad, d % 2 === 0 ? 0.15 : 0.7);
      }
    }

    const idx = (x, y, z) => (y * CH + z) * CH + x;
    // an Overworld chunk (Chunk.generate, without anybody's builds)
    function chunk(cx, cz) {
      const data = new Uint16Array(CH * CH * WH);
      const get = (x, y, z) => (y < 0 || y >= WH ? 0 : data[idx(x, y, z)]);
      const set = (x, y, z, v) => { data[idx(x, y, z)] = v; };
      for (let x = 0; x < CH; x++) for (let z = 0; z < CH; z++) {
        const wx = cx * CH + x, wz = cz * CH + z;
        const h = terrainHeight(wx, wz);
        const biome = biomeAt(wx, wz);
        for (let y = 0; y <= Math.max(h, SEA); y++) {
          let b = 0;
          if (y === 0) b = B.bedrock;
          else if (y < h - 4) b = oreOrStone(wx, y, wz);
          else if (y < h) b = (biome === 'desert') ? B.sand : B.dirt;
          else if (y === h) {
            if (biome === 'desert') b = B.sand;
            else if (biome === 'snow') b = B.snow;
            else b = (h <= SEA + 1) ? B.sand : B.grass;
          } else if (y <= SEA) b = 0;
          if (b !== 0) set(x, y, z, b);
        }
        if (h < SEA) for (let y = h + 1; y <= SEA; y++) if (get(x, y, z) === 0) set(x, y, z, B.water);
      }
      const r = rng((cx * 73856093 ^ cz * 19349663) >>> 0);
      const nTrees = (biomeFor(cx, cz) === 'desert') ? 0 : (2 + (r() * 4 | 0));
      for (let i = 0; i < nTrees; i++) {
        const x = 2 + (r() * (CH - 4) | 0), z = 2 + (r() * (CH - 4) | 0);
        const wx = cx * CH + x, wz = cz * CH + z, h = terrainHeight(wx, wz);
        if (h > SEA && get(x, h, z) === B.grass) {
          const kind = (biomeFor(cx, cz) === 'snow') ? 'spruce' : (r() < 0.18 ? 'birch' : 'oak');
          growTree(kind, x, h + 1, z, r, (px, py, pz, id, soft) => {
            if (px < 0 || px >= CH || pz < 0 || pz >= CH || py < 0 || py >= WH) return;
            if (soft && get(px, py, pz) !== 0) return;
            set(px, py, pz, id);
          });
        }
      }
      return data;
    }

    // a Nether chunk (Chunk.genNether)
    function nether(cx, cz) {
      const data = new Uint16Array(CH * CH * WH);
      const get = (x, y, z) => (y < 0 || y >= WH ? 0 : data[idx(x, y, z)]);
      const set = (x, y, z, v) => { data[idx(x, y, z)] = v; };
      const r = rng((cx * 2654435761 ^ cz * 40503 ^ 0x9e37) >>> 0);
      for (let x = 0; x < CH; x++) for (let z = 0; z < CH; z++) {
        const wx = cx * CH + x, wz = cz * CH + z;
        const floor = netherFloor(wx, wz), roof = netherRoof(wx, wz), bio = netherBiome(wx, wz);
        const cap = Math.min(WH, NETHER_TOP);
        for (let y = 0; y < cap; y++) {
          let b = 0;
          if (y === 0 || y === cap - 1) b = B.bedrock;
          else if (y <= floor) b = netherStrata(wx, y, wz, floor, bio);
          else if (y >= roof) b = B.netherrack;
          else if (y <= NETHER_LAVA) b = B.lava;
          if (b !== 0) set(x, y, z, b);
        }
        if (r() < 0.012) {
          const gy = roof - 1;
          for (let dy = 0; dy < 2 + ((r() * 3) | 0); dy++) { const py = gy - dy; if (py > NETHER_LAVA && get(x, py, z) === 0) set(x, py, z, B.glowstone); }
        }
      }
      // netherDeco
      const put = (x, y, z, b) => { if (x >= 0 && x < CH && z >= 0 && z < CH && y > 0 && y < WH - 1 && get(x, y, z) === 0) set(x, y, z, b); };
      const n = 5 + ((r() * 7) | 0);
      for (let i = 0; i < n; i++) {
        const x = 1 + ((r() * (CH - 2)) | 0), z = 1 + ((r() * (CH - 2)) | 0);
        const wx = cx * CH + x, wz = cz * CH + z;
        const floor = netherFloor(wx, wz), roof = netherRoof(wx, wz), bio = netherBiome(wx, wz);
        const gy = floor + 1;
        if (gy <= NETHER_LAVA + 1 || gy >= roof - 1) continue;
        if (bio === 'crimson' || bio === 'warped') {
          const warped = bio === 'warped';
          if (r() < 0.45) {
            const h = 3 + ((r() * 4) | 0), stem = warped ? B.warped_stem : B.crimson_stem, cap = warped ? B.warped_wart_block : B.nether_wart_block;
            if (gy + h + 2 >= roof) continue;
            for (let d = 0; d < h; d++) put(x, gy + d, z, stem);
            const top = gy + h;
            for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
              if (Math.abs(dx) + Math.abs(dz) > 2) continue;
              put(x + dx, top, z + dz, r() < 0.16 ? B.shroomlight : cap);
              if ((dx || dz) && r() < 0.4) {
                const vine = warped ? B.twisting_vines : B.weeping_vines;
                if (warped) { for (let d = 0; d < 1 + ((r() * 3) | 0); d++) put(x + dx, gy + d, z + dz, vine); }
                else { for (let d = 1; d <= 1 + ((r() * 3) | 0); d++) put(x + dx, top - d, z + dz, vine); }
              }
            }
          } else put(x, gy, z, warped ? B.warped_fungus : B.crimson_fungus);
        } else if (bio === 'soul') {
          if (r() < 0.3) { const h = 2 + ((r() * 3) | 0); for (let d = 0; d < h; d++) put(x, gy + d, z, B.bone_block); }
          else if (r() < 0.35) put(x, gy, z, B.fire);
        } else if (bio === 'basalt') {
          const h = 2 + ((r() * 6) | 0);
          for (let d = 0; d < h && gy + d < roof - 1; d++) put(x, gy + d, z, B.basalt);
        } else if (r() < 0.2) put(x, gy, z, B.fire);
      }
      return data;
    }
    function netherStrata(wx, y, wz, floor, bio) {
      if (y === floor) {
        if (bio === 'crimson') return B.crimson_nylium;
        if (bio === 'warped') return B.warped_nylium;
        if (bio === 'soul') return (noise.n2(wx * 0.09, wz * 0.09) > 0 ? B.soul_sand : B.soul_soil);
        if (bio === 'basalt') return (noise.n2(wx * 0.11 + 7, wz * 0.11 - 7) > 0.1 ? B.basalt : B.blackstone);
        return B.netherrack;
      }
      const n = noise.n3(wx * 0.11 + seed * 0.01, y * 0.11, wz * 0.11);
      if (y < 12 && n > 0.80) return B.ancient_debris;
      if (n > 0.70) return B.nether_quartz_ore;
      if (n < -0.74) return B.magma_block;
      if (bio === 'soul' && y > floor - 3) return B.soul_soil;
      if (bio === 'basalt' && y > floor - 4) return B.blackstone;
      if (bio === 'basalt' && n > 0.55) return B.gilded_blackstone;
      return B.netherrack;
    }
    return { seed, chunk, nether, terrainHeight, biomeAt, netherBiome, netherFloor, netherRoof };
  }
  return { CH, WH, SEA, NETHER_LAVA, NETHER_TOP, create, makeNoise, rng };
});
