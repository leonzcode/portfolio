/* ---------------------------------------------------------------------------
   Leoncraft 2 - trial spawners (the game's TrialSpawner), on the main thread.

   A trial spawner wakes when a player in Survival or Adventure is within 14
   blocks and it can see them (an opaque block between stops it). Then it
   brings out its wave: a mob every ticks_between_spawn ticks somewhere within
   4 blocks it can see, never more than simultaneous_mobs alive at once, until
   total_mobs have come (each count grows with every player past the first).
   Once the last of the wave is dead it waits 2 seconds, opens and throws out
   its reward, a stack every 1.5 seconds, one roll per player who fought the
   wave: half the time a trial key, otherwise food or a potion. Then it sleeps
   for 30 minutes (36000 ticks of play) before it can be woken again.

   A player with Bad Omen who comes in range has it turned into Trial Omen
   (15 minutes for each level); a spawner that sees a player with Trial Omen
   turns ominous: its mobs so far vanish, the cooldown is skipped, and it
   starts again with its ominous wave (more mobs for some kinds, the zombies
   and skeletons armed and in chainmail) and its ominous reward (the ominous
   trial key 3 times in 10). While an ominous spawner is active, every 8
   seconds something falls on a player in range 3 seconds after its spot
   lights up: a lingering potion, an arrow, a wind charge...

   The numbers are the game's own trial chamber configurations
   (data/minecraft/trial_spawner/trial_chamber/**, read for their numbers).
   Which configuration a spawner has is not in our own chamber design, so it
   is picked from its position (the same every time): melee, small melee,
   ranged, slow ranged or breeze, as the game's chambers mix them.

   Spawners are found in the chunks round the player whose structures
   include a trial chamber (and any a spawn egg was used on, in Creative).
   What lasts (a cooldown and being ominous) is kept with the dimension's
   block entities (details.js registerExtra), so leaving the world does not
   reset it.
--------------------------------------------------------------------------- */
import { B, BLOCKS } from '../blocks.js?v=107';
import { CH, Y0 } from '../world-const.js?v=107';
import { registerExtra } from '../details.js?v=107';

const RANGE = 14, SPAWN_RANGE = 4, COOLDOWN = 36000;
const R = Math.random;

/* The game's configurations, by kind: [simultaneous, per player, total, per player, ticks between],
   the mobs ([type, weight, options]), and the ominous one's differences. Unset numbers are the game's
   defaults (total 6 + 2 per player, simultaneous 2 + 1 per player, 40 ticks). */
const C = (sim, simP, tot, totP, every, mobs, om) => ({ sim, simP, tot, totP, every, mobs, om });
const MELEE = { gear: 'melee' }, RANGED = { gear: 'ranged' };
export const CONFIGS = {
  'breeze': C(1, 0.5, 2, 1, 20, [['breeze', 1]], { sim: 2, tot: 4 }),
  'melee/zombie': C(3, 0.5, 6, 2, 20, [['zombie', 1]], MELEE),
  'melee/husk': C(3, 0.5, 6, 2, 20, [['husk', 1]], MELEE),
  'melee/spider': C(3, 0.5, 6, 2, 20, [['spider', 1]], { sim: 4, tot: 12 }),
  'small_melee/baby_zombie': C(2, 0.5, 6, 2, 20, [['zombie', 1, { baby: true }]], MELEE),
  'small_melee/cave_spider': C(3, 0.5, 6, 2, 20, [['cave_spider', 1]], { sim: 4, tot: 12 }),
  'small_melee/silverfish': C(3, 0.5, 6, 2, 20, [['silverfish', 1]], { sim: 4, tot: 12 }),
  'small_melee/slime': C(3, 0.5, 6, 2, 20, [['slime', 3, { size: 1 }], ['slime', 1, { size: 2 }]], { sim: 4, tot: 12 }),
  'ranged/skeleton': C(3, 0.5, 6, 2, 20, [['skeleton', 1]], RANGED),
  'ranged/stray': C(3, 0.5, 6, 2, 20, [['stray', 1]], RANGED),
  'ranged/poison_skeleton': C(3, 0.5, 6, 2, 20, [['bogged', 1]], RANGED),
  'slow_ranged/skeleton': C(4, 2, 6, 2, 160, [['skeleton', 1]], RANGED),
  'slow_ranged/stray': C(4, 2, 6, 2, 160, [['stray', 1]], RANGED),
  'slow_ranged/poison_skeleton': C(4, 2, 6, 2, 160, [['bogged', 1]], RANGED),
};
// how often each kind turns up in a chamber (ours: the game picks per room from pools of templates)
const MIX = [['melee/zombie', 3], ['melee/husk', 2], ['melee/spider', 3], ['small_melee/baby_zombie', 2], ['small_melee/cave_spider', 2],
  ['small_melee/silverfish', 2], ['small_melee/slime', 2], ['ranged/skeleton', 3], ['ranged/stray', 2], ['ranged/poison_skeleton', 2],
  ['slow_ranged/skeleton', 1], ['slow_ranged/stray', 1], ['slow_ranged/poison_skeleton', 1], ['breeze', 3]];
const MIX_TOTAL = MIX.reduce((a, e) => a + e[1], 0);
const hash = (x, y, z) => { let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791); h = Math.imul(h ^ (h >>> 13), 0x5bd1e995); return (h ^ (h >>> 15)) >>> 0; };
export function configAt(x, y, z) {
  let k = hash(x, y, z) % MIX_TOTAL;
  for (const [n, w] of MIX) { k -= w; if (k < 0) return n; }
  return MIX[0][0];
}

// the reward tables (struct/lootdata.js) and their weights
const REWARD = [['spawners/trial_chamber/key', 1], ['spawners/trial_chamber/consumables', 1]];
const REWARD_OMINOUS = [['spawners/ominous/trial_chamber/key', 3], ['spawners/ominous/trial_chamber/consumables', 7]];

// the loot code and the stack maker, fetched the first time a spawner wakes
let LOOT = null, STACK = null;
function loadLoot() {
  if (LOOT !== null) return;
  LOOT = false;
  Promise.all([import('./loot.js?v=107'), import('../containers.js?v=107')]).then(([L, Cn]) => { LOOT = L; STACK = Cn.lootStack; }).catch(() => { LOOT = null; });
}
function lootItems(table) {
  if (!LOOT) { loadLoot(); return []; }
  return LOOT.rollItems(table, (R() * 2147483647) | 0).map(STACK).filter(Boolean);
}

const sound = (e, x, y, z, v = 1, p = 1) => {
  const S = typeof window !== 'undefined' && window.__lc2sound && window.__lc2sound.Sound;
  if (S) try { S.play(e, x + 0.5, y + 0.5, z + 0.5, v, p, 'block'); } catch (err) { /* no sound */ }
};
const lc2 = () => (typeof window !== 'undefined' ? window.__lc2 : null);

// a straight line from a to b with nothing opaque on it (the end cells themselves are not looked at)
function sees(world, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz);
  const n = Math.ceil(len / 0.25);
  const sx = Math.floor(ax), sy = Math.floor(ay), sz = Math.floor(az), ex = Math.floor(bx), ey = Math.floor(by), ez = Math.floor(bz);
  for (let i = 1; i < n; i++) {
    const t = i / n, x = Math.floor(ax + dx * t), y = Math.floor(ay + dy * t), z = Math.floor(az + dz * t);
    if ((x === sx && y === sy && z === sz) || (x === ex && y === ey && z === ez)) continue;
    const b = world.get(x, y, z);
    if (b && BLOCKS[b].opacity >= 15 && BLOCKS[b].solid) return false;
  }
  return true;
}

export class TrialSpawners {
  constructor(spawnerMob) {
    this.eggMob = spawnerMob;        // a spawn egg's mob from a spawner's meta (struct/spawners.js)
    this.recs = new Map();        // "x,y,z" (index y) -> what one spawner is doing
    this.found = new WeakMap();   // chunk -> its trial spawners { list: [[x, y, z, made by a structure], ...], ed: edits seen }
    this.n = 0;
  }
  // the records that last, kept with the dimension's block entities (details.js): a cooldown, being ominous
  save(det) {
    const out = [];
    if (det !== this.det) return out;
    for (const r of this.recs.values()) if (r.st === 'cool' || r.ominous) out.push({ k: 'ts', p: [r.x, r.y, r.z], l: r.left | 0, o: r.ominous ? 1 : 0, s: r.st === 'cool' ? 1 : 0 });
    return out;
  }
  reset(det) { this.det = det; this.recs.clear(); }
  load(det, o) {
    if (det !== this.det) this.reset(det);
    const [x, y, z] = o.p || [0, 0, 0];
    const r = this.rec(x, y, z);
    r.ominous = !!o.o;
    if (o.s) { r.st = 'cool'; r.left = o.l | 0; }
  }
  rec(x, y, z, cfg) {
    const k = x + ',' + y + ',' + z;
    let r = this.recs.get(k);
    if (!r) {
      r = { x, y, z, cfg: cfg || configAt(x, y + Y0, z), st: 'idle', spawned: 0, mobs: [], next: 0, t: 0, left: 0, ominous: false, seen: 0,
        quiet: 0, eject: [], dropAt: -1, dropPos: null, dropT: 0, key: k };
      this.recs.set(k, r);
    }
    if (cfg && r.cfg !== cfg) r.cfg = cfg;
    return r;
  }

  /* Once a game tick (from Spawners.tick). */
  tick(world, player, show) {
    const L = lc2(), g = L && L.game;
    if (!world || !player || !g) return;
    // another world or dimension: what was kept for it came in through load(), anything else starts afresh
    if (g.details !== this.det) this.reset(g.details);
    this.n++;
    // a cooldown counts down wherever the player is (the game's clock keeps going for every spawner)
    for (const r of this.recs.values()) if (r.st === 'cool' && --r.left <= 0) { r.st = 'idle'; r.ominous = false; r.spawned = 0; this.dirty(g); }
    const ccx = Math.floor(player.pos.x / CH), ccz = Math.floor(player.pos.z / CH);
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const key = (ccx + dx) + ',' + (ccz + dz);
      const c = world.chunks.get(key);
      if (!c) continue;
      for (const s of this.spawnersIn(world, c, key)) {
        this.one(world, player, g, s);
        // its mob turning inside it while it waits or fights
        const mob = show && world.get(s[0], s[1], s[2]) === B.trial_spawner ? this.displayMob(s[0], s[1], s[2]) : null;
        if (mob) show({ x: s[0], y: s[1] + Y0, z: s[2], mob });
      }
    }
  }
  // a chunk's trial spawners: looked for once in a chunk a trial chamber reaches, plus any a spawn egg set
  spawnersIn(world, c, key) {
    const ed = world.edits && world.edits.get(key), size = ed ? ed.size : 0;
    let f = this.found.get(c);
    if (f && f.ed === size) return f.list;
    if (!f || f.made === undefined) {
      // the chamber's own, once for the chunk
      const made = [];
      const st = c.structs && c.structs.structures;
      if (st && st.some(s => s.type === 'trial_chambers') && B.trial_spawner !== undefined) {
        const bl = c.blocks, T = B.trial_spawner;
        for (let i = bl.indexOf(T); i >= 0; i = bl.indexOf(T, i + 1)) made.push([c.cx * CH + (i & 15), i >> 8, c.cz * CH + ((i >> 4) & 15), true]);
      }
      f = { made };
    }
    const list = f.made.slice();
    if (ed) for (const [cell, v] of ed) if ((v >> 8) === B.trial_spawner) {
      const x = c.cx * CH + (cell & 15), z = c.cz * CH + ((cell >> 4) & 15), y = cell >> 8;
      if (!list.some(s => s[0] === x && s[1] === y && s[2] === z)) list.push([x, y, z, false]);
    }
    f.list = list; f.ed = size;
    this.found.set(c, f);
    return list;
  }

  one(world, P, g, s) {
    const [x, y, z] = s;
    if (world.get(x, y, z) !== B.trial_spawner) { if (this.recs.delete(x + ',' + y + ',' + z)) this.dirty(g); return; }
    // a spawner given a mob with an egg spawns that mob with the game's default numbers
    const meta = world.meta(x, y, z), egg = meta && this.eggMob ? this.eggMob(meta) : null;
    // one a structure did not make and no egg was used on does nothing, as an empty one in the game
    if (!egg && !s[3]) return;
    const r = this.rec(x, y, z, egg ? 'egg:' + egg : null);
    const cx = x + 0.5, cy = y + 0.5, cz = z + 0.5;
    const E = g.entities;
    if (!E) return;
    // who is fighting it: looked for every 10 ticks
    if ((this.n + ((r.x ^ r.z) & 1023)) % 10 === 0) {
      const ok = (g.mode === 'survival' || g.mode === 'adventure') && !(g.survival && g.survival.dead) && E.difficulty !== 'peaceful'
        && !(g.rules && g.rules.doMobSpawning === false);
      const ex = P.pos.x, ey = P.pos.y + 1.62, ez = P.pos.z;
      const d2 = (ex - cx) ** 2 + (P.pos.y + 0.9 - cy) ** 2 + (ez - cz) ** 2;
      r.seen = ok && d2 <= RANGE * RANGE && sees(world, cx, cy, cz, ex, ey, ez) ? 1 : 0;
      if (r.seen) this.omens(g, r);
    }
    const looks = this.looks(r);
    switch (r.st) {
      case 'cool': return;
      case 'idle':
        if (r.seen) { r.st = 'active'; r.spawned = 0; r.next = this.n + 20; r.quiet = 0; sound('block.trial_spawner.detect_player', x, y, z); }
        else if (looks && this.n % 20 === 0) this.puff(cx, cy, cz, r.ominous ? 0x40c8e8 : 0xff9a30, 1);
        return;
      case 'active': {
        const cfg = this.config(r);
        r.mobs = r.mobs.filter(e => e && !e.removed && !e.dead);
        const n = 1;     // players fighting it (on a server each page runs the spawners near its own player)
        const total = Math.floor(cfg.tot + cfg.totP * (n - 1)), sim = Math.floor(cfg.sim + cfg.simP * (n - 1));
        // everyone gone for half a minute: it goes back to waiting (the mobs stay)
        if (!r.seen) { if (++r.quiet > 600) { r.st = 'idle'; r.spawned = 0; } } else r.quiet = 0;
        if (r.spawned < total) {
          if (r.mobs.length < sim && this.n >= r.next) {
            r.next = this.n + cfg.every;
            const e = this.spawn(world, E, r, cfg);
            if (e) { r.mobs.push(e); r.spawned++; }
          }
        } else if (!r.mobs.length) { r.st = 'wait'; r.t = 40; loadLoot(); }
        if (this.n % 3 === 0) this.puff(cx, cy, cz, r.ominous ? 0x40c8e8 : 0xff9a30, 2);
        if (r.ominous) this.ominousDrops(world, E, P, r);
        return;
      }
      case 'wait':
        if (--r.t > 0) return;
        r.st = 'eject';
        r.eject = this.reward(r, 1);
        r.t = 0;
        sound('block.trial_spawner.open_shutter', x, y, z);
        return;
      case 'eject': {
        if (++r.t % 30 !== 1) return;
        const st = r.eject.shift();
        if (st && g.drops) {
          g.drops.spawn(cx, y + 1.2, cz, st, { vel: [(R() - 0.5) * 0.1, 0.25, (R() - 0.5) * 0.1] });
          sound('block.trial_spawner.eject_item', x, y, z);
          this.puff(cx, y + 1.1, cz, 0xffd070, 6);
        }
        if (!r.eject.length) {
          r.st = 'cool'; r.left = COOLDOWN; r.mobs = []; r.spawned = 0;
          sound('block.trial_spawner.close_shutter', x, y, z);
          this.dirty(g);
        }
        return;
      }
    }
  }
  config(r) {
    if (r.cfg.startsWith('egg:')) return { sim: 2, simP: 1, tot: 6, totP: 2, every: 40, mobs: [[r.cfg.slice(4), 1]], om: {} };
    const c = CONFIGS[r.cfg] || CONFIGS['melee/zombie'];
    return r.ominous ? Object.assign({}, c, c.om) : c;
  }
  // lit and showing its mob while waiting or fighting (not while cooling down)
  looks(r) { return r.st !== 'cool'; }
  // Bad Omen becomes Trial Omen; Trial Omen turns the spawner ominous
  omens(g, r) {
    const S = g.survival;
    if (!S || !S.effects) return;
    const bad = S.effects.bad_omen;
    if (bad) {
      const lv = bad.level || 1;
      S.removeEffect('bad_omen');
      S.addEffect('trial_omen', 1, 18000 * lv);
      sound('block.trial_spawner.become_ominous', r.x, r.y, r.z);
    }
    if (S.effects.trial_omen && !r.ominous) {
      r.ominous = true;
      for (const e of r.mobs) if (e && !e.removed && !e.dead) { if (g.entities.poof) g.entities.poof(e); e.remove(); }
      r.mobs = []; r.spawned = 0; r.st = 'active'; r.next = this.n + 20; r.left = 0;
      sound('block.trial_spawner.ominous_activate', r.x, r.y, r.z);
      this.puff(r.x + 0.5, r.y + 0.5, r.z + 0.5, 0x40c8e8, 16);
      this.dirty(g);
    }
  }
  spawn(world, E, r, cfg) {
    let tot = 0;
    for (const m of cfg.mobs) tot += m[1];
    let k = R() * tot, pick = cfg.mobs[0];
    for (const m of cfg.mobs) { k -= m[1]; if (k < 0) { pick = m; break; } }
    const [type, , o] = pick;
    for (let i = 0; i < 4; i++) {
      const x = r.x + 0.5 + (R() - R()) * SPAWN_RANGE, y = r.y + Math.floor(R() * 3) - 1, z = r.z + 0.5 + (R() - R()) * SPAWN_RANGE;
      const bx = Math.floor(x), bz = Math.floor(z);
      if (world.solidAt(bx, y, bz) || world.solidAt(bx, y + 1, bz) || !world.solidAt(bx, y - 1, bz)) continue;
      if (!sees(world, r.x + 0.5, r.y + 0.5, r.z + 0.5, x, y + 0.5, z)) continue;
      let e = null;
      try { e = E.spawn(type, x, y, z, Object.assign({ spawner: true, trial: true }, o || {})); } catch (err) { console.warn('trial spawner', err); }
      if (!e) return null;
      if (o && o.baby && e.setBaby) e.setBaby(true);
      if (o && o.size && e.setSize) e.setSize(o.size, true);
      if (r.ominous && cfg.gear) arm(e, cfg.gear);
      e.trialSpawner = r.key;
      sound('block.trial_spawner.spawn_mob', r.x, r.y, r.z);
      this.puff(x, y + 0.5, z, r.ominous ? 0x40c8e8 : 0xff9a30, 10);
      return e;
    }
    return null;
  }
  // the reward: one table for the wave (weighted), rolled once for each player who fought it
  reward(r, players) {
    const list = r.ominous ? REWARD_OMINOUS : REWARD;
    let tot = 0;
    for (const e of list) tot += e[1];
    let k = R() * tot, table = list[0][0];
    for (const e of list) { k -= e[1]; if (k < 0) { table = e[0]; break; } }
    const out = [];
    for (let i = 0; i < players; i++) for (const st of lootItems(table)) out.push(st);
    return out;
  }
  /* An ominous spawner's falling things: every 8 seconds a spot over the player lights up for 3 seconds,
     then what it holds drops (a lingering potion breaks where it lands). */
  ominousDrops(world, E, P, r) {
    if (r.dropAt < 0) { r.dropAt = this.n + 160; return; }
    if (this.n === r.dropAt - 60 && r.seen) {
      r.dropPos = [P.pos.x + (R() - 0.5) * 2, P.pos.y + 3.5 + R(), P.pos.z + (R() - 0.5) * 2];
      sound('block.trial_spawner.about_to_spawn_item', r.dropPos[0] - 0.5, r.dropPos[1] - 0.5, r.dropPos[2] - 0.5);
    }
    if (r.dropPos && this.n < r.dropAt && this.n % 4 === 0) this.puff(r.dropPos[0], r.dropPos[1], r.dropPos[2], 0x40c8e8, 2);
    if (this.n < r.dropAt) return;
    r.dropAt = this.n + 160;
    const at = r.dropPos;
    r.dropPos = null;
    if (!at) return;
    const items = lootItems('spawners/trial_chamber/items_to_drop_when_ominous');
    const st = items[0];
    if (!st) return;
    sound('block.trial_spawner.spawn_item', at[0] - 0.5, at[1] - 0.5, at[2] - 0.5);
    const L2 = lc2(), name = L2 && L2.game && L2.game.entities && L2.game.entities.itemName ? L2.game.entities.itemName(st.id) : '';
    try {
      if (/potion$/.test(name)) {
        const p = E.spawn('potion', at[0], at[1], at[2], { natural: false });
        if (p) { p.potion = st.potion || 'harming'; p.lingering = name === 'lingering_potion'; p.vel.set(0, -0.1, 0); }
      } else if (name === 'arrow' || name === 'tipped_arrow' || name === 'spectral_arrow') {
        const a = E.spawn('arrow', at[0], at[1], at[2], { natural: false });
        if (a) { a.vel.set(0, -0.6, 0); a.pickup = 0; }
      } else if (name === 'wind_charge') {
        const w = E.spawn('wind_charge', at[0], at[1], at[2], { natural: false });
        if (w) w.vel.set(0, -0.6, 0);
      } else {
        const L3 = lc2();
        if (L3 && L3.drops) L3.drops.spawn(at[0], at[1], at[2], st, { vel: [0, -0.1, 0] });
      }
    } catch (err) { console.warn('ominous item', err); }
  }
  puff(x, y, z, colour, n) {
    const L = lc2(), P = L && L.renderer && L.renderer.particles;
    if (!P || !P.spawn) return;
    for (let i = 0; i < n; i++) P.spawn(x + (R() - 0.5) * 0.9, y + (R() - 0.5) * 0.9, z + (R() - 0.5) * 0.9, 0, 0.02, 0,
      { colour, size: 0.08, life: 12, gravity: 0, physics: false });
  }
  dirty(g) { if (g && g.details) g.details.dirty = true; }
  // the mob a trial spawner shows inside it (or null while it rests)
  displayMob(x, y, z) {
    const r = this.recs.get(x + ',' + y + ',' + z);
    if (r && r.st === 'cool') return null;
    const cfg = r ? this.config(r) : CONFIGS[configAt(x, y + Y0, z)];
    return cfg && cfg.mobs[0] ? cfg.mobs[0][0] : null;
  }
}

// what an ominous wave holds and wears (the game's trial_chamber_melee and _ranged equipment, never dropped)
function arm(e, gear) {
  if (!e.equip) return;
  const pick = l => l[Math.floor(R() * l.length)];
  e.equip.mainhand = gear === 'melee' ? pick(['iron_sword', 'iron_sword', 'iron_sword', 'iron_sword', 'iron_sword', 'iron_sword', 'diamond_sword']) : 'bow';
  if (R() < 0.5) { e.equip.head = 'chainmail_helmet'; e.armor = (e.armor || 0) + 2; }
  if (R() < 0.5) { e.equip.chest = 'chainmail_chestplate'; e.armor = (e.armor || 0) + 5; }
  e.dropChance = { mainhand: 0, offhand: 0, head: 0, chest: 0, legs: 0, feet: 0 };
}

// one set of trial spawners for the visit (struct/spawners.js makes it); its records go with the block entities
let ONE = null;
export function trialSpawners(spawnerMob) {
  if (!ONE) {
    ONE = new TrialSpawners(spawnerMob);
    registerExtra('ts', { save: d => ONE.save(d), load: (d, o) => ONE.load(d, o), reset: d => ONE.reset(d) });
  }
  return ONE;
}
