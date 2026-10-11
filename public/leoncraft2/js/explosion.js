/* ---------------------------------------------------------------------------
   Leoncraft 2 - explosions, the way the game works them out (Minecraft Wiki,
   "Explosion", Java Edition).

     explode(world, x, y, z, power, { fire, source, breaks, decay, sim })

   Blocks: 1352 rays leave the centre towards the points of a 16 x 16 x 16
   grid's surface. Each starts with an intensity of power x (0.7 to 1.3) and
   walks in steps of 0.3 blocks, losing (blast resistance + 0.3) x 0.3 in
   every block it passes through and 0.225 a step; a block is destroyed if a
   ray still has intensity left there. TNT caught in it is lit with a short
   fuse (10 to 29 ticks). Destroyed blocks drop their loot with a chance of
   1 / power when `decay` is on (creepers, beds, respawn anchors; TNT drops
   everything since 1.21, the tntExplosionDropDecay rule being off). An
   explosion centred in water or lava breaks no blocks.

   Entities: everything within 2 x power is hurt by
     impact = (1 - distance / (2 x power)) x exposure
     damage = (impact^2 + impact) / 2 x 7 x (2 x power) + 1
   where exposure is the share of rays from the centre to points over the
   entity's box that nothing blocks, and pushed away by impact (the player
   through window.__lc2.player, mobs through window.__lc2.entities if the
   mobs code is there).

   Fire (beds, respawn anchors, fireballs): each destroyed cell that is air
   afterwards, with a solid block under it, catches fire one time in three.
--------------------------------------------------------------------------- */
import { B, BLOCKS, FLUID } from './blocks.js?v=42';

/* Blast resistance from the wiki where it is not the block's hardness. Worked out the first time it
   is wanted, or when the page is next idle: its 34 passes over every block took 11-15 ms here, and
   they ran with the rest of the game's parts as those load behind the title screen (main.js loadParts). */
const RES = new Map();
let resMade = false;
function makeRes() {
  resMade = true;
  const res = (test, v) => { for (const d of BLOCKS) if (d && test(d.name, d)) RES.set(d.id, v); };
  res(n => /^(stone|granite|diorite|andesite|polished_(granite|diorite|andesite)|deepslate|cobbled_deepslate|polished_deepslate|tuff|.*cobblestone.*|.*bricks?|.*_bricks_.*|.*_tiles?|smooth_stone|.*blackstone.*|prismarine.*|purpur.*|smooth_(sandstone|red_sandstone|quartz))$/.test(n), 6);
  res(n => /(_slab|_stairs|_wall)$/.test(n) && /(stone|cobble|brick|deepslate|tuff|blackstone|prismarine|purpur|granite|diorite|andesite|tile)/.test(n), 6);
  res(n => /^(dirt|coarse_dirt|podzol|rooted_dirt|mud|sand|red_sand|soul_sand|soul_soil|suspicious_sand|concrete_powder|hay_block|magma_block)$/.test(n) || /_concrete_powder$/.test(n), 0.5);
  res(n => /^(grass_block|mycelium|farmland|clay|gravel|suspicious_gravel|sponge|wet_sponge)$/.test(n), 0.6);
  res(n => n === 'dirt_path', 0.65);
  res(n => /(sandstone)$/.test(n) && !/^smooth/.test(n), 0.8);
  res(n => /_(log|wood|stem|hyphae)$/.test(n) && !/^(melon|pumpkin|attached)/.test(n), 2);
  res(n => /_planks$|_(fence|fence_gate|door|trapdoor)$/.test(n) && !/^iron/.test(n), 3);
  res(n => /_(slab|stairs)$/.test(n) && /^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped)/.test(n), 3);
  res((n, d) => d.leaves, 0.2);
  res(n => /glass/.test(n), 0.3);
  res(n => /^(ice|packed_ice|frosted_ice)$/.test(n), 0.5);
  res(n => n === 'blue_ice', 2.8);
  res(n => /_ore$/.test(n), 3);
  res(n => /^(iron|gold|diamond|emerald|redstone|coal)_block$|copper/.test(n) && !/_ore$/.test(n), 6);
  res(n => n === 'lapis_block', 3);
  res(n => /^(obsidian|crying_obsidian|ancient_debris|netherite_block|anvil|chipped_anvil|damaged_anvil|enchanting_table|respawn_anchor|reinforced_deepslate)$/.test(n), 1200);
  res(n => n === 'ender_chest', 600);
  res(n => /^(bedrock|barrier|end_portal_frame|end_portal|end_gateway|command_block|chain_command_block|repeating_command_block|structure_block|jigsaw|light)$/.test(n), 3600000);
  res(n => n === 'end_stone' || /^end_stone_brick/.test(n), 9);
  res(n => /_terracotta$|^terracotta$/.test(n) && !/glazed/.test(n), 4.2);
  res(n => /glazed_terracotta$/.test(n), 1.4);
  res(n => /_concrete$/.test(n), 1.8);
  res(n => /_wool$/.test(n), 0.8);
  res(n => n === 'netherrack' || /nylium$/.test(n), 0.4);
  res(n => n === 'basalt' || n === 'polished_basalt', 4.2);
  res(n => n === 'iron_bars' || n === 'chain', 6);
  res(n => /^iron_(door|trapdoor)$/.test(n), 5);
  res(n => n === 'hopper', 4.8);
  res(n => /^(furnace|blast_furnace|smoker|dispenser|dropper)$/.test(n), 3.5);
  res(n => n === 'observer', 3);
  res(n => /^(piston|sticky_piston|piston_head)$/.test(n), 1.5);
  res(n => /^(tnt|slime_block|honey_block)$/.test(n), 0);
  res(n => n === 'water' || n === 'lava', 100);
}
if (typeof requestIdleCallback === 'function') requestIdleCallback(() => { if (!resMade) makeRes(); }, { timeout: 5000 });

export function resistance(b) {
  if (!b) return 0;
  if (!resMade) makeRes();
  const r = RES.get(b);
  if (r !== undefined) return r;
  const d = BLOCKS[b];
  if (d.hardness < 0) return 3600000;
  return Math.max(0, d.hardness || 0);
}

// the 1352 directions, made once
const RAYS = [];
for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) for (let k = 0; k < 16; k++) {
  if (i !== 0 && i !== 15 && j !== 0 && j !== 15 && k !== 0 && k !== 15) continue;
  let dx = i / 15 * 2 - 1, dy = j / 15 * 2 - 1, dz = k / 15 * 2 - 1;
  const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
  RAYS.push(dx / l, dy / l, dz / l);
}

/* The share of the entity's box the explosion can see (0..1). */
export function exposure(world, cx, cy, cz, box) {
  const [x0, y0, z0, x1, y1, z1] = box;
  const sx = 1 / ((x1 - x0) * 2 + 1), sy = 1 / ((y1 - y0) * 2 + 1), sz = 1 / ((z1 - z0) * 2 + 1);
  const ox = (1 - Math.floor(1 / sx) * sx) / 2, oz = (1 - Math.floor(1 / sz) * sz) / 2;
  let seen = 0, all = 0;
  for (let a = 0; a <= 1; a += sx) for (let b = 0; b <= 1; b += sy) for (let c = 0; c <= 1; c += sz) {
    const px = x0 + (x1 - x0) * a + ox, py = y0 + (y1 - y0) * b, pz = z0 + (z1 - z0) * c + oz;
    if (clear(world, px, py, pz, cx, cy, cz)) seen++;
    all++;
  }
  return all ? seen / all : 0;
}
// nothing that collides between two points (a block-stepping ray)
function clear(world, x0, y0, z0, x1, y1, z1) {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const n = Math.ceil(len / 0.1);
  let lx = NaN, ly = NaN, lz = NaN;
  for (let i = 0; i <= n; i++) {
    const t = i / Math.max(1, n);
    const x = Math.floor(x0 + dx * t), y = Math.floor(y0 + dy * t), z = Math.floor(z0 + dz * t);
    if (x === lx && y === ly && z === lz) continue;
    lx = x; ly = y; lz = z;
    const b = world.get(x, y, z);
    if (b && BLOCKS[b].solid && BLOCKS[b].shape === 'cube') return false;
  }
  return true;
}

export function explode(world, x, y, z, power, o) {
  o = o || {};
  const sim = o.sim || (window.__lc2 && window.__lc2.sim) || null;
  const rnd = sim ? sim.rng : Math.random;
  const breaks = o.breaks !== false;
  const hit = new Map();
  // centred in a fluid: no blocks (TNT in water)
  const here = world.get(Math.floor(x), Math.floor(y), Math.floor(z));
  const inFluid = !!FLUID[here] || (here && BLOCKS[here].waterlogged);
  if (breaks && !inFluid && power > 0) {
    for (let r = 0; r < RAYS.length; r += 3) {
      const dx = RAYS[r] * 0.3, dy = RAYS[r + 1] * 0.3, dz = RAYS[r + 2] * 0.3;
      let h = power * (0.7 + rnd() * 0.6);
      let px = x, py = y, pz = z;
      for (; h > 0; h -= 0.22500001) {
        const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz);
        if (by < 0 || by >= 384) break;
        const b = world.get(bx, by, bz);
        if (b) h -= (resistance(b) + 0.3) * 0.3;
        if (h > 0 && b) {
          const k = bx + ',' + by + ',' + bz;
          if (!hit.has(k)) hit.set(k, [bx, by, bz]);
        }
        px += dx; py += dy; pz += dz;
      }
    }
  }
  /* ---- entities: hurt and pushed by what reaches them ---- */
  const reach = power * 2;
  const pushed = [];
  const L = window.__lc2;
  const hurtOne = (box, onHurt, onPush, self) => {
    const ex = (box[0] + box[3]) / 2, ey = box[1], ez = (box[2] + box[5]) / 2;
    const fx = ex - x, fy = (box[1] + 1.62 * 0) - y, fz = ez - z;
    const dist = Math.sqrt((ex - x) ** 2 + (ey - y) ** 2 + (ez - z) ** 2) / reach;
    if (dist > 1) return;
    let ddx = ex - x, ddy = (self ? box[1] + 1.62 : (box[1] + box[4]) / 2) - y, ddz = ez - z;
    const dl = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
    if (dl === 0) return;
    ddx /= dl; ddy /= dl; ddz /= dl;
    const seen = exposure(world, x, y, z, box);
    const impact = (1 - dist) * seen;
    const dmg = Math.floor((impact * impact + impact) / 2 * 7 * reach + 1);
    if (onHurt) onHurt(dmg);
    if (onPush) onPush(ddx * impact, ddy * impact, ddz * impact);
    pushed.push({ dmg, impact });
  };
  const p = L && L.player;
  if (p && o.hurtPlayer !== false) {
    const box = [p.pos.x - 0.3, p.pos.y, p.pos.z - 0.3, p.pos.x + 0.3, p.pos.y + (p.h || 1.8), p.pos.z + 0.3];
    hurtOne(box, dmg => {
      const g = L.game;
      if (g && g.mode !== 'creative' && g.survival) g.survival.hurt(dmg, { type: o.source === 'bad_respawn_point' ? 'bad_respawn_point' : 'explosion', x, z, attacker: o.source && o.source.hurt ? o.source : null });
    }, (vx, vy, vz) => { if (!p.flying) { p.vel.x += vx; p.vel.y += vy; p.vel.z += vz; } }, true);
  }
  // mobs and other bodies (window.__lc2.entities from the mobs code; our TNT and falling blocks)
  const lists = [];
  if (L && L.entities && typeof L.entities.inBox === 'function') lists.push(L.entities.inBox(x - reach, y - reach, z - reach, x + reach, y + reach, z + reach));
  if (sim && sim.bodies) lists.push(sim.bodies.list);
  for (const list of lists) for (const e of list || []) {
    if (e === o.source) continue;
    const box = e.box ? e.box() : [e.x - 0.49, e.y, e.z - 0.49, e.x + 0.49, e.y + 0.98, e.z + 0.49];
    hurtOne(box, dmg => { if (e.hurt) e.hurt(dmg, 'explosion'); }, (vx, vy, vz) => { if (e.push) e.push(vx, vy, vz); else if (e.vel) { e.vel.x += vx; e.vel.y += vy; e.vel.z += vz; } });
  }
  if (L && L.entities && typeof L.entities.explosion === 'function') L.entities.explosion(x, y, z, power, o);

  /* ---- the blocks go ---- */
  const decay = o.decay !== undefined ? o.decay : true;
  const cells = [...hit.values()];
  // shuffled, as the game does, so drops and chains do not come out in ray order
  for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = cells[i]; cells[i] = cells[j]; cells[j] = t; }
  const chance = decay ? 1 / power : 1;
  for (const [bx, by, bz] of cells) {
    const b = world.get(bx, by, bz);
    if (!b) continue;
    if (b === B.tnt && sim && sim.primeTnt) {
      // caught in a blast: lit with a short fuse
      world.set(bx, by, bz, 0, 0);
      // (owned by the blast's indirect source, as the game's PrimedTnt.wasExploded: the one who lit the first TNT of a chain, or the mob)
      const src = o.source && typeof o.source === 'object' ? o.source : null;
      sim.primeTnt(bx, by, bz, src && src.kind === 'tnt' && src.b === B.tnt ? (src.by || null) : src, 10 + Math.floor(rnd() * 20));
      continue;
    }
    if (sim) {
      const h = sim.beh[b];
      if (h && h.exploded) { h.exploded(sim, bx, by, bz, world.meta(bx, by, bz)); continue; }
      sim.destroy(bx, by, bz, true, chance);
    } else world.set(bx, by, bz, 0, 0);
  }
  if (sim && sim.fluids) for (const [bx, by, bz] of cells) sim.fluids.around(bx, by, bz);
  /* ---- fire ---- */
  if (o.fire && sim) {
    for (const [bx, by, bz] of cells) {
      if (Math.floor(rnd() * 3) !== 0) continue;
      if (world.get(bx, by, bz)) continue;
      const below = world.get(bx, by - 1, bz);
      if (below && BLOCKS[below].solid && BLOCKS[below].shape === 'cube' && BLOCKS[below].pass === 'opaque') sim.set(bx, by, bz, B.fire, 0);
    }
  }
  if (sim && sim.onExplosion) sim.onExplosion(x, y, z, power, cells.length, o);
  return { blocks: cells.length, cells, entities: pushed };
}
