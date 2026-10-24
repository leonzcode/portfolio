/* ---------------------------------------------------------------------------
   Leoncraft 2 - structures, on the main thread: spawners, structure chests,
   and the questions the rest of the game asks (window.__lc2.structures).

   Spawners work the way the game's do (BaseSpawner): nothing happens unless
   a player is within 16 blocks; then a countdown (20 ticks the first time,
   200 to 799 after each spawn) and, when it runs out, 4 tries to put a mob
   somewhere within 4 blocks across and 1 up or down, stopping once 6 of its
   kind are close by. The mobs themselves are made through
   window.__lc2.entities.spawn(type, x, y, z) once the mobs are in the game;
   until then the spawner just keeps time.

   Chests in structures hold their loot as data (a loot table and a seed)
   until something opens them: lootAt(x, y, z) rolls it (struct/loot.js).

   A spawn egg used on a spawner sets its mob (setSpawnerMob): kept in the
   spawner block's meta, an index into SPAWNABLE, so it is saved with the
   world's edits like any block. Those spawners are found among the edits of
   the chunks round the player, and work the same way. An empty spawner
   (placed, never given an egg) spawns nothing, as in the game. The mob of
   each spawner near the player turns slowly inside its cage, small (drawn
   by the mobs' renderer from its displays list, never ticked or hit).
--------------------------------------------------------------------------- */
import { B } from '../blocks.js?v=107';
import { BIOMES } from '../biomes.js?v=107';
import { Y0, CH } from '../world-const.js?v=107';
import { trialSpawners } from './trials.js?v=107';
import { Hearts } from '../entities/hearts.js?v=107';
import { Raids } from '../entities/raids.js?v=107';
import { hives } from '../entities/hives.js?v=107';
import { Catalysts } from '../entities/catalyst.js?v=107';

// what a spawner can hold, by its meta (1 up): append only, saves keep the numbers
export const SPAWNABLE = ['zombie', 'skeleton', 'spider', 'cave_spider', 'blaze', 'creeper', 'husk', 'stray', 'drowned', 'magma_cube', 'silverfish', 'endermite',
  'witch', 'slime', 'pig', 'cow', 'sheep', 'chicken', 'rabbit', 'wolf', 'fox', 'cat', 'ocelot', 'horse', 'donkey', 'mule', 'llama', 'trader_llama', 'camel',
  'parrot', 'bat', 'bee', 'goat', 'panda', 'polar_bear', 'armadillo', 'axolotl', 'cod', 'salmon', 'tropical_fish', 'pufferfish', 'squid', 'glow_squid',
  'dolphin', 'turtle', 'frog', 'tadpole', 'allay', 'mooshroom', 'sniffer', 'iron_golem', 'snow_golem', 'copper_golem', 'villager', 'wandering_trader',
  'zombie_villager', 'skeleton_horse', 'zombie_horse', 'camel_husk', 'bogged', 'parched', 'wither_skeleton', 'zombie_nautilus', 'nautilus', 'breeze',
  'creaking', 'elder_guardian', 'guardian', 'phantom', 'warden', 'evoker', 'pillager', 'ravager', 'vindicator', 'vex', 'ghast', 'happy_ghast', 'hoglin',
  'piglin', 'piglin_brute', 'strider', 'zoglin', 'zombified_piglin', 'enderman', 'shulker', 'wither', 'ender_dragon'];
export const spawnerMob = meta => (meta > 0 && meta <= SPAWNABLE.length ? SPAWNABLE[meta - 1] : null);
// a spawn egg used on a spawner: true when it took the egg's mob
// (bumped when an egg gives a spawner its mob, so the list below is read again at once: the cell was already an edit)
let EGGED = 0;
export function setSpawnerMob(world, x, y, z, type) {
  const i = SPAWNABLE.indexOf(type), b = world.get(x, y, z);
  if (i < 0 || (b !== B.spawner && b !== B.trial_spawner)) return false;
  world.set(x, y, z, b, i + 1);
  EGGED++;
  return true;
}

const RANGE = 16, SPAWN_RANGE = 4, COUNT = 4, MAX_NEAR = 6, MIN_DELAY = 200, MAX_DELAY = 800;

export class Spawners {
  constructor() { this.state = new Map(); this.edited = new Map(); this.shown = new Map(); this.n = 0; this.trials = trialSpawners(spawnerMob); this.hearts = new Hearts(); this.raids = new Raids(); }     // state: "x,y,z" -> ticks left
  tick(world, player) {
    if (!world || !player) return;
    const px = player.pos.x, py = player.pos.y + Y0, pz = player.pos.z;
    const ccx = Math.floor(px / 16), ccz = Math.floor(pz / 16);
    const seen = new Set(), rescan = ++this.n % 100 === 0;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const key = (ccx + dx) + ',' + (ccz + dz);
      const c = world.chunks.get(key);
      if (!c) continue;
      // a structure's spawner keeps its own mob unless an egg changed it (then it is one of the edited ones below)
      if (c.structs && c.structs.spawners) for (const s of c.structs.spawners) {
        if (world.get(s.x, s.y - Y0, s.z) === B.spawner && world.meta(s.x, s.y - Y0, s.z)) continue;
        this.one(world, s, px, py, pz); this.show(world, s, px, py, pz, seen);
      }
      // the spawners among this chunk's edits that have a mob
      const ed = world.edits && world.edits.get(key);
      if (!ed) continue;
      let list = this.edited.get(key);
      if (!list || list.size !== ed.size || list.egged !== EGGED || rescan) {
        list = { size: ed.size, egged: EGGED, cells: [] };
        for (const [cell, v] of ed) if ((v >> 8) === B.spawner && (v & 255)) list.cells.push(cell);
        this.edited.set(key, list);
      }
      for (const cell of list.cells) {
        const x = (ccx + dx) * CH + (cell & 15), z = (ccz + dz) * CH + ((cell >> 4) & 15), y = cell >> 8;
        const mob = world.get(x, y, z) === B.spawner ? spawnerMob(world.meta(x, y, z)) : null;
        if (!mob) continue;
        const s = { x, y: y + Y0, z, mob };
        this.one(world, s, px, py, pz); this.show(world, s, px, py, pz, seen);
      }
    }
    // trial spawners (struct/trials.js), their mobs turning inside them too
    this.trials.tick(world, player, s => this.show(world, s, px, py, pz, seen));
    // creaking hearts bringing out their creakings at night (entities/hearts.js)
    this.hearts.tick(world, player);
    // illager patrols, Bad Omen in a village and the raid it brings (entities/raids.js)
    this.raids.tick(world, player);
    // bees going home to their hives, honey (entities/hives.js)
    hives().tick(world, player);
    // sculk catalysts blooming on the deaths round them (entities/catalyst.js)
    (this.catalysts || (this.catalysts = new Catalysts())).tick(world, player);
    // the ones out of sight or gone lose their turning mob
    for (const [k, e] of this.shown) if (!seen.has(k)) this.unshow(k, e);
  }
  // the spawner's mob, small and turning inside it (faster while the player is close enough to wake it)
  show(world, s, px, py, pz, seen) {
    const E = typeof window !== 'undefined' && window.__lc2 && window.__lc2.entities;
    if (!E || !E.makeDisplay) return;
    const k = s.x + ',' + s.y + ',' + s.z;
    const here = world.get(s.x, s.y - Y0, s.z);
    if (here !== B.spawner && here !== B.trial_spawner) return;
    const ddx = s.x + 0.5 - px, ddy = s.y + 0.5 - py, ddz = s.z + 0.5 - pz, d2 = ddx * ddx + ddy * ddy + ddz * ddz;
    if (d2 > 48 * 48) return;
    seen.add(k);
    let e = this.shown.get(k);
    if (e && (e.type !== s.mob || e.m !== E)) { this.unshow(k, e); e = null; }
    if (!e) { e = E.makeDisplay(s.mob, s.x + 0.5, s.y - Y0 + 0.4, s.z + 0.5); if (!e) return; this.shown.set(k, e); }
    e.prevBodyYaw = e.bodyYaw; e.prevHeadYaw = e.headYaw;
    const spin = d2 < 16 * 16 ? 0.1 : 0.02;
    e.bodyYaw += spin; e.headYaw = e.bodyYaw; e.age++;
  }
  unshow(k, e) { this.shown.delete(k); if (e && e.m && e.m.dropDisplay) e.m.dropDisplay(e); }
  one(world, s, px, py, pz) {
    const k = s.x + ',' + s.y + ',' + s.z;
    if (world.get(s.x, s.y - Y0, s.z) !== B.spawner) { this.state.delete(k); return; }    // broken
    const ddx = s.x + 0.5 - px, ddy = s.y + 0.5 - py, ddz = s.z + 0.5 - pz;
    if (ddx * ddx + ddy * ddy + ddz * ddz > RANGE * RANGE) return;
    let t = this.state.get(k);
    if (t === undefined) t = 20;
    if (t > 0) { this.state.set(k, t - 1); return; }
    const E = typeof window !== 'undefined' && window.__lc2 && window.__lc2.entities;
    let spawned = false;
    if (E && E.spawn) {
      for (let i = 0; i < COUNT; i++) {
        if (nearby(E, s) >= MAX_NEAR) break;
        const x = s.x + (Math.random() - Math.random()) * SPAWN_RANGE + 0.5;
        const y = s.y + Math.floor(Math.random() * 3) - 1;
        const z = s.z + (Math.random() - Math.random()) * SPAWN_RANGE + 0.5;
        // room to stand: two cells of something you can walk through, on anything
        const bx = Math.floor(x), bz = Math.floor(z), by = y - Y0;
        if (world.solidAt(bx, by, bz) || world.solidAt(bx, by + 1, bz)) continue;
        try { if (E.spawn(s.mob, x, y - Y0, z, { spawner: true }) !== false) spawned = true; } catch (e) { console.warn('spawner', e); }
      }
    }
    this.state.set(k, spawned || !E ? MIN_DELAY + Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY)) : 20);
  }
}
function nearby(E, s) {
  const r = SPAWN_RANGE * 2 + 1;
  try {
    if (E.countNear) return E.countNear(s.mob, s.x + 0.5, s.y - Y0 + 0.5, s.z + 0.5, r);
    const list = E.list || E.all || null;
    if (!list) return 0;
    let n = 0;
    for (const e of (typeof list === 'function' ? list.call(E) : list)) {
      if ((e.type || e.kind) !== s.mob || !e.pos) continue;
      if (Math.abs(e.pos.x - s.x) <= r && Math.abs(e.pos.y - (s.y - Y0)) <= r && Math.abs(e.pos.z - s.z) <= r) n++;
    }
    return n;
  } catch (e) { return 0; }
}

/* window.__lc2.structures: ask the workers (they hold the generator). */
let roll = null, LOOT = null;
// the loot rolling (struct/loot.js), fetched once; after that a chest is filled the moment it opens
const loadLoot = () => roll || (roll = import('./loot.js?v=107').then(m => { LOOT = m; return m.rollLoot; }).catch(() => { roll = null; return null; }));
export function structuresApi(getWorld, getPlayer) {
  // fetched while the game starts, so the first chest opened is not left empty for a moment
  setTimeout(loadLoot, 4000);
  const ask = (msg) => {
    const w = getWorld();
    if (!w || !w.ask) return Promise.resolve({ error: 'no world' });
    return w.ask(Object.assign({ type: 'structures' }, msg));
  };
  const here = () => { const p = getPlayer(); return p ? { x: Math.floor(p.pos.x), z: Math.floor(p.pos.z) } : { x: 0, z: 0 }; };
  // the biome the container stands in (a few entries only exist in, or everywhere but, one biome) and its slots
  const lootOpts = (x, z, size) => {
    const w = getWorld(), b = w && w.biomeAt ? BIOMES[w.biomeAt(x, z)] : null;
    return { size, biome: b ? b.name : '' };
  };
  const api = {
    // the nearest structure of a kind ('village', 'stronghold', 'monument', 'mansion', 'fortress', ... or any structure id)
    locate(kind, x, z, dim) { const h = here(); return ask({ op: 'locate', kind, x: x === undefined ? h.x : x, z: z === undefined ? h.z : z, dim }).then(m => m.error ? Promise.reject(new Error(m.error)) : m.found); },
    strongholds(n) { return ask({ op: 'strongholds', n }).then(m => m.list); },
    startsIn(cx, cz, dim) { return ask({ op: 'in', cx, cz, dim }).then(m => m.list); },
    pieces(set, cx, cz) { return ask({ op: 'pieces', set, cx, cz }).then(m => m.list); },
    // what a structure left in a chunk: chests (loot table + seed), spawners, entities to make, and which structures reach it
    inChunk(cx, cz) { const w = getWorld(); const c = w && w.chunks.get(cx + ',' + cz); return c ? c.structs || null : null; },
    chestAt(x, y, z) {
      const c = api.inChunk(Math.floor(x / 16), Math.floor(z / 16));
      return c && c.chests ? c.chests.find(e => e.x === x && e.y === y + Y0 && e.z === z) || null : null;
    },
    // the contents of a structure chest (y in the game's index terms), rolled from its table (a promise;
    // size: the container's slots)
    lootAt(x, y, z, size) {
      const e = api.chestAt(x, y, z);
      return e ? loadLoot().then(f => (f ? f(e.table, e.seed, lootOpts(x, z, size)) : null)) : Promise.resolve(null);
    },
    // the same at once: undefined while the loot code is still on its way, null for a chest no structure filled
    lootNow(x, y, z, size) {
      if (!LOOT) { loadLoot(); return undefined; }
      const e = api.chestAt(x, y, z);
      return e ? LOOT.rollLoot(e.table, e.seed, lootOpts(x, z, size)) : null;
    },
    // what a suspicious block a structure laid holds (one stack or null), as the game's brush finds it; a promise
    findAt(x, y, z) {
      const e = api.chestAt(x, y, z);
      if (!e || !/^archaeology\//.test(e.table)) return Promise.resolve(null);
      return loadLoot().then(() => (LOOT ? LOOT.rollItems(e.table, e.seed, lootOpts(x, z))[0] || null : null));
    },
    loadLoot,
    spawners: new Spawners(),
  };
  return api;
}
