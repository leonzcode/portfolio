/* ---------------------------------------------------------------------------
   Leoncraft 2 - villagers at work: professions, job sites, trading, curing.

   By the Minecraft Wiki (Villager, Trading, Zombie Villager; Java Edition):

     job sites   an unemployed adult looks for the nearest job site block no
                 other villager has claimed (we look 16 blocks across and 4 up
                 and down, which takes in a village's houses, every 10
                 seconds), walks to it (giving up after a minute) and takes
                 its profession once within 2 blocks of it, green sparks
                 showing. If the block goes, a novice that has never traded
                 loses its profession; one that has traded keeps it and
                 looks for another of its kind.
     work        from 2000 to 9000 (the morning) a villager with a job goes to
                 its job site and stands at it; working there restocks its
                 trades, at most twice a day and 2 minutes apart.
     trading     using a villager with a profession opens its trades (a baby,
                 an unemployed villager or a nitwit shakes its head). While
                 you trade it stands still and looks at you. Its level goes
                 up 2 seconds after the screen closes, bringing two new
                 trades and 10 seconds of Regeneration.
     gossip      trades, hits and killings change your reputation with it
                 (js/trading.js), which moves its prices.
     zombies     a villager turned into a zombie villager keeps its looks,
                 profession and trades. A zombie villager with Weakness fed a
                 golden apple is cured in 3 to 5 minutes (shaking as it goes),
                 with Strength meanwhile; the villager it becomes gives the
                 one who cured it its best prices.
--------------------------------------------------------------------------- */
import { Villager } from './mobs4.js?v=107';
import { ZombieVillager, register, TYPES } from './mobs.js?v=107';
import { Goal, MOVE, LOOK, JUMP } from './entity.js?v=107';
import './villagerart.js?v=107';
import { B, BLOCKS } from '../blocks.js?v=107';
import * as T from '../trading.js?v=107';

const R = () => Math.random();
const RI = n => Math.floor(Math.random() * n);
const SCAN_H = 16, SCAN_V = 4;
// the biomes whose villagers dress for them (the rest dress as the plains)
const BIOME_TYPE = {};
for (const [t, list] of Object.entries({
  desert: 'badlands desert eroded_badlands wooded_badlands', savanna: 'savanna savanna_plateau windswept_savanna',
  taiga: 'old_growth_pine_taiga old_growth_spruce_taiga taiga windswept_hills windswept_forest windswept_gravelly_hills',
  snow: 'deep_frozen_ocean frozen_ocean frozen_peaks frozen_river grove ice_spikes jagged_peaks snowy_beach snowy_plains snowy_slopes snowy_taiga',
  swamp: 'mangrove_swamp swamp', jungle: 'bamboo_jungle jungle sparse_jungle',
})) for (const b of list.split(' ')) BIOME_TYPE[b] = t;
const typeOf = s => (s === 'snowy' ? 'snow' : T.TYPES.indexOf(s) >= 0 ? s : 'plains');
const key = (x, y, z) => x + ',' + y + ',' + z;
const claims = m => m.jobClaims || (m.jobClaims = new Map());
const dayTime = m => ((m.time % 24000) + 24000) % 24000;

/* ---- goals ---- */
// trading: stand still and look at the player
class TradeGoal extends Goal {
  constructor(mob) { super(mob, MOVE | LOOK | JUMP); }
  canUse() { return !!this.mob.customer; }
  start() { this.mob.stopMoving(); }
  tick() { this.mob.stopMoving(); this.mob.lookAtEntity(this.mob.m.player, 30, 30); }
}
// to a job site to claim it, or to its own to work
class JobGoal extends Goal {
  constructor(mob) { super(mob, MOVE | LOOK); this.t = 0; }
  where() {
    const v = this.mob;
    if (v.customer || v.ageT < 0 || v.panicking) return null;
    if (v.goingTo) return v.goingTo;
    const d = dayTime(v.m);
    return v.jobSite && d >= 2000 && d < 9000 && !v.atSite() ? v.jobSite : null;
  }
  canUse() {
    const p = this.where();
    if (!p || RI(10)) return false;
    this.p = p;
    return true;
  }
  start() { this.t = 0; this.go(); }
  go() { const [x, y, z] = this.p; this.mob.nav.moveTo(x + 0.5, y, z + 0.5, 0.5, 1.6); }
  canContinue() { return this.where() === this.p && this.t < 1200; }
  tick() {
    this.t++;
    const [x, y, z] = this.p;
    this.mob.lookAt(x + 0.5, y + 0.5, z + 0.5);
    if (this.mob.nav.isDone() && this.t % 40 === 0) this.go();
  }
  stop() { this.mob.nav.stop(); if (this.mob.goingTo && this.t >= 1200) this.mob.goingTo = null; }
}

/* ---------------------------------------------------------------------------
   The villager with a trade
--------------------------------------------------------------------------- */
export class Merchant extends Villager {
  constructor(m, type) {
    super(m, type);
    this.profession = 'none';
    this.vtype = 'plains';
    this.vlevel = 1; this.vxp = 0;
    this.offers = [];
    this.jobSite = null; this.goingTo = null;
    this.gossip = {};
    this.restocks = 0; this.lastRestock = -1e9; this.restockDay = -1;
    this.levelT = 0; this.levelUp = false;
    this.customer = null;                // the player trading with it
    this.jobT = RI(200); this.gossipT = 0;
  }
  registerGoals() {
    super.registerGoals();
    this.goals.add(1, new TradeGoal(this));
    this.goals.add(3, new JobGoal(this));
  }
  // spawn options: { profession, style (a village's), type, level }
  spawnData(o) {
    if (o.json) return;
    this.vtype = o.style || o.type ? typeOf(o.style || o.type) : this.biomeType();
    if (o.profession && o.profession !== 'none') this.setProfession(o.profession);
    for (let l = 1; l < Math.min(5, o.level | 0); l++) this.gainLevel();
  }
  biomeType() { const s = this.m.spawner; return s ? BIOME_TYPE[s.biome(Math.floor(this.pos.x), Math.floor(this.pos.z))] || 'plains' : 'plains'; }
  setProfession(p) {
    if (p === this.profession) return;
    this.profession = p;
    this.offers = T.TRADES[p] ? T.levelOffers(p, 1, this.vtype) : [];
    this.vlevel = 1;
  }
  gainLevel() {
    if (this.vlevel >= 5 || !T.TRADES[this.profession]) return;
    this.vlevel++;
    this.offers.push(...T.levelOffers(this.profession, this.vlevel, this.vtype));
  }
  // for tests: the trades as the screen shows them, and the levels
  get trades() { return this.offers.map(o => ({ give: [T.costA(o, this.rep(), 0)].concat(o.b ? [o.b] : []), get: o.out, maxUses: o.maxUses, uses: o.uses })); }
  get xpThresholds() { return T.LEVEL_XP.slice(); }
  get tradesPerLevel() { return T.TRADES_PER_LEVEL; }
  get canTrade() { return this.ageT >= 0 && !!T.TRADES[this.profession] && this.offers.length > 0; }
  rep() { return T.reputation(this.gossip); }

  /* ---- using it ---- */
  interact(held) {
    if (held === 'name_tag' || this.dead) return false;
    if (this.customer) return false;
    if (!this.canTrade) { this.shakeT = 40; return 'shake'; }
    return 'trade';
  }
  startTrading(player) { this.customer = player; this.stopMoving(); }
  stopTrading() { this.customer = null; }
  // a trade made: its use, the experience (the villager's, and 3 to 6 for the player, 5 more on a level up)
  traded(o) {
    o.uses++;
    this.vxp += o.xp;
    T.addGossip(this.gossip, 'trading');
    let xp = 3 + RI(4);
    if (this.vlevel < 5 && this.vxp >= T.LEVEL_XP[this.vlevel] && !this.levelUp) { this.levelUp = true; this.levelT = 40; xp += 5; }
    const h = this.m.hooks;
    if (h && h.giveXp) h.giveXp(xp, this.pos.x, this.pos.y + 0.5, this.pos.z);
  }

  /* ---- the day ---- */
  aiStep() {
    super.aiStep();
    if (this.dead) return;
    // the level up waits until no one is trading
    if (!this.customer && this.levelT > 0 && --this.levelT === 0) {
      if (this.levelUp) { this.levelUp = false; this.gainLevel(); }
      if (this.addEffect) this.addEffect('regeneration', 1, 200);
      this.m.particles('sparkle', this.pos.x, this.pos.y + 1.6, this.pos.z, 6, 0.5);
    }
    // gossip fades every 20 minutes
    if (++this.gossipT >= 24000) { this.gossipT = 0; T.decayGossip(this.gossip); }
    if (this.ageT < 0 || this.profession === 'nitwit') return;
    if (++this.jobT % 20 === 0) this.jobTick();
  }
  jobTick() {
    const W = this.m.t;
    // its job site still there?
    if (this.jobSite) {
      const [x, y, z] = this.jobSite;
      if (T.SITE_OF.get(W.get(x, y, z)) !== this.profession) {
        this.release();
        if (this.vxp === 0 && this.vlevel === 1) { this.profession = 'none'; this.offers = []; }
      } else claims(this.m).set(key(x, y, z), this);
    }
    if (this.jobSite) { if (this.atSite()) this.work(); return; }
    // on its way to one: there yet, or has someone else got it?
    if (this.goingTo) {
      const [x, y, z] = this.goingTo, p = T.SITE_OF.get(W.get(x, y, z));
      const other = claims(this.m).get(key(x, y, z));
      if (!p || (this.profession !== 'none' && p !== this.profession) || (other && other !== this && !other.removed && !other.dead)) { this.goingTo = null; return; }
      const dx = x + 0.5 - this.pos.x, dy = y + 0.5 - this.pos.y, dz = z + 0.5 - this.pos.z;
      if (dx * dx + dy * dy + dz * dz <= 4.5) this.claim(x, y, z, p);
      return;
    }
    if (this.jobT % 200 === 0) this.goingTo = this.findSite();
  }
  // the nearest job site nobody has, of its profession if it has traded
  findSite() {
    const W = this.m.t, fx = Math.floor(this.pos.x), fy = Math.floor(this.pos.y), fz = Math.floor(this.pos.z);
    const want = this.profession === 'none' ? null : this.profession, C = claims(this.m);
    let best = null, bd = Infinity;
    for (let y = fy - SCAN_V; y <= fy + SCAN_V; y++) for (let z = fz - SCAN_H; z <= fz + SCAN_H; z++) for (let x = fx - SCAN_H; x <= fx + SCAN_H; x++) {
      const p = T.SITE_OF.get(W.get(x, y, z));
      if (!p || (want && p !== want)) continue;
      const d = (x - fx) ** 2 + (y - fy) ** 2 + (z - fz) ** 2;
      if (d >= bd) continue;
      const o = C.get(key(x, y, z));
      if (o && o !== this && !o.removed && !o.dead) continue;
      best = [x, y, z]; bd = d;
    }
    return best;
  }
  claim(x, y, z, p) {
    this.goingTo = null;
    this.jobSite = [x, y, z];
    claims(this.m).set(key(x, y, z), this);
    if (this.profession === 'none') this.setProfession(p);
    this.m.particles('sparkle', this.pos.x, this.pos.y + 1.8, this.pos.z, 8, 0.6);
    this.m.particles('sparkle', x + 0.5, y + 1.1, z + 0.5, 6, 0.5);
  }
  release() {
    if (!this.jobSite) return;
    const k = key(...this.jobSite), C = claims(this.m);
    if (C.get(k) === this) C.delete(k);
    this.jobSite = null;
  }
  // within reach of its job site: one of the eight blocks round it, at its feet or just below
  atSite() {
    if (!this.jobSite) return false;
    const [x, y, z] = this.jobSite, fx = Math.floor(this.pos.x), fy = Math.floor(this.pos.y + 0.01), fz = Math.floor(this.pos.z);
    return Math.abs(x - fx) <= 1 && Math.abs(z - fz) <= 1 && (y === fy || y === fy - 1);
  }
  // working: the trades come back, twice a day at most, two minutes apart
  work() {
    const d = dayTime(this.m);
    if (d < 2000 || d >= 9000) return;
    const now = this.m.age, day = Math.floor(this.m.time / 24000);
    if (day !== this.restockDay) { this.restockDay = day; this.restocks = 0; }
    if (!this.offers.some(o => o.uses > 0)) return;
    if (this.restocks >= 2 || (this.restocks > 0 && now < this.lastRestock + 2400)) return;
    T.restock(this.offers);
    this.restocks++; this.lastRestock = now;
  }

  /* ---- hurt and killed ---- */
  onHurt(amount, source) {
    super.onHurt(amount, source);
    if (source && source.attacker && source.attacker.isPlayer) T.addGossip(this.gossip, 'minor_negative');
    if (this.customer) this.customer = null;
  }
  die(source) {
    const n = this.m.list.length;
    const killer = source && source.attacker && source.attacker.isPlayer;
    super.die(source);
    this.release();
    // a killing seen by the villagers about remembered
    if (killer) this.m.forNear(this.pos.x, this.pos.z, 16, e => { if (e !== this && e instanceof Merchant && !e.dead && Math.abs(e.pos.y - this.pos.y) <= 16) T.addGossip(e.gossip, 'major_negative'); });
    // turned into a zombie villager: it keeps who it was
    const z = this.m.list.length > n ? this.m.list[this.m.list.length - 1] : null;
    if (z && z.type === 'zombie_villager') z.villager = this.dataJSON();
  }
  remove() { this.release(); super.remove(); }

  /* ---- how it looks: its biome's clothes, its profession's, its badge ---- */
  layers(out) {
    if (super.layers) super.layers(out);
    villagerLayers(out, 'villager', this.vtype, this.ageT < 0 ? 'none' : this.profession, this.vlevel);
  }

  /* ---- keeping it ---- */
  dataJSON() {
    const o = { pr: this.profession, vt: this.vtype, lv: this.vlevel, xp: this.vxp, of: T.offersToJSON(this.offers) };
    if (Object.keys(this.gossip).length) o.go = Object.assign({}, this.gossip);
    return o;
  }
  dataFromJSON(o) {
    if (!o) return;
    this.profession = o.pr || 'none'; this.vtype = typeOf(o.vt || 'plains'); this.vlevel = o.lv || 1; this.vxp = o.xp | 0;
    this.offers = T.offersFromJSON(o.of);
    this.gossip = Object.assign({}, o.go || {});
  }
  toJSON() {
    const o = super.toJSON();
    o.vd = this.dataJSON();
    if (this.jobSite) o.js = this.jobSite;
    o.rs = [this.restocks, this.restockDay];
    return o;
  }
  fromJSON(o) {
    super.fromJSON(o);
    this.dataFromJSON(o.vd);
    if (Array.isArray(o.js)) { this.jobSite = o.js; claims(this.m).set(key(...o.js), this); }
    if (Array.isArray(o.rs)) { this.restocks = o.rs[0] | 0; this.restockDay = o.rs[1] | 0; }
  }
}
register('villager', Merchant);

// the overlays for a villager or a zombie villager
function villagerLayers(out, model, vtype, prof, level) {
  out.push([model, 'villager_type_' + vtype, null]);
  if (prof !== 'none') out.push([model, 'villager_prof_' + prof, null]);
  if (prof !== 'none' && prof !== 'nitwit') out.push([model, 'villager_level_' + Math.max(1, Math.min(5, level)), null]);
}

/* ---------------------------------------------------------------------------
   The zombie villager: wears what it wore, and can be cured
--------------------------------------------------------------------------- */
export class CurableZombieVillager extends ZombieVillager {
  constructor(m, type) { super(m, type); this.villager = null; this.cureT = 0; this.curer = null; }
  finalizeSpawn(o) { if (super.finalizeSpawn) super.finalizeSpawn(o); if (!this.villager) this.villager = { pr: 'none', vt: this.biomeType(), lv: 1, xp: 0, of: [] }; }
  biomeType() { const s = this.m.spawner; return s ? BIOME_TYPE[s.biome(Math.floor(this.pos.x), Math.floor(this.pos.z))] || 'plains' : 'plains'; }
  interact(held, player) {
    // a golden apple while it is weak: the cure begins (3 to 5 minutes)
    if (held === 'golden_apple' && this.hasEffect && this.hasEffect('weakness') && !this.cureT) {
      this.cureT = 3600 + RI(2401);
      this.curer = player || null;
      this.removeEffect('weakness');
      this.addEffect('strength', Math.max(1, Math.min(this.m.difficulty === 'hard' ? 2 : 1, 2)) - 0, this.cureT);
      this.persistent = true;
      this.m.particles('sparkle', this.pos.x, this.pos.y + 1.6, this.pos.z, 8, 0.5);
      return 'consume';
    }
    return super.interact ? super.interact(held, player) : false;
  }
  aiStep() {
    super.aiStep();
    if (this.dead || !this.cureT) return;
    // iron bars and beds near it speed the cure
    let step = 1;
    if (R() < 0.01) {
      const T2 = this.m.t, fx = Math.floor(this.pos.x), fy = Math.floor(this.pos.y), fz = Math.floor(this.pos.z);
      let n = 0;
      for (let y = fy - 4; y < fy + 4 && n < 14; y++) for (let z = fz - 4; z < fz + 4 && n < 14; z++) for (let x = fx - 4; x < fx + 4 && n < 14; x++) {
        const d = BLOCKS[T2.get(x, y, z)];
        if (d && (d.name === 'iron_bars' || /_bed$/.test(d.name))) { if (R() < 0.3) step++; n++; }
      }
    }
    this.cureT = Math.max(0, this.cureT - step);
    if (this.age % 20 === 0) this.m.particles('magic', this.pos.x, this.pos.y + 1.4, this.pos.z, 2, 0.4, [0.9, 0.3, 0.3]);
    if (!this.cureT) this.cured();
  }
  cured() {
    const v = this.m.spawn('villager', this.pos.x, this.pos.y, this.pos.z, { natural: false, yaw: this.yaw });
    if (!v) return;
    v.dataFromJSON(this.villager || { vt: 'plains' });
    if (this.ageT < 0 && v.setBaby) { v.setBaby(true); v.ageT = this.ageT; }
    // the one who cured it: its best prices for good
    if (this.curer && this.curer.isPlayer) { T.addGossip(v.gossip, 'major_positive'); T.addGossip(v.gossip, 'minor_positive'); }
    if (v.addEffect) v.addEffect('nausea', 1, 200);
    v.persistent = true;
    this.m.particles('sparkle', this.pos.x, this.pos.y + 1.6, this.pos.z, 10, 0.6);
    this.remove();
  }
  anim(A, a) { if (super.anim) super.anim(A, a); if (this.cureT) A.shake = true; }
  layers(out) {
    if (super.layers) super.layers(out);
    const d = this.villager;
    if (d) villagerLayers(out, 'zombie_villager', typeOf(d.vt || 'plains'), this.ageT < 0 ? 'none' : d.pr || 'none', d.lv || 1);
  }
  toJSON() { const o = super.toJSON(); if (this.villager) o.vd = this.villager; if (this.cureT) o.cure = this.cureT; return o; }
  fromJSON(o) { super.fromJSON(o); if (o.vd) this.villager = o.vd; this.cureT = o.cure | 0; }
}
register('zombie_villager', CurableZombieVillager);

/* ---------------------------------------------------------------------------
   The wandering trader (the wiki's Wandering Trader, Java Edition)

   Nine trades (two it buys, two special and five ordinary things it sells),
   no levels, no demand, no reputation in its prices. It keeps within 16
   blocks of where it came to, drinks a potion of Invisibility at nightfall
   and milk by day while still invisible, runs from zombies and illagers,
   and leaves after 48000 ticks (not counted while someone trades with it).
   Killed by a zombie it stays dead.

   Its coming: a counter starts at 24000 and falls by 1200 a minute; at 0 it
   starts again and, with a chance of 25% (then 50%, then 75% until one
   comes), one may come: a 10% chance, at the surface somewhere within 48
   blocks of you.
--------------------------------------------------------------------------- */
const VillagerDie = Object.getPrototypeOf(Villager.prototype).die;
export class WanderingTrader extends Villager {
  static TEX = 'wandering_trader';
  constructor(m, type) {
    super(m, type);
    this.offers = []; this.customer = null; this.isTrader = true;
    this.despawnT = 0; this.home = null; this.drinkT = 0; this.drinking = null;
  }
  registerGoals() {
    super.registerGoals();
    this.goals.add(1, new TradeGoal(this));
    this.goals.add(4, new HomeGoal(this));
  }
  spawnData(o) {
    if (o.json) return;
    if (!this.offers.length) this.offers = T.wanderingOffers();
    if (o.natural !== false && o.wandering) { this.despawnT = 48000; this.home = [this.pos.x, this.pos.y, this.pos.z]; }
  }
  get trades() { return this.offers.map(o => ({ give: [o.a].concat(o.b ? [o.b] : []), get: o.out, maxUses: o.maxUses, uses: o.uses })); }
  get canTrade() { return this.offers.length > 0; }
  get profession() { return 'wandering_trader'; }
  get vlevel() { return 0; }
  rep() { return 0; }
  interact(held) {
    if (held === 'name_tag' || this.dead || this.customer) return false;
    if (!this.canTrade) { this.shakeT = 40; return 'shake'; }
    return 'trade';
  }
  startTrading(player) { this.customer = player; this.stopMoving(); }
  stopTrading() { this.customer = null; }
  traded(o) {
    o.uses++;
    const h = this.m.hooks;
    if (h && h.giveXp) h.giveXp(3 + RI(4), this.pos.x, this.pos.y + 0.5, this.pos.z);
  }
  aiStep() {
    super.aiStep();
    if (this.dead) return;
    // its time here runs out (not while trading)
    if (this.despawnT > 0 && !this.customer && --this.despawnT === 0) { this.remove(); return; }
    // invisible by night, seen by day
    const inv = !!(this.effects && this.effects.invisibility), day = this.m.isDay();
    if (this.drinkT > 0) {
      this.stopMoving();
      if (--this.drinkT === 0) {
        if (this.drinking === 'potion') this.addEffect('invisibility', 1, 3600);
        else if (this.clearEffects) this.clearEffects();
        this.drinking = null;
      }
    } else if (!this.customer && ((!day && !inv) || (day && inv)) && RI(20) === 0) { this.drinkT = 32; this.drinking = day ? 'milk' : 'potion'; }
  }
  anim(A, a) { super.anim(A, a); A.drinking = this.drinkT > 0; }
  die(source) { VillagerDie.call(this, source); }
  toJSON() {
    const o = super.toJSON();
    o.wt = { of: T.offersToJSON(this.offers), d: this.despawnT, h: this.home };
    return o;
  }
  fromJSON(o) {
    super.fromJSON(o);
    if (o.wt) { this.offers = T.offersFromJSON(o.wt.of); this.despawnT = o.wt.d | 0; this.home = o.wt.h || null; }
  }
}
register('wandering_trader', WanderingTrader);
// back to within 16 blocks of where it came
class HomeGoal extends Goal {
  constructor(mob) { super(mob, MOVE); }
  canUse() {
    const v = this.mob, h = v.home;
    if (!h || v.customer || RI(40)) return false;
    return (v.pos.x - h[0]) ** 2 + (v.pos.z - h[2]) ** 2 > 256;
  }
  start() { const h = this.mob.home; this.mob.nav.moveTo(h[0], h[1], h[2], 0.35, 4); }
  canContinue() { return !this.mob.nav.isDone() && !this.mob.customer; }
  stop() { this.mob.nav.stop(); }
}
// the counter that brings one now and then
export function wandererTick(m) {
  if (m.age % 1200 !== 0 || m.dim !== 'overworld' || m.gone) return;
  const s = m.wt || (m.wt = { delay: 24000, chance: 25 });
  s.delay -= 1200;
  if (s.delay > 0) return;
  s.delay = 24000;
  const c = s.chance;
  s.chance = Math.max(25, Math.min(75, s.chance + 25));
  if (RI(100) > c || RI(10) !== 0) return;
  const P = m.P;
  for (let k = 0; k < 10; k++) {
    const x = Math.floor(P.pos.x) + RI(96) - 48, z = Math.floor(P.pos.z) + RI(96) - 48;
    if (!m.t.loaded(x, z)) continue;
    const y = m.t.motionTop(x, z);
    if (!m.t.solid(x, y - 1, z) || m.t.solid(x, y, z) || m.t.solid(x, y + 1, z)) continue;
    if (m.list.some(e => e.type === 'wandering_trader' && !e.dead)) return;
    const t = m.spawn('wandering_trader', x + 0.5, y, z + 0.5, { natural: true, wandering: true });
    if (t) { t.persistent = true; s.chance = 25; }
    return;
  }
}
export { villagerLayers, TYPES };
