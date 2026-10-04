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
--------------------------------------------------------------------------- */
import { B } from '../blocks.js?v=11';
import { Y0 } from '../world-const.js?v=11';

const RANGE = 16, SPAWN_RANGE = 4, COUNT = 4, MAX_NEAR = 6, MIN_DELAY = 200, MAX_DELAY = 800;

export class Spawners {
  constructor() { this.state = new Map(); }     // "x,y,z" -> ticks left
  tick(world, player) {
    if (!world || !player) return;
    const px = player.pos.x, py = player.pos.y + Y0, pz = player.pos.z;
    const ccx = Math.floor(px / 16), ccz = Math.floor(pz / 16);
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const c = world.chunks.get((ccx + dx) + ',' + (ccz + dz));
      if (!c || !c.structs || !c.structs.spawners) continue;
      for (const s of c.structs.spawners) this.one(world, s, px, py, pz);
    }
  }
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
let roll = null;
const loadLoot = () => roll || (roll = import('./loot.js?v=11').then(m => m.rollLoot).catch(() => null));
export function structuresApi(getWorld, getPlayer) {
  const ask = (msg) => {
    const w = getWorld();
    if (!w || !w.ask) return Promise.resolve({ error: 'no world' });
    return w.ask(Object.assign({ type: 'structures' }, msg));
  };
  const here = () => { const p = getPlayer(); return p ? { x: Math.floor(p.pos.x), z: Math.floor(p.pos.z) } : { x: 0, z: 0 }; };
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
    // the contents of a structure chest (y in the game's index terms), rolled from its table (a promise)
    lootAt(x, y, z) {
      const e = api.chestAt(x, y, z);
      return e ? loadLoot().then(f => (f ? f(e.table, e.seed) : null)) : Promise.resolve(null);
    },
    spawners: new Spawners(),
  };
  return api;
}
