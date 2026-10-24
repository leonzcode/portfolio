/* ---------------------------------------------------------------------------
   Leoncraft 2 - illager patrols and raids (the Minecraft Wiki's Raid and
   Patrol pages), ticked with the spawners (struct/spawners.js).

   Patrols: from the fifth day of a world on, every 10 to 11 minutes there
   is a one in five chance of a patrol 24 to 48 blocks from you, on open
   ground and away from villages: one to five pillagers (more the harder the
   world), led by a captain under the ominous banner. A captain killed drops
   an ominous bottle; drunk, it gives Bad Omen.

   Raids: a player with Bad Omen who comes into a village (within 64 blocks
   of where one was built) has it turn into Raid Omen of the same level for
   30 seconds; then the raid begins there. A bar marked Raid fills over 15
   seconds, a horn sounds from where each wave comes, and the waves come in
   from 32 to 48 blocks away and make for the village: 3 waves on Easy, 5 on
   Normal, 7 on Hard, one more with Raid Omen II and up, each the game's mix
   of pillagers, vindicators, witches, evokers and ravagers (ridden from the
   fifth wave). The bar shows what is left of the wave's health; 15 seconds
   after a wave falls the next one comes. Beat the last and every player who
   killed a raider has Hero of the Village (40 minutes); lose every villager
   and it ends in defeat; after 40 minutes it ends anyway.
--------------------------------------------------------------------------- */
import { BLOCKS } from '../blocks.js?v=107';
import { BIOMES } from '../biomes.js?v=107';
import { CH } from '../world-const.js?v=107';

const R = Math.random, RI = n => Math.floor(Math.random() * n);
const lc2 = () => (typeof window !== 'undefined' ? window.__lc2 : null);
const sound = (e, x, y, z, v = 1, p = 1, cat = 'hostile') => {
  const S = typeof window !== 'undefined' && window.__lc2sound && window.__lc2sound.Sound;
  if (S) try { S.play(e, x, y, z, v, p, cat); } catch (err) { /* no sound */ }
};

// the game's raiders by wave (index 1-8): how many of each come at the least
const BASE = {
  pillager: [0, 4, 3, 3, 4, 4, 4, 2],
  vindicator: [0, 0, 2, 0, 1, 4, 2, 5],
  evoker: [0, 0, 0, 0, 0, 1, 1, 2],
  witch: [0, 0, 0, 0, 3, 0, 0, 1],
  ravager: [0, 0, 0, 1, 0, 1, 0, 2],
};
const WAVES = { easy: 3, normal: 5, hard: 7, peaceful: 0 };
// how many more may come on top (the game's bonus raiders)
function bonus(type, diff, wave) {
  if (type === 'pillager' || type === 'vindicator') return diff === 'easy' ? RI(2) : diff === 'normal' ? 1 : 2;
  if (type === 'witch') return diff === 'easy' || wave <= 2 || wave === 4 ? 0 : 1;
  if (type === 'ravager') return (diff === 'normal' && wave === 5) || (diff === 'hard' && wave === 6) ? 1 : 0;
  return 0;
}

export class Raids {
  constructor() {
    this.n = 0;
    this.patrolT = 12000 + RI(1200);
    this.raid = null;
    this.pendingAt = null;       // a village the player brought Raid Omen into
  }
  // the village (the middle of where one was built) within `r` blocks of a point, from the structures of the chunks round it
  villageNear(world, x, z, r) {
    const cr = Math.ceil(r / CH) + 1, ccx = Math.floor(x / CH), ccz = Math.floor(z / CH);
    let best = null, bd = r * r;
    for (let dz = -cr; dz <= cr; dz++) for (let dx = -cr; dx <= cr; dx++) {
      const c = world.chunks.get((ccx + dx) + ',' + (ccz + dz));
      const st = c && c.structs && c.structs.structures;
      if (!st) continue;
      for (const s of st) {
        if (!/^village_/.test(s.type)) continue;
        const vx = s.cx * CH + 8, vz = s.cz * CH + 8, d = (vx - x) ** 2 + (vz - z) ** 2;
        if (d < bd) { bd = d; best = { x: vx, z: vz }; }
      }
    }
    return best;
  }
  // the top of a column you could stand on (index y), or -1 (water, leaves, nothing)
  ground(world, x, z) {
    for (let y = 383; y > 0; y--) {
      const b = world.get(x, y, z);
      if (!b) continue;
      const d = BLOCKS[b];
      if (d.fluid || d.waterlogged || d.leaves) return -1;
      if (!d.solid) continue;
      return world.get(x, y + 1, z) || world.get(x, y + 2, z) ? -1 : y + 1;
    }
    return -1;
  }
  tick(world, player) {
    const L = lc2(), g = L && L.game;
    if (!g || !world || !player || g.dim !== 'overworld' || !g.entities) return;
    const E = g.entities;
    this.n++;
    if (this.raid) this.raidTick(world, g, E, player);
    if (this.n % 20 === 0) this.omens(world, g, E, player);
    // patrols, every 10 to 11 minutes from the fifth day on
    if (--this.patrolT <= 0) {
      this.patrolT = 12000 + RI(1200);
      const survival = g.mode === 'survival' || g.mode === 'adventure';
      if (survival && g.time >= 5 * 24000 && E.difficulty !== 'peaceful' && R() < 0.2 && !(g.rules && g.rules.doPatrolSpawning === false)) this.patrol(world, g, E, player);
    }
  }
  patrol(world, g, E, P) {
    const a = R() * Math.PI * 2, d = 24 + RI(25);
    const x = Math.floor(P.pos.x + Math.cos(a) * d), z = Math.floor(P.pos.z + Math.sin(a) * d);
    const y = this.ground(world, x, z);
    if (y < 0 || this.villageNear(world, x, z, 128)) return false;
    const b = world.biomeAt ? world.biomeAt(x, z) : -1;
    if (b >= 0 && BIOMES[b] && BIOMES[b].name === 'mushroom_fields') return false;
    const diff = E.difficulty === 'hard' ? 3 : E.difficulty === 'normal' ? 2 : 1;
    const n = Math.min(5, 1 + Math.ceil(diff * 0.75) + RI(2));
    let led = false;
    for (let i = 0; i < n; i++) {
      const px = x + RI(5) - 2, pz = z + RI(5) - 2, py = this.ground(world, px, pz);
      if (py < 0) continue;
      const e = E.spawn('pillager', px + 0.5, py, pz + 0.5, { natural: true, patrol: true });
      if (e && !led) { this.captain(e); led = true; }
    }
    return true;
  }
  // a captain: the ominous banner on its head, an ominous bottle when it dies
  captain(e) {
    e.captain = true;
    if (e.equip) { e.equip.head = 'white_banner'; e.dropChance = Object.assign({}, e.dropChance || {}, { head: 0 }); }
    const loot = e.loot ? e.loot.bind(e) : () => {};
    e.loot = (drop, ...rest) => { loot(drop, ...rest); drop('ominous_bottle', 1); };
  }
  /* Bad Omen in a village becomes Raid Omen; Raid Omen running out starts the raid there. */
  omens(world, g, E, P) {
    const S = g.survival;
    if (!S || !S.effects) return;
    const bad = S.effects.bad_omen;
    if (bad && !this.raid && E.difficulty !== 'peaceful') {
      const v = this.villageNear(world, P.pos.x, P.pos.z, 64);
      if (v) {
        const lv = bad.level || 1;
        S.removeEffect('bad_omen');
        S.addEffect('raid_omen', lv, 600);
        this.pendingAt = { x: v.x, z: v.z, level: lv };
      }
    }
    if (this.pendingAt && !S.effects.raid_omen) {
      const p = this.pendingAt;
      this.pendingAt = null;
      if (!this.raid) this.start(world, g, E, P, p);
    }
  }
  start(world, g, E, P, p) {
    const diff = E.difficulty || 'normal', base = WAVES[diff] || 5;
    if (!base) return;
    const cy = this.ground(world, p.x, p.z);
    this.raid = {
      x: p.x, z: p.z, y: cy > 0 ? cy : Math.floor(P.pos.y), level: p.level, diff, waves: base + (p.level >= 2 ? 1 : 0), regular: base,
      wave: 0, raiders: [], cool: 300, t: 0, fill: 0, heroes: false, total: 1, ended: null, endT: 0,
    };
    this.bar(E, 'Raid', 0);
  }
  bar(E, name, progress) { E.boss = { name, progress: Math.max(0, Math.min(1, progress)) + (name === 'Raid' ? 0 : 1e-6), colour: 'red' }; }
  raidTick(world, g, E, P) {
    const r = this.raid;
    r.t++;
    if (r.ended) {
      // the bar says how it ended for a while, then goes
      if (++r.endT > 200) { this.raid = null; if (E.boss && /^Raid/.test(E.boss.name)) E.boss = null; }
      return;
    }
    // too long, or the village gone: over
    if (r.t > 48000) return this.end(E, 'Raid - Defeat');
    if (r.t % 40 === 0) {
      let villagers = 0;
      for (const e of E.list) if (e.type === 'villager' && !e.dead && !e.removed && (e.pos.x - r.x) ** 2 + (e.pos.z - r.z) ** 2 < 96 * 96) villagers++;
      if (!villagers && r.t > 400) return this.end(E, 'Raid - Defeat');
    }
    // a raider the player brought down makes them a hero at the end; one that wandered 112 blocks off has left the raid
    for (const e of r.raiders) if (e && e.dead && e.lastHurtBy && e.lastHurtBy.isPlayer) r.heroes = true;
    r.raiders = r.raiders.filter(e => e && !e.dead && !e.removed && (e.pos.x - r.x) ** 2 + (e.pos.z - r.z) ** 2 < 112 * 112);
    // between waves: the bar fills (15 seconds) and the next wave comes
    if (!r.raiders.length) {
      if (r.wave >= r.waves) return this.victory(g, E);
      if (r.cool > 0) {
        r.cool--;
        this.bar(E, 'Raid', 1 - r.cool / 300);
        if (r.cool === 0) this.spawnWave(world, g, E, P);
      }
      return;
    }
    // the bar: what is left of the wave's health
    let hp = 0;
    for (const e of r.raiders) hp += Math.max(0, e.health);
    const left = r.raiders.length;
    this.bar(E, left < 3 ? 'Raid - Raiders Remaining: ' + left : 'Raid', hp / r.total);
    // raiders with nothing to fight make for the village
    if (r.t % 60 === 0) for (const e of r.raiders) {
      if (e.target || !e.nav || e.vehicle) continue;
      if ((e.pos.x - r.x) ** 2 + (e.pos.z - r.z) ** 2 > 12 * 12) e.nav.moveTo(r.x + RI(9) - 4, r.y, r.z + RI(9) - 4, 1);
    }
  }
  spawnWave(world, g, E, P) {
    const r = this.raid;
    r.wave++;
    const w = Math.min(r.wave, r.regular), list = [];
    for (const type of Object.keys(BASE)) {
      const n = BASE[type][Math.min(7, w)] + (bonus(type, r.diff, w) > 0 ? RI(bonus(type, r.diff, w) + 1) : 0);
      for (let i = 0; i < n; i++) list.push(type);
    }
    if (!list.length) list.push('pillager');
    // where they come from: open ground 32 to 48 blocks out
    let sx = null, sz, sy;
    for (let k = 0; k < 40 && sx === null; k++) {
      const a = R() * Math.PI * 2, d = 32 + RI(17), x = Math.floor(r.x + Math.cos(a) * d), z = Math.floor(r.z + Math.sin(a) * d);
      if (!world.loaded || world.loaded(x, z)) { const y = this.ground(world, x, z); if (y > 0 && Math.abs(y - r.y) < 96) { sx = x; sz = z; sy = y; } }
    }
    if (sx === null) { sx = Math.floor(r.x); sz = Math.floor(r.z); sy = r.y; }
    // the horn, from the wave's side, 13 blocks from you
    const dx = sx - P.pos.x, dz = sz - P.pos.z, dl = Math.hypot(dx, dz) || 1;
    sound('event.raid.horn', P.pos.x + dx / dl * 13, P.pos.y + 1, P.pos.z + dz / dl * 13, 64, 1, 'neutral');
    const riders = [];
    for (const type of list) {
      const x = sx + RI(5) - 2 + 0.5, z = sz + RI(5) - 2 + 0.5, y = this.ground(world, Math.floor(x), Math.floor(z));
      const e = E.spawn(type, x, y > 0 ? y : sy, z, { natural: true, raid: true });
      if (!e) continue;
      e.persistent = true; e.raid = true;
      r.raiders.push(e);
      if (type === 'ravager' && w >= 5) riders.push(e);
    }
    // ravagers from the fifth wave carry a rider: a pillager, then a vindicator, then an evoker
    riders.forEach((rv, i) => {
      const kind = w === 5 || w === 6 ? 'pillager' : i === 0 ? 'vindicator' : 'evoker';
      const p = E.spawn(kind, rv.pos.x, rv.pos.y + rv.h, rv.pos.z, { natural: true, raid: true });
      if (!p) return;
      p.persistent = true; p.raid = true;
      p.vehicle = rv; rv.passengers.push(p);
      r.raiders.push(p);
    });
    // the first of each wave leads it under the banner
    const lead = r.raiders.find(e => e.type === 'pillager' || e.type === 'vindicator');
    if (lead) this.captain(lead);
    r.total = 0;
    for (const e of r.raiders) r.total += e.maxHealth || e.health || 1;
    // (the 15 seconds before the next wave count from when this one has fallen)
    r.cool = 300;
  }
  victory(g, E) {
    const r = this.raid;
    if (r.heroes && g.survival) g.survival.addEffect('hero_of_the_village', r.level || 1, 48000);
    this.end(E, 'Raid - Victory');
  }
  end(E, text) {
    const r = this.raid;
    r.ended = text; r.endT = 0;
    this.bar(E, text, text === 'Raid - Victory' ? 1 : 0);
  }
}
