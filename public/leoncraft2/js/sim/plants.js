/* ---------------------------------------------------------------------------
   Leoncraft 2 - what grows, spreads, decays and melts on random ticks.

   The game's own rules (Minecraft Wiki, Java Edition), block by block:

   grass, mycelium  turn back to dirt under a block that stops all light or
                    under water; with light 9 or more above, four tries to
                    spread to dirt within 3x5x3 (one up, three down) that
                    could itself be grass
   leaves           decay when more than 6 steps (through leaves) from a log,
                    unless a player put them there; drop a sapling 1 in 20
                    (jungle 1 in 40), sticks 1 in 50, an apple 1 in 200 (oak)
   crops            on farmland, with raw light 9: a 1 in (25 / speed + 1)
                    chance to age, speed counting farmland (wet 3, dry 1,
                    the eight around a quarter as much), halved when the same
                    crop crowds it in rows both ways or on a diagonal;
                    beetroot only two ticks in three
   stems            the same, then a melon or pumpkin beside them
   saplings         light 9 above and 1 in 7: stage 1, then the tree
   sugar cane, cactus  up to three tall, a block every 16 ticks of age
   bamboo           1 in 3, light 9, up to 16 tall (the top may stop from 11)
   kelp             14% a tick, up to age 25, into water sources
   vines            hold on by their faces (models.js vineFaces): a face goes
                    when what held it goes, and the vine with its last face
                    (and then whatever hung from that); 1 in 4 a random tick,
                    a random way: sideways onto a block, round a corner or
                    along a wall, up a wall or under the block above, down
                    with some of its sides; at most four in a 9x3x9 to
                    spread sideways or up
   cocoa 1 in 5, sweet berries 1 in 5 (light 9), nether wart 1 in 10
   farmland         wet (7) with water within 4 across and 1 up, or rain on
                    it; otherwise dries a step, and with nothing planted on
                    it at 0 turns back to dirt
   ice              melts in block light over 10; snow layers over 11
   copper           ages a stage now and then (5.7% a tick, less beside
                    copper that is younger)
   mushrooms        1 in 25, spread if fewer than five round them, in the dark
--------------------------------------------------------------------------- */
import { B, BLOCKS, FLUID } from '../blocks.js?v=107';
import { Gen } from '../worldgen.js?v=107';
import { randomTick as bambooTick, bambooMeta, SMALL as BAMBOO_SMALL } from './bamboo.js?v=107';
import { rng } from '../noise.js?v=107';
import { LEVEL, FALLING } from '../world-const.js?v=107';
import { vineFaces, vineHolds, VINE_SIDES, VINE_UP, multiFaces, MULTI_DIRS } from '../models.js?v=107';

const HORIZ = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const R = sim => sim.rng();
const RI = (sim, n) => Math.floor(sim.rng() * n);

export const PERSISTENT = 128;

const isAir = (sim, x, y, z) => { const b = sim.get(x, y, z); return !b || BLOCKS[b].name === 'cave_air' || BLOCKS[b].name === 'void_air'; };
const opaqueCube = b => b && BLOCKS[b].shape === 'cube' && BLOCKS[b].pass === 'opaque';
const DIRT = new Set(['dirt', 'grass_block', 'podzol', 'coarse_dirt', 'mycelium', 'rooted_dirt', 'moss_block', 'mud', 'muddy_mangrove_roots', 'pale_moss_block']);
export const isDirt = b => b && DIRT.has(BLOCKS[b].name);

export function installPlants(sim) {
  /* ---- grass and mycelium ---- */
  const canBeGrass = (x, y, z) => {
    const a = sim.get(x, y + 1, z);
    if (!a) return true;
    const d = BLOCKS[a];
    if (d.name === 'snow' && (sim.meta(x, y + 1, z) & 7) === 0) return true;
    if (FLUID[a] === 1 && ((sim.meta(x, y + 1, z) & LEVEL) === 0 || (sim.meta(x, y + 1, z) & FALLING))) return false;   // a full block of water
    if (d.waterlogged) return false;
    return d.opacity < 15;
  };
  const canPropagate = (x, y, z) => canBeGrass(x, y, z) && FLUID[sim.get(x, y + 1, z)] !== 1;
  const spreading = (self) => ({
    random(s, x, y, z) {
      if (!canBeGrass(x, y, z)) { s.set(x, y, z, B.dirt, 0); return; }
      if (s.brightness(x, y + 1, z) < 9) return;
      for (let i = 0; i < 4; i++) {
        const tx = x + RI(s, 3) - 1, ty = y + RI(s, 5) - 3, tz = z + RI(s, 3) - 1;
        if (s.get(tx, ty, tz) === B.dirt && s.meta(tx, ty, tz) === 0 && canPropagate(tx, ty, tz)) s.set(tx, ty, tz, self, 0);
      }
    },
  });
  sim.on('grass_block', spreading(B.grass_block));
  sim.on('mycelium', spreading(B.mycelium));

  /* ---- leaves ---- */
  const LOGS = new Uint8Array(BLOCKS.length);
  for (const d of BLOCKS) if (d && (d.log || /_(log|wood|hyphae|stem)$/.test(d.name) && !/^(melon|pumpkin|attached)/.test(d.name))) LOGS[d.id] = 1;
  // steps through leaves to the nearest log, 7 if none within 6 (the game's "distance")
  sim.leafDistance = (x, y, z) => {
    const seen = new Set([x + ',' + y + ',' + z]);
    let front = [[x, y, z]];
    for (let d = 1; d <= 6; d++) {
      const next = [];
      for (const [cx, cy, cz] of front) for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const nx = cx + dx, ny = cy + dy, nz = cz + dz, k = nx + ',' + ny + ',' + nz;
        if (seen.has(k)) continue;
        seen.add(k);
        const b = sim.get(nx, ny, nz);
        if (LOGS[b]) return d;
        if (b && BLOCKS[b].leaves) next.push([nx, ny, nz]);
      }
      front = next;
      if (!front.length) break;
    }
    return 7;
  };
  /* Generated trees are not all built to the game's distance rule (a few
     spruce leaves sit 7 from the trunk), so decay waits for a log to have
     been taken away within reach: that is when the game's leaves start to go. */
  sim.LOGS = LOGS;
  sim.logsGone = new Map();          // "cx,cz" -> [[x, y, z], ...] logs broken or burnt this visit
  sim.logGoneNear = (x, y, z) => {
    for (const k of [Math.floor((x - 7) / 16) + ',' + Math.floor((z - 7) / 16), Math.floor((x + 7) / 16) + ',' + Math.floor((z - 7) / 16),
      Math.floor((x - 7) / 16) + ',' + Math.floor((z + 7) / 16), Math.floor((x + 7) / 16) + ',' + Math.floor((z + 7) / 16)]) {
      const l = sim.logsGone.get(k);
      if (l) for (const [lx, ly, lz] of l) if (Math.abs(lx - x) <= 7 && Math.abs(ly - y) <= 7 && Math.abs(lz - z) <= 7) return true;
    }
    return false;
  };
  sim.onAll(d => d.leaves, {
    random(s, x, y, z, m) {
      if (m & PERSISTENT) return;
      if (!s.logGoneNear(x, y, z)) return;
      if (!s.w.loaded(x + 7, z + 7) || !s.w.loaded(x - 7, z - 7) || !s.w.loaded(x + 7, z - 7) || !s.w.loaded(x - 7, z + 7)) return;
      if (s.leafDistance(x, y, z) >= 7) s.destroy(x, y, z);
    },
    loot(s, b, m, tool) {
      const n = BLOCKS[b].name, out = [];
      if (tool === 'shears') return [[n, 1]];
      const sap = { oak_leaves: 'oak_sapling', spruce_leaves: 'spruce_sapling', birch_leaves: 'birch_sapling', jungle_leaves: 'jungle_sapling',
        acacia_leaves: 'acacia_sapling', dark_oak_leaves: 'dark_oak_sapling', cherry_leaves: 'cherry_sapling', pale_oak_leaves: 'pale_oak_sapling',
        azalea_leaves: 'azalea', flowering_azalea_leaves: 'flowering_azalea' }[n];
      if (sap && R(s) < (n === 'jungle_leaves' ? 1 / 40 : 1 / 20)) out.push([sap, 1]);
      if (R(s) < 0.02) out.push(['stick', 1 + RI(s, 2)]);
      if ((n === 'oak_leaves' || n === 'dark_oak_leaves') && R(s) < 0.005) out.push(['apple', 1]);
      return out;
    },
  });
  // leaves a player puts down never decay
  (sim.placers = sim.placers || []).push(list => list.map(e => (BLOCKS[e[3]] && BLOCKS[e[3]].leaves ? [e[0], e[1], e[2], e[3], e[4] | PERSISTENT] : e)));

  /* ---- crops ---- */
  sim.growthSpeed = (x, y, z, self) => {
    let f = 1;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      let f1 = 0;
      if (sim.get(x + dx, y - 1, z + dz) === B.farmland) { f1 = 1; if (sim.meta(x + dx, y - 1, z + dz) & 7) f1 = 3; }
      if (dx || dz) f1 /= 4;
      f += f1;
    }
    const at = (dx, dz) => sim.get(x + dx, y, z + dz) === self;
    const rowX = at(-1, 0) || at(1, 0), rowZ = at(0, -1) || at(0, 1);
    if (rowX && rowZ) f /= 2;
    else if (at(-1, -1) || at(1, -1) || at(1, 1) || at(-1, 1)) f /= 2;
    return f;
  };
  const cropSurvives = (x, y, z) => sim.get(x, y - 1, z) === B.farmland && (sim.brightness(x, y, z, 0) >= 8 || sim.canSeeSky(x, y, z));
  const crop = (name, max) => ({
    random(s, x, y, z, m) {
      if (name === 'beetroots' && RI(s, 3) === 0) return;
      if (s.brightness(x, y, z, 0) < 9) return;
      const age = m & 7;
      if (age >= max) return;
      const f = s.growthSpeed(x, y, z, B[name]);
      if (RI(s, Math.floor(25 / f) + 1) === 0) s.set(x, y, z, B[name], age + 1);
    },
    neighbor(s, x, y, z) { if (!cropSurvives(x, y, z)) s.destroy(x, y, z); },
  });
  sim.on('wheat', crop('wheat', 7));
  sim.on('carrots', crop('carrots', 7));
  sim.on('potatoes', crop('potatoes', 7));
  sim.on('beetroots', crop('beetroots', 3));

  /* ---- melon and pumpkin stems ---- */
  for (const [stem, fruit, attached] of [['melon_stem', 'melon', 'attached_melon_stem'], ['pumpkin_stem', 'pumpkin', 'attached_pumpkin_stem']]) {
    sim.on(stem, {
      random(s, x, y, z, m) {
        if (s.brightness(x, y, z, 0) < 9) return;
        const f = s.growthSpeed(x, y, z, B[stem]);
        if (RI(s, Math.floor(25 / f) + 1) !== 0) return;
        const age = m & 7;
        if (age < 7) { s.set(x, y, z, B[stem], age + 1); return; }
        const k = RI(s, 4), [dx, dz] = HORIZ[k];
        const below = s.get(x + dx, y - 1, z + dz);
        if (isAir(s, x + dx, y, z + dz) && (below === B.farmland || isDirt(below))) {
          s.set(x + dx, y, z + dz, B[fruit], 0);
          if (B[attached] !== undefined) s.set(x, y, z, B[attached], k);
        }
      },
      neighbor(s, x, y, z) { if (s.get(x, y - 1, z) !== B.farmland) s.destroy(x, y, z); },
    });
    if (B[attached] !== undefined) sim.on(attached, {
      neighbor(s, x, y, z, m) {
        const [dx, dz] = HORIZ[m & 3];
        if (s.get(x + dx, y, z + dz) !== B[fruit]) s.set(x, y, z, B[stem], 7);
        else if (s.get(x, y - 1, z) !== B.farmland) s.destroy(x, y, z);
      },
    });
  }

  /* ---- sweet berries, nether wart, cocoa ---- */
  sim.on('sweet_berry_bush', {
    random(s, x, y, z, m) { if ((m & 7) < 3 && RI(s, 5) === 0 && s.brightness(x, y + 1, z, 0) >= 9) s.set(x, y, z, B.sweet_berry_bush, (m & 7) + 1); },
  });
  sim.on('nether_wart', {
    random(s, x, y, z, m) { if ((m & 7) < 3 && RI(s, 10) === 0) s.set(x, y, z, B.nether_wart, (m & 7) + 1); },
    neighbor(s, x, y, z) { if (s.get(x, y - 1, z) !== B.soul_sand) s.destroy(x, y, z); },
  });
  sim.on('cocoa', {
    random(s, x, y, z, m) { const age = (m >> 3) & 3; if (age < 2 && RI(s, 5) === 0) s.set(x, y, z, B.cocoa, (m & 7) | ((age + 1) << 3)); },
  });

  /* ---- saplings ---- */
  const SAPLING_TREE = { oak_sapling: 'oak', birch_sapling: 'birch', spruce_sapling: 'spruce', jungle_sapling: 'jungle', acacia_sapling: 'acacia',
    dark_oak_sapling: 'dark_oak', cherry_sapling: 'cherry', pale_oak_sapling: 'dark_oak', mangrove_propagule: 'mangrove' };
  for (const name in SAPLING_TREE) {
    if (B[name] === undefined) continue;
    sim.on(name, {
      random(s, x, y, z, m) {
        if (s.brightness(x, y + 1, z) < 9 || RI(s, 7) !== 0) return;
        if (!(m & 1)) { s.set(x, y, z, B[name], m | 1); return; }
        s.growTree(x, y, z);
      },
      neighbor(s, x, y, z) { const b = s.get(x, y - 1, z); if (!(isDirt(b) || b === B.farmland)) s.destroy(x, y, z); },
    });
  }
  // a 2x2 of the same sapling with this one at some corner: where its north-west corner is
  const square = (x, y, z, b) => {
    for (const [ox, oz] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
      const x0 = x + ox, z0 = z + oz;
      if (sim.get(x0, y, z0) === b && sim.get(x0 + 1, y, z0) === b && sim.get(x0, y, z0 + 1) === b && sim.get(x0 + 1, y, z0 + 1) === b) return [x0, z0];
    }
    return null;
  };
  sim.growTree = (x, y, z) => {
    const b = sim.get(x, y, z), name = BLOCKS[b].name;
    let kind = SAPLING_TREE[name];
    if (!kind) return false;
    let at = [x, z], sq = null;
    if (kind === 'spruce' || kind === 'jungle' || kind === 'dark_oak') sq = square(x, y, z, b);
    if (kind === 'dark_oak' && !sq) return false;              // dark oak only grows from four
    if (sq) { kind = kind === 'spruce' ? 'mega_spruce' : kind === 'jungle' ? 'mega_jungle' : 'dark_oak'; at = sq; }
    else if (kind === 'oak' && R(sim) < 0.1) kind = 'fancy_oak';
    // work it out first: every log must go where a tree may grow (air, leaves, plants, the saplings)
    const r = rng((Math.random() * 4294967296) >>> 0);
    const puts = [];
    const set = (px, py, pz, blk, onlyIfAir) => puts.push([px, py, pz, blk, !!onlyIfAir]);
    try { Gen.prototype.tree.call(null, kind, set, r, at[0], y, at[1]); } catch (e) { console.warn('tree', e); return false; }
    if (!puts.length) return false;
    const free = (px, py, pz) => {
      const c = sim.get(px, py, pz);
      if (!c) return true;
      const d = BLOCKS[c];
      return d.leaves || d.replaceable || d.shape === 'cross' && !d.solid || SAPLING_TREE[d.name] !== undefined;
    };
    for (const [px, py, pz, blk, onlyIfAir] of puts) if (!onlyIfAir && !free(px, py, pz)) return false;
    // the saplings themselves go, then the tree
    if (sq) for (const [a, c] of [[0, 0], [1, 0], [0, 1], [1, 1]]) sim.set(at[0] + a, y, at[1] + c, 0, 0);
    else sim.set(x, y, z, 0, 0);
    for (const [px, py, pz, blk, onlyIfAir] of puts) {
      const c = sim.get(px, py, pz);
      if (onlyIfAir ? c && !BLOCKS[c].replaceable : !free(px, py, pz)) continue;
      sim.set(px, py, pz, blk, 0);
    }
    // dirt under the trunk, as the game puts it (grass under a tree becomes dirt)
    const under = sim.get(at[0], y - 1, at[1]);
    if (under === B.grass_block) sim.set(at[0], y - 1, at[1], B.dirt, 0);
    return true;
  };

  /* ---- sugar cane and cactus ---- */
  const tall = (name, survives) => ({
    random(s, x, y, z, m) {
      if (!isAir(s, x, y + 1, z)) return;
      let h = 1;
      while (s.get(x, y - h, z) === B[name]) h++;
      if (h >= 3) return;
      const age = m & 15;
      if (age === 15) {
        s.set(x, y + 1, z, B[name], 0);
        s.set(x, y, z, B[name], 0);
        if (!survives(s, x, y + 1, z)) s.destroy(x, y + 1, z);
      } else s.set(x, y, z, B[name], age + 1);
    },
    neighbor(s, x, y, z) { if (!survives(s, x, y, z)) s.schedule(x, y, z, 1); },
    tick(s, x, y, z) { if (!survives(s, x, y, z)) s.destroy(x, y, z); },
  });
  const CANE_ON = new Set(['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'mycelium', 'rooted_dirt', 'moss_block', 'mud', 'sand', 'red_sand', 'suspicious_sand', 'pale_moss_block']);
  const caneSurvives = (s, x, y, z) => {
    const below = s.get(x, y - 1, z);
    if (below === B.sugar_cane) return true;
    if (!below || !CANE_ON.has(BLOCKS[below].name)) return false;
    for (const [dx, dz] of HORIZ) { const n = s.get(x + dx, y - 1, z + dz); if (FLUID[n] === 1 || (n && BLOCKS[n].waterlogged) || n === B.frosted_ice) return true; }
    return false;
  };
  sim.on('sugar_cane', tall('sugar_cane', caneSurvives));
  const cactusSurvives = (s, x, y, z) => {
    for (const [dx, dz] of HORIZ) { const n = s.get(x + dx, y, z + dz); if (n && (BLOCKS[n].solid || FLUID[n] === 2)) return false; }
    const below = s.get(x, y - 1, z);
    const above = s.get(x, y + 1, z);
    if (above && FLUID[above]) return false;
    return below === B.cactus || below === B.sand || below === B.red_sand || below === B.suspicious_sand;
  };
  sim.on('cactus', tall('cactus', cactusSurvives));

  /* ---- bamboo ---- */
  // (sim/bamboo.js: the game's growBamboo, leaves and thickness)
  if (B.bamboo !== undefined) sim.on('bamboo', {
    random(s, x, y, z, m) {
      if (m & 8) return;
      bambooTick(s, x, y, z, m, () => R(s), isAir(s, x, y + 1, z), s.brightness(x, y + 1, z, 0));
    },
  });
  // a sapling puts a thin stalk with small leaves on itself and turns into bamboo under it
  if (B.bamboo_sapling !== undefined) sim.on('bamboo_sapling', {
    random(s, x, y, z) {
      if (RI(s, 3) !== 0 || !isAir(s, x, y + 1, z) || s.brightness(x, y + 1, z, 0) < 9) return;
      s.set(x, y, z, B.bamboo, 0);
      s.set(x, y + 1, z, B.bamboo, bambooMeta(0, BAMBOO_SMALL, 0));
    },
  });

  /* ---- kelp ---- */
  if (B.kelp !== undefined) sim.on('kelp', {
    random(s, x, y, z, m) {
      const age = m & 31;
      if (age >= 25 || R(s) >= 0.14) return;
      const a = s.get(x, y + 1, z);
      if (FLUID[a] !== 1 || (s.meta(x, y + 1, z) & (LEVEL | FALLING))) return;
      s.set(x, y + 1, z, B.kelp, age + 1);
      s.set(x, y, z, B.kelp_plant, 0);
    },
  });

  /* ---- vines ---- */
  if (B.vine !== undefined) {
    const V = B.vine;
    const at = (x, y, z) => (dx, dy, dz) => { const b = sim.get(x + dx, y + dy, z + dz); return b ? { d: BLOCKS[b], m: sim.meta(x + dx, y + dy, z + dz) } : null; };
    // (a column not loaded is taken to hold: the vine on the edge of the loaded world is left as it is)
    const holds = (x, y, z) => { if (!sim.w.loaded(x, z)) return true; const b = sim.get(x, y, z); return !!b && vineHolds({ d: BLOCKS[b] }); };
    const facesAt = (x, y, z) => vineFaces(sim.meta(x, y, z), at(x, y, z));
    // the faces that still hold: a side by its block or the same side of the vine above, the top by the block above
    const holding = (x, y, z, f) => {
      const above = sim.get(x, y + 1, z) === V ? facesAt(x, y + 1, z) : 0;
      let k = 0;
      for (const [dx, dz, bit] of VINE_SIDES) if ((f & bit) && (holds(x + dx, y, z + dz) || (above & bit))) k |= bit;
      if ((f & VINE_UP) && holds(x, y + 1, z)) k |= VINE_UP;
      return k;
    };
    // room to spread: fewer than five vines in the 9x3x9 round it (itself counted)
    const room = (x, y, z) => {
      let n = 0;
      for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) for (let dy = -1; dy <= 1; dy++) if (sim.get(x + dx, y + dy, z + dz) === V && ++n >= 5) return false;
      return true;
    };
    const air = (x, y, z) => isAir(sim, x, y, z);
    sim.on('vine', {
      neighbor(s, x, y, z, m) {
        const f = facesAt(x, y, z), k = holding(x, y, z, f);
        if (!k) { s.destroy(x, y, z, false); return; }
        if (k !== (m & 31)) s.set(x, y, z, V, k);
      },
      random(s, x, y, z) {
        // (one the world was made with that holds on to nothing, its block over a chunk's edge, goes when it is next
        // looked at: the game would leave it until something changed beside it)
        if (!holding(x, y, z, facesAt(x, y, z))) { s.destroy(x, y, z, false); return; }
        if (RI(s, 4) !== 0) return;
        const f = facesAt(x, y, z), dir = RI(s, 6);        // 0-3 north, east, south, west; 4 up; 5 down
        if (dir < 4) {
          const [dx, dz, bit] = VINE_SIDES[dir];
          if ((f & bit) || !room(x, y, z)) return;
          const sx = x + dx, sz = z + dz;
          if (air(sx, y, sz)) {
            // into the air beside it: along the wall it is on, round the corner of it, or (rarely) under a block above
            const cw = VINE_SIDES[(dir + 1) & 3], ccw = VINE_SIDES[(dir + 3) & 3], back = VINE_SIDES[(dir + 2) & 3][2];
            if ((f & cw[2]) && holds(sx + cw[0], y, sz + cw[1])) s.set(sx, y, sz, V, cw[2]);
            else if ((f & ccw[2]) && holds(sx + ccw[0], y, sz + ccw[1])) s.set(sx, y, sz, V, ccw[2]);
            else if ((f & cw[2]) && air(sx + cw[0], y, sz + cw[1]) && holds(x + cw[0], y, z + cw[1])) s.set(sx + cw[0], y, sz + cw[1], V, back);
            else if ((f & ccw[2]) && air(sx + ccw[0], y, sz + ccw[1]) && holds(x + ccw[0], y, z + ccw[1])) s.set(sx + ccw[0], y, sz + ccw[1], V, back);
            else if (R(s) < 0.05 && holds(sx, y + 1, sz)) s.set(sx, y, sz, V, VINE_UP);
          } else if (holds(sx, y, sz)) s.set(x, y, z, V, f | bit);
          return;
        }
        if (dir === 4) {
          // up: under the block above if it holds, or a vine above with the sides that have a wall there
          if (holds(x, y + 1, z)) { if (!(f & VINE_UP)) s.set(x, y, z, V, f | VINE_UP); return; }
          if (air(x, y + 1, z)) {
            if (!room(x, y, z)) return;
            let k = f & 15;
            for (const [dx, dz, bit] of VINE_SIDES) if (R(s) < 0.5 || !holds(x + dx, y + 1, z + dz)) k &= ~bit;
            if (k) s.set(x, y + 1, z, V, k);
            return;
          }
        }
        // down (or up with no way up): some of its sides into the air or the vine below
        const b = s.get(x, y - 1, z);
        if (!(b === V || air(x, y - 1, z))) return;
        const cur = b === V ? facesAt(x, y - 1, z) : 0;
        let k = cur;
        for (const [, , bit] of VINE_SIDES) if (R(s) < 0.5 && (f & bit)) k |= bit;
        if (k !== cur && (k & 15)) s.set(x, y - 1, z, V, k);
      },
    });
  }

  /* ---- glow lichen, sculk veins, resin clumps: each face holds while the block that way is whole; with none
     left the block goes (models.js multiFaces) ---- */
  for (const n of ['glow_lichen', 'sculk_vein', 'resin_clump']) {
    const id = B[n];
    if (id === undefined) continue;
    sim.on(id, {
      neighbor(s, x, y, z, m) {
        const nb = (dx, dy, dz) => { const b = s.get(x + dx, y + dy, z + dz); return b ? { d: BLOCKS[b], m: 0 } : null; };
        const f = multiFaces(m, nb);
        let k = 0;
        for (let i = 0; i < 6; i++) {
          if (!(f & (1 << i))) continue;
          const [dx, dy, dz] = MULTI_DIRS[i];
          if (!s.w.loaded(x + dx, z + dz) || vineHolds(nb(dx, dy, dz))) k |= 1 << i;
        }
        if (!k) { s.destroy(x, y, z, false); return; }
        if (k !== (m & 63)) s.set(x, y, z, id, k);
      },
    });
  }

  /* ---- what hangs from the block above (cave vines, weeping vines, hanging roots, spore blossoms, pale hanging
     moss) or grows up from the one below (twisting vines): left with nothing to hold, it goes a tick later as if
     broken, and so the next one along a tick after that; a stem left at the end of its vine becomes the vine's
     tip (the game's growing plants) ---- */
  {
    const whole = b => !!b && BLOCKS[b].solid && BLOCKS[b].shape === 'cube';
    // (drops: their own, so a cave vine with glow berries on it lets one fall: loot.js)
    const gone = (holds, drops) => ({
      neighbor(s, x, y, z) { if (!holds(s, x, y, z)) s.schedule(x, y, z, 1); },
      tick(s, x, y, z) { if (!holds(s, x, y, z)) s.destroy(x, y, z, drops); },
    });
    for (const [head, body, dir] of [['cave_vines', 'cave_vines_plant', 1], ['weeping_vines', 'weeping_vines_plant', 1], ['twisting_vines', 'twisting_vines_plant', -1]]) {
      const Hd = B[head], Bd = B[body];
      if (Hd === undefined || Bd === undefined) continue;
      const holds = (s, x, y, z) => { const a = s.get(x, y + dir, z); return a === Hd || a === Bd || whole(a); };
      const h = gone(holds);
      sim.on(Hd, h);
      sim.on(Bd, {
        neighbor(s, x, y, z) {
          if (!holds(s, x, y, z)) { s.schedule(x, y, z, 1); return; }
          const n = s.get(x, y - dir, z);
          // (a cave vine keeps its berries)
          if (n !== Hd && n !== Bd) s.set(x, y, z, Hd, head === 'cave_vines' ? s.meta(x, y, z) & 1 : 0);
        },
        tick: h.tick,
      });
    }
    /* cave vines (the game's CaveVinesBlock): glow berries picked by hand, one berry and the vine stays; the
       tip grows a block down on one random tick in ten while its age is under 25, into air only, the new tip
       with berries 11 times in 100 and the old one a stem that keeps its own */
    const CV = B.cave_vines, CP = B.cave_vines_plant;
    if (CV !== undefined && CP !== undefined) {
      const pick = {
        use(s, x, y, z, m) {
          if (!(m & 1)) return false;
          s.dropItem(x + 0.5, y + 0.5, z + 0.5, 'glow_berries', 1);
          s.set(x, y, z, s.get(x, y, z), m & ~1);
          return true;
        },
      };
      sim.on(CP, pick);
      sim.on(CV, Object.assign({
        random(s, x, y, z, m) {
          const age = (m >> 1) & 31;
          if (age >= 25 || s.rng() >= 0.1 || y < 1 || s.get(x, y - 1, z)) return;
          s.set(x, y - 1, z, CV, ((age + 1) << 1) | (s.rng() < 0.11 ? 1 : 0));
          s.set(x, y, z, CP, m & 1);
        },
      }, pick));
    }
    // (roots and a spore blossom go in the same tick, as the game turns them to air when the block above changes;
    // pale moss waits its tick as the vines do)
    for (const n of ['hanging_roots', 'spore_blossom', 'pale_hanging_moss']) {
      const id = B[n];
      if (id === undefined) continue;
      const holds = (s, x, y, z) => { const a = s.get(x, y + 1, z); return whole(a) || (n === 'pale_hanging_moss' && a === id); };
      if (n === 'pale_hanging_moss') sim.on(id, gone(holds));
      else sim.on(id, { neighbor(s, x, y, z) { if (!holds(s, x, y, z)) s.destroy(x, y, z); } });
    }
  }

  /* ---- ice and snow in the light ---- */
  sim.on('ice', {
    random(s, x, y, z) {
      if (s.blockLight(x, y, z) <= 10) return;
      if (/nether$/.test(s.dimension())) { s.set(x, y, z, 0, 0); return; }
      s.set(x, y, z, B.water, 0);
      s.fluids && s.fluids.around(x, y, z);
    },
  });
  sim.on('snow', {
    random(s, x, y, z) { if (s.blockLight(x, y, z) > 11) s.destroy(x, y, z); },
    neighbor(s, x, y, z) {
      const b = s.get(x, y - 1, z);
      if (!b || !BLOCKS[b].solid && !BLOCKS[b].leaves && b !== B.snow) s.destroy(x, y, z, false);
    },
    loot(s, b, m) { return [['snowball', (m & 7) + 1]]; },
  });

  /* ---- farmland ---- */
  const KEEPS = new Set(['wheat', 'carrots', 'potatoes', 'beetroots', 'melon_stem', 'pumpkin_stem', 'attached_melon_stem', 'attached_pumpkin_stem', 'torchflower_crop', 'pitcher_crop']);
  const nearWater = (x, y, z) => {
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) for (let dy = 0; dy <= 1; dy++) {
      const b = sim.get(x + dx, y + dy, z + dz);
      if (FLUID[b] === 1 || (b && BLOCKS[b].waterlogged)) return true;
    }
    return false;
  };
  sim.farmlandWet = nearWater;
  sim.toDirt = (x, y, z) => {
    sim.set(x, y, z, B.dirt, 0);
    // anything standing on it is pushed up out of the way in the game; a crop just pops
  };
  sim.on('farmland', {
    random(s, x, y, z, m) {
      const moist = m & 7;
      if (nearWater(x, y, z) || s.weather.rainingAt(x, y + 1, z)) { if (moist < 7) s.set(x, y, z, B.farmland, 7); return; }
      if (moist > 0) { s.set(x, y, z, B.farmland, moist - 1); return; }
      const a = s.get(x, y + 1, z);
      if (!(a && KEEPS.has(BLOCKS[a].name))) s.toDirt(x, y, z);
    },
    neighbor(s, x, y, z) {
      const a = s.get(x, y + 1, z);
      if (a && BLOCKS[a].solid && BLOCKS[a].shape !== 'gate' && BLOCKS[a].name !== 'moving_piston') s.toDirt(x, y, z);
    },
    loot() { return [['dirt', 1]]; },
  });

  /* ---- copper ageing ---- */
  const AGES = ['', 'exposed_', 'weathered_', 'oxidized_'];
  const copperStage = new Map();     // id -> [stage, family key]
  for (const d of BLOCKS) {
    if (!d || /^waxed_/.test(d.name) || !/copper/.test(d.name) || /ore$|^raw_/.test(d.name)) continue;
    let st = 0, fam = d.name;
    for (let i = 3; i >= 1; i--) if (d.name.startsWith(AGES[i])) { st = i; fam = d.name.slice(AGES[i].length); break; }
    if (fam === 'copper_block') fam = 'copper';
    copperStage.set(d.id, [st, fam]);
  }
  const copperName = (st, fam) => (st === 0 && fam === 'copper' ? 'copper_block' : AGES[st] + fam);
  for (const [id, [st, fam]] of copperStage) {
    if (st >= 3 || B[copperName(st + 1, fam)] === undefined) continue;
    sim.on(id, {
      random(s, x, y, z, m) {
        if (R(s) >= 0.05688889) return;
        let lower = 0, same = 0, higher = 0;
        for (let dx = -4; dx <= 4; dx++) for (let dy = -4; dy <= 4; dy++) for (let dz = -4; dz <= 4; dz++) {
          const dist = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
          if (dist > 4 || dist === 0) continue;
          const e = copperStage.get(s.get(x + dx, y + dy, z + dz));
          if (!e) continue;
          if (e[0] < st) { lower++; break; }
          if (e[0] > st) higher++; else same++;
        }
        if (lower) return;
        const c = (higher + 1) / (higher + same + 1);
        const chance = c * c * (st === 0 ? 0.75 : 1);
        if (R(s) < chance) s.set(x, y, z, B[copperName(st + 1, fam)], m);
      },
    });
  }

  /* ---- mushrooms ---- */
  for (const name of ['brown_mushroom', 'red_mushroom']) {
    const id = B[name];
    const survives = (x, y, z) => {
      const b = sim.get(x, y - 1, z);
      if (b === B.mycelium || b === B.podzol || (b && /nylium$/.test(BLOCKS[b].name))) return true;
      return sim.brightness(x, y, z, 0) < 13 && opaqueCube(b);
    };
    sim.on(name, {
      random(s, x, y, z) {
        if (RI(s, 25) !== 0) return;
        let n = 5;
        for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) for (let dy = -1; dy <= 1; dy++) if (s.get(x + dx, y + dy, z + dz) === id && --n <= 0) return;
        let px = x, py = y, pz = z;
        let tx = x + RI(s, 3) - 1, ty = y + RI(s, 2) - RI(s, 2), tz = z + RI(s, 3) - 1;
        for (let k = 0; k < 4; k++) {
          if (isAir(s, tx, ty, tz) && survives(tx, ty, tz)) { px = tx; py = ty; pz = tz; }
          tx = px + RI(s, 3) - 1; ty = py + RI(s, 2) - RI(s, 2); tz = pz + RI(s, 3) - 1;
        }
        if (isAir(s, tx, ty, tz) && survives(tx, ty, tz)) s.set(tx, ty, tz, id, 0);
      },
    });
  }
}
