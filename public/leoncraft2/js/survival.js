/* ---------------------------------------------------------------------------
   Leoncraft 2 - survival: health, hunger, air, fire, freezing, armour,
   effects, experience, dying and the totem.

   Numbers from the Minecraft Wiki and the game's own data (Java Edition 26.x).

   Hurting (the game's order): game rules and Fire Resistance can make you
   immune; difficulty scales a mob's damage and every explosion (Peaceful 0,
   Easy min(d/2 + 1, d), Hard 1.5 d); a falling block takes a quarter off
   with a helmet on. A fresh hit starts 20 ticks of invulnerability; while
   more than 10 are left only a harder hit counts, and only by how much
   harder. Then armour (damage x (1 - min(20, max(points / 5, points - 4 x
   damage / (toughness + 8))) / 25), each piece wearing by a quarter of the
   damage, at least 1), Resistance (20% a level), the Protection
   enchantments (4% a point, at most 80%) and Absorption hearts. What gets
   through to health costs the damage type's exhaustion (0.1 for most hits,
   none for falling, drowning, burning, starving, magic...). damage.js has the
   types and what goes straight through what.

   Falling: floor((distance + 0.000001 - 3 - Jump Boost) x the landing
   block's share), the distance counted to the ground (the landing move too):
   hay bales and honey 20%, beds 50%, slime none unless sneaking, pointed
   dripstone double with 2.5 more; water, cobwebs, ladders and powder snow
   stop the fall. Feather Falling is protection (3 points a level).

   Air: 300 ticks; a tick less each tick with the head under water (unless
   Water Breathing or Conduit Power; Respiration keeps it with chance
   level / (level + 1)); at -20 it goes back to 0 with 2 drowning damage;
   out of water it comes back 4 a tick.

   Fire: lava does 4 a tick (one in ten counts) and sets you burning for 15
   seconds, fire 1 a tick (soul fire 2), catching after a second in it and
   burning 8 seconds then; burning takes 1 every 20 ticks. Water, rain and
   powder snow put it out. Fire Protection shortens burning by 15% a level.
   Campfires 1 (soul 2) and magma blocks 1 (not sneaking), none with Frost
   Walker boots. Cactus 1, berry bushes 1 while moving through grown ones,
   the head in a solid block 1 (suffocating), the void 4, all a tick and
   held to one in ten by the window. Powder snow freezes you in 140 ticks
   (not with any leather armour on), and frozen solid you take 1 every 40;
   out of it the frost goes 2 a tick.

   Hunger (food 0-20, saturation 0-food, exhaustion 0-40): over 4.0 of
   exhaustion takes a point of saturation, or of food when saturation is
   gone (not on Peaceful). Sprinting 0.1 a metre on the ground, swimming
   0.01 a metre, a jump 0.05 (0.2 sprinting), an attack 0.1, a block broken
   0.005, healing 6 a point. Natural regeneration (the game rule): with a
   full bar and saturation left, min(saturation, 6) / 6 every 10 ticks for
   that much exhaustion; at 18 or more a point every 80 ticks; starving at 0
   a point every 80 ticks, down to 10 on Easy, 1 on Normal, death on Hard.
   Peaceful heals a point a second and refills a hunger point every half
   second. No sprinting at 6 or less, or blind.

   Effects (name -> { level (1 = I), ticks (-1 for ever) }): Regeneration a
   point every 50 >> (level - 1) ticks, Poison every 25 >> (level - 1) (not
   below 1), Wither every 40 >> (level - 1), Hunger 0.005 x level exhaustion
   a tick, Saturation level food and 2 x level saturation a tick, Health
   Boost 4 more health a level, Absorption 4 gold health a level. A weaker
   effect given while a stronger one runs waits underneath it and takes over
   when it ends, as the game does.

   Dying: a totem of undying in either hand (main hand first) saves you from
   anything but the void and /kill: health 1, every effect gone, then
   Regeneration II 45 s, Absorption II 5 s, Fire Resistance 40 s. Otherwise
   the death message (damage.js), the death screen, and 7 experience a level
   (at most 100) left behind.

   Experience: a level takes 2L + 7 points up to 15, 5L - 38 up to 30, and
   9L - 158 after that.
--------------------------------------------------------------------------- */
import { B, BLOCKS, FLUID } from './blocks.js?v=107';
import { I, ITEMS, armorOf } from './items.js?v=107';
import { wear } from './ui/inventory.js?v=107';
import { sourceOf, deathMessage } from './damage.js?v=107';
import { effectId, EFFECTS } from './effects.js?v=107';

const BYPASS_ARMOR = new Set(['fall', 'drown', 'starve', 'void', 'magic', 'poison', 'wither', 'suffocation', 'generic', 'freeze', 'kill']);
const FIRE = new Set(['lava', 'fire', 'on_fire', 'hot_floor']);
const NO_EXHAUSTION = new Set(['starve', 'void', 'kill', 'poison', 'magic', 'wither']);

export function xpForLevel(level) { return level >= 30 ? 9 * level - 158 : level >= 15 ? 5 * level - 38 : 2 * level + 7; }
const has = n => B[n] !== undefined;
const id = n => (has(n) ? B[n] : -1);
const nameOf = b => (BLOCKS[b] ? BLOCKS[b].name : '');
// the head inside one of these hurts (whole, solid, opaque cubes: not glass, leaves or ice)
// (powder snow is a full opaque cube to us but never suffocates in the game: it only freezes)
const suffocates = b => { const d = BLOCKS[b]; return !!d && d.solid && d.shape === 'cube' && (d.pass || 'opaque') === 'opaque' && !FLUID[b] && b !== B.powder_snow; };
const CLIMB_NAMES = new Set(['ladder', 'vine', 'weeping_vines', 'weeping_vines_plant', 'twisting_vines', 'twisting_vines_plant', 'scaffolding', 'cave_vines', 'cave_vines_plant']);
const FIRE_TICKS_IMMUNE = 20;          // a player's fire goes to -20 when it is out: the second it takes to catch again

export class Survival {
  constructor() {
    this.inv = null;
    /* what the world round tells us (main.js sets these):
         difficulty() 'peaceful'..'hard', rule(name) a game rule, mode() the game mode,
         rainingAt(x, y, z), onDeath(message), onTotem(), onHurt(source) */
    this.hooks = {};
    this.level = 0; this.xpProgress = 0; this.xpTotal = 0; this.score = 0;
    this.enchantSeed = (Math.random() * 2147483647) | 0;
    this.spawnPoint = null;           // { dim, x, y, z, kind: 'bed'|'anchor'|'point', forced }
    this.reset();
  }
  reset() {
    this.health = 20; this.food = 20; this.saturation = 5; this.exhaustion = 0; this.air = 300;
    this.fallFrom = null; this.foodTimer = 0; this.burn = 0; this.voidT = 0;
    this.dead = false; this.hurtTime = 0; this.lastHealth = 20; this.invul = 0; this.lastHurt = 0;
    this.absorption = 0; this.effects = {};
    this.lastSource = null; this.deathMessage = ''; this.deathTime = 0; this.hitResult = '';
    this.fire = -FIRE_TICKS_IMMUNE; this.frozen = 0; this.inPowderSnow = false;
    this.hurtDir = 0; this.age = 0;
    this.attacker = null; this.attackerAge = -1e9;
    this.fights = [];                 // the last few hits: { src, dmg, fall, from, age }
    this.climbFrom = null;            // the climbable block a fall started from
    this.totemT = 0;                  // ticks left of the totem's show
    this.prevSwim = 0;
  }
  difficulty() { return (this.hooks.difficulty && this.hooks.difficulty()) || 'normal'; }
  rule(name, dflt = true) { const v = this.hooks.rule ? this.hooks.rule(name) : undefined; return v === undefined ? dflt : v; }
  get creative() { const m = this.hooks.mode ? this.hooks.mode() : 'survival'; return m === 'creative' || m === 'spectator'; }
  // 20, and 4 more a level of Health Boost
  get maxHealth() { return 20 + 4 * this.effectLevel('health_boost'); }

  /* ---- damage ---- */
  // the hit after armour, effects and enchantments, for a type (what the combat code can ask before hurting)
  damageReduction(amount, source) {
    const src = sourceOf(source), def = src.def;
    if (def.fire && this.effects.fire_resistance) return 0;
    let dmg = def.armor ? this.afterArmor(amount) : amount;
    return Math.max(0, this.afterMagic(dmg, src));
  }
  // (Breach on the weapon takes 15 percentage points a level off what the armour stops, as weapons.js afterArmor and the game's CombatRules)
  afterArmor(dmg, breach) {
    const { points, toughness } = this.armorValues();
    return dmg * (1 - Math.max(0, Math.min(20, Math.max(points / 5, points - 4 * dmg / (toughness + 8))) / 25 - 0.15 * (breach || 0)));
  }
  // Resistance, then the Protection enchantments (both passed over by starving; the void and /kill pass Resistance)
  afterMagic(dmg, src) {
    const def = src.def;
    if (!def.effects) return dmg;
    const r = this.effectLevel('resistance');
    if (r > 0 && def.resistance) dmg = Math.max(dmg * (25 - r * 5) / 25, 0);
    if (dmg <= 0) return 0;
    if (!def.enchant) return dmg;
    const epf = this.protectionPoints(src);
    return epf > 0 ? dmg * (1 - Math.min(20, epf) / 25) : dmg;
  }
  // armour points, toughness and knockback resistance worn (one object, reused)
  armorValues() {
    let points = 0, toughness = 0, knockback = 0;
    const a = this.inv ? this.inv.armor : null;
    if (a) for (let i = 0; i < 4; i++) { const s = a[i], ar = s && armorOf(s.id); if (ar) { points += ar.points; toughness += ar.toughness; knockback += ar.knockback; } }
    const o = this._av || (this._av = { points: 0, toughness: 0, knockback: 0 });
    o.points = points; o.toughness = toughness; o.knockback = knockback;
    return o;
  }
  // the armour's protection enchantments against a kind of damage (a source, or a type name)
  protectionPoints(source) {
    const src = source && source.def ? source : sourceOf(source), def = src.def;
    const a = this.inv ? this.inv.armor : null;
    if (!a || def.invul || !def.enchant) return 0;
    let p = 0;
    for (const s of a) {
      if (!s || !s.ench) continue;
      const e = s.ench;
      p += (e.protection || 0);
      if (def.fire) p += 2 * (e.fire_protection || 0);
      if (def.fall) p += 3 * (e.feather_falling || 0);
      if (def.explosion) p += 2 * (e.blast_protection || 0);
      if (def.projectile) p += 2 * (e.projectile_protection || 0);
    }
    return p;
  }
  armorEnchant(name) { let n = 0; const a = this.inv ? this.inv.armor : null; if (a) for (const s of a) if (s && s.ench && s.ench[name]) n += s.ench[name]; return n; }
  bootsEnchant(name) { const s = this.inv && this.inv.armor[3]; return s && s.ench && s.ench[name] ? s.ench[name] : 0; }
  helmetEnchant(name) { const h = this.inv && this.inv.armor[0]; return h && h.ench && h.ench[name] ? h.ench[name] : 0; }

  /* A hit of amount points (half hearts). source: a type name ('fall',
     'lava', 'drown'... see damage.js) or { type, attacker, x, z } from the
     mobs. Returns the health it took (0 when it did not count); hitResult
     says 'fresh', 'extra' (a harder hit inside the window), 'ignored' or
     'immune'. */
  hurt(amount, source) {
    this.hitResult = 'ignored';
    if (this.dead || !(amount > 0)) return 0;
    const src = sourceOf(source), def = src.def;
    if (this.creative && !def.invul) { this.hitResult = 'immune'; return 0; }
    if ((def.drowning && !this.rule('drowningDamage')) || (def.fall && !this.rule('fallDamage')) || (def.fire && !this.rule('fireDamage')) || (def.freezing && !this.rule('freezeDamage'))) { this.hitResult = 'immune'; return 0; }
    if (def.fire && this.effects.fire_resistance) { this.hitResult = 'immune'; return 0; }
    // difficulty: a mob's hit, and every explosion
    const a = src.attacker;
    if (def.scale === 'always' || (a && !a.isPlayer && (a.alive || a.hurt))) {
      const d = this.difficulty();
      if (d === 'peaceful') amount = 0;
      else if (d === 'easy') amount = Math.min(amount / 2 + 1, amount);
      else if (d === 'hard') amount = amount * 3 / 2;
    }
    if (amount <= 0) return 0;
    // a falling block: the helmet takes it, and a quarter of it
    if (def.helmet && this.inv && this.inv.armor[0]) {
      const h = this.inv.armor[0];
      if (ITEMS[h.id] && ITEMS[h.id].dur && wear(h, Math.floor(amount * 4 + Math.random() * amount * 2), true)) { this.inv.armor[0] = null; this.inv.emit('broke', h); }
      this.inv.changed();
      amount *= 0.75;
    }
    let dealt;
    if (this.invul > 10) {
      if (amount <= this.lastHurt) return 0;
      dealt = this.actuallyHurt(src, amount - this.lastHurt);
      this.lastHurt = amount;
      this.hitResult = 'extra';
    } else {
      this.lastHurt = amount; this.invul = 20;
      dealt = this.actuallyHurt(src, amount);
      this.hurtTime = 10;
      this.hitResult = 'fresh';
      // which way the screen tips: towards where it came from
      this.hurtDir = 0;
      const sx = src.attacker && src.attacker.pos ? src.attacker.pos.x : src.x, sz = src.attacker && src.attacker.pos ? src.attacker.pos.z : src.z;
      if (sx !== undefined && sz !== undefined && this.hooks.player) {
        const p = this.hooks.player();
        if (p) this.hurtDir = Math.atan2(sz - p.pos.z, sx - p.pos.x) - (Math.PI - p.yaw);
      }
      if (this.hooks.onHurt) this.hooks.onHurt(src);
    }
    // the mob that hurt you is named in a death in the next 5 seconds
    if (a && (a.alive || a.hurt)) { this.attacker = a; this.attackerAge = this.age; }
    if (this.health <= 0) this.dying(src);
    return dealt;
  }
  // armour, effects, enchantments, absorption, then health
  actuallyHurt(src, amount) {
    const def = src.def;
    if (def.armor) { this.wearArmor(amount, def); amount = this.afterArmor(amount, src.raw && src.raw.breach); }
    amount = this.afterMagic(amount, src);
    const health = Math.max(amount - this.absorption, 0);
    this.absorption -= amount - health;
    if (this.absorption < 1e-9) this.absorption = 0;
    if (health === 0) return 0;
    this.exhaust(def.exh);
    this.fights.push({ src, dmg: health, fall: src.raw.fall || 0, from: src.raw.from || null, age: this.age });
    if (this.fights.length > 16) this.fights.shift();
    this.health = Math.max(0, this.health - health);
    this.lastSource = src.type;
    return health;
  }
  // each piece wears by a quarter of the hit, at least 1 (netherite does not burn)
  wearArmor(amount, def) {
    if (!this.inv) return;
    const w = Math.max(1, Math.floor(amount / 4)), a = this.inv.armor;
    let changed = false;
    for (let i = 0; i < 4; i++) {
      const s = a[i], it = s && ITEMS[s.id];
      if (!it || !it.dur || !it.armor) continue;
      if (def.fire && it.armor.material === 'netherite') continue;
      changed = true;
      if (wear(s, w, true)) { a[i] = null; this.inv.emit('broke', s); }
    }
    if (changed) this.inv.changed();
  }
  heal(n) { if (!this.dead && this.health > 0) this.health = Math.min(this.maxHealth, this.health + n); }
  // the old name for a hit from an effect (Instant Damage, Poison): it goes through the window like any other
  hurtEffect(n, source) { return this.hurt(n, source || 'magic'); }

  /* ---- dying ---- */
  dying(src) {
    if (this.useTotem(src)) return;
    this.dead = true; this.health = 0; this.deathTime = 0;
    this.lastSource = src.type;
    // the longest fall in this fight, and who to blame
    let fall = null;
    for (const f of this.fights) if (this.age - f.age < 300 && f.fall > (fall ? fall.dist : 0)) fall = { dist: f.fall, from: f.from };
    const killer = this.attacker && this.age - this.attackerAge <= 100 ? this.attacker : null;
    this.deathMessage = deathMessage(this.hooks.name ? this.hooks.name() : 'Player', src, fall, killer);
    if (this.hooks.onDeath) this.hooks.onDeath(this.deathMessage, src);
  }
  // a totem in either hand: health 1, the effects gone, then Regeneration II, Absorption II, Fire Resistance
  useTotem(src) {
    if (src.def.invul || !this.inv || I.totem_of_undying === undefined) return false;
    const inv = this.inv, T = I.totem_of_undying;
    let from = null;
    if (inv.slots[inv.selected] && inv.slots[inv.selected].id === T) from = 'main';
    else if (inv.offhand && inv.offhand.id === T) from = 'off';
    if (!from) return false;
    if (from === 'main') { const s = inv.slots[inv.selected]; if (--s.count <= 0) inv.slots[inv.selected] = null; }
    else if (--inv.offhand.count <= 0) inv.offhand = null;
    inv.changed();
    this.health = 1;
    this.clearEffects();
    this.addEffect('regeneration', 2, 900);
    this.addEffect('absorption', 2, 100);
    this.addEffect('fire_resistance', 1, 800);
    this.totemT = 40;
    if (this.hooks.onTotem) this.hooks.onTotem();
    return true;
  }
  // what a death leaves behind: 7 a level, at most 100
  deathXp() { return Math.min(100, this.level * 7); }
  /* Back from the dead (the respawn): full health and food, no effects, no
     fire; experience and the score kept only with keepInventory. */
  respawn(keep) {
    const lv = this.level, xp = this.xpProgress, tot = this.xpTotal, sc = this.score;
    this.reset();
    if (keep) { this.level = lv; this.xpProgress = xp; this.xpTotal = tot; this.score = sc; }
    else { this.level = 0; this.xpProgress = 0; this.xpTotal = 0; this.score = 0; }
  }

  /* ---- hunger ---- */
  // (a creative or spectating player never tires, as in the game)
  exhaust(n) { if (n > 0 && !this.creative) this.exhaustion = Math.min(40, this.exhaustion + n); }
  canSprint() { return this.food > 6 && !this.effects.blindness || this.creative; }
  // a food eaten: hunger and saturation (saturation never above the food level), then its effects
  eat(hunger, saturation) {
    this.food = Math.max(0, Math.min(20, this.food + hunger));
    this.saturation = Math.max(0, Math.min(this.food, this.saturation + saturation));
  }
  wantsFood(always) { return always || this.food < 20; }

  /* ---- effects: name -> { level (1 = I), ticks (-1 for ever), hidden: a weaker one waiting } ---- */
  addEffect(name, level, ticks, opts) {
    const n = effectId(name) || name;
    level = Math.max(1, level | 0);
    const def = EFFECTS[n];
    // the instant ones act now
    if (def && def.instant && n !== 'saturation') {
      if (n === 'instant_health') this.heal(Math.max(4 << (level - 1), 0));
      else this.hurt(6 << (level - 1), 'magic');
      return true;
    }
    if (n === 'wither' && this.difficulty() === 'peaceful' && opts && opts.rose) return false;
    const fresh = { level, ticks: ticks < 0 || ticks === Infinity ? -1 : Math.max(1, ticks | 0) };
    if (opts && opts.ambient) fresh.ambient = true;
    if (opts && opts.hideParticles) fresh.particles = false;
    const e = this.effects[n];
    if (!e) { this.effects[n] = fresh; this.started(n, fresh); return true; }
    const was = e.ticks, r = this.update(e, fresh);
    if (r !== e) { this.effects[n] = r; this.started(n, r); return true; }
    return e.ticks !== was || e.hidden === fresh;
  }
  /* The game's MobEffectInstance.update: a stronger one replaces it (the old
     one waiting underneath if it would outlast it), the same level lasts
     longer, a weaker but longer one waits underneath. Returns what stands in
     its place. */
  update(e, fresh) {
    const longer = (a, b) => a.ticks === -1 ? b.ticks !== -1 : b.ticks !== -1 && a.ticks > b.ticks;
    if (fresh.level > e.level) { if (longer(e, fresh)) fresh.hidden = e; return fresh; }
    if (fresh.level === e.level) { if (longer(fresh, e)) e.ticks = fresh.ticks; return e; }
    if (longer(fresh, e)) e.hidden = e.hidden ? this.update(e.hidden, fresh) : fresh;
    return e;
  }
  // an effect starting: Absorption fills its hearts
  started(n, e) {
    if (n === 'absorption') this.absorption = Math.max(this.absorption, 4 * e.level);
  }
  removeEffect(name) {
    const n = effectId(name) || name;
    if (!this.effects[n]) return false;
    delete this.effects[n];
    this.ended(n, null);
    return true;
  }
  // an effect ending (or making way for the one under it)
  ended(n, next) {
    if (n === 'absorption') this.absorption = Math.min(this.absorption, next ? 4 * next.level : 0);
    if (n === 'health_boost') this.health = Math.min(this.health, this.maxHealth);
  }
  clearEffects() {
    const had = Object.keys(this.effects).length > 0;
    for (const n of Object.keys(this.effects)) { delete this.effects[n]; this.ended(n, null); }
    return had;
  }
  effectLevel(name) { const e = this.effects[name]; return e ? e.level : 0; }
  // the levels mining.js wants
  miningEffects() { return { haste: this.effectLevel('haste'), mining_fatigue: this.effectLevel('mining_fatigue'), conduit_power: this.effectLevel('conduit_power') }; }
  tickEffects() {
    for (const name of Object.keys(this.effects)) {
      const e = this.effects[name];
      if (!e) continue;
      const lv = e.level, t = e.ticks === -1 ? this.age : e.ticks;
      if (e.ticks !== 0) {
        switch (name) {
          case 'regeneration': { const k = 50 >> (lv - 1); if (k <= 0 || t % k === 0) { if (this.health < this.maxHealth) this.heal(1); } break; }
          case 'poison': { const k = 25 >> (lv - 1); if ((k <= 0 || t % k === 0) && this.health > 1) this.hurt(1, 'magic'); break; }
          case 'wither': { const k = 40 >> (lv - 1); if (k <= 0 || t % k === 0) this.hurt(1, 'wither'); break; }
          case 'hunger': this.exhaust(0.005 * lv); break;
          case 'saturation': this.eat(lv, 2 * lv); break;
        }
        if (this.dead) return;
      }
      if (e !== this.effects[name]) continue;
      if (e.hidden && e.hidden.ticks > 0) e.hidden.ticks--;
      if (e.ticks > 0) e.ticks--;
      if (e.ticks === 0) {
        // the weaker one waiting underneath takes over, if it has time left
        let h = e.hidden;
        while (h && h.ticks === 0) h = h.hidden;
        if (h) { this.effects[name] = h; this.ended(name, h); this.started(name, h); }
        else { delete this.effects[name]; this.ended(name, null); }
      }
    }
  }

  /* ---- fire ---- */
  // set alight for this many ticks, less with Fire Protection (15% a level)
  ignite(ticks) {
    const fp = this.armorEnchant('fire_protection');
    const t = Math.floor(ticks * Math.max(0, 1 - 0.15 * fp));
    if (this.fire < t) this.fire = t;
  }
  get onFire() { return this.fire > 0; }
  extinguish() { if (this.fire > 0) this.fire = 0; }
  // struck: 5 damage, and a burn if the last strike's fire had gone out
  struckByLightning() {
    this.fire++;
    if (this.fire === 0) this.ignite(160);
    this.hurt(5, 'lightning_bolt');
  }

  /* ---- experience ---- */
  // points in (or, negative, out): whole points are kept exact, so 315 points from nothing is level 15
  addXp(points) {
    points = Math.trunc(points) || 0;
    if (points > 0) this.score += points;
    this.xpTotal = Math.max(0, this.xpTotal + points);
    let need = xpForLevel(this.level), pts = Math.round((this.xpProgress * need + points) * 1e6) / 1e6;
    while (pts >= need) { pts -= need; this.level++; need = xpForLevel(this.level); }
    while (pts < 0 && this.level > 0) { this.level--; need = xpForLevel(this.level); pts += need; }
    if (pts < 0) pts = 0;
    this.xpProgress = pts / need;
  }
  addLevels(n) { this.level = Math.max(0, this.level + n); if (this.level === 0 && n < 0) this.xpProgress = 0; }
  // the points into the level you are on
  xpPoints() { return Math.round(this.xpProgress * xpForLevel(this.level)); }

  /* ---- once a tick (20 a second), in survival and adventure ---- */
  tick(player) {
    if (this.dead) { this.deathTime++; return; }
    this.age++;
    this.lastHealth = this.health;
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.invul > 0) this.invul--;
    if (this.totemT > 0) this.totemT--;
    const P = player, w = P.w;
    // burning: a point every second (not in lava, which hurts on its own); frost melts
    if (this.fire > 0) {
      if (this.fire % 20 === 0 && !P.inLava) this.hurt(1, 'on_fire');
      this.fire--;
      if (this.frozen > 0) this.frozen = 0;
    }
    // lava: 4 a tick, and alight for 15 seconds
    if (P.inLava) { this.ignite(300); this.hurt(4, 'lava'); }
    // the void: 64 below the dimension's floor (player.voidY, set per dimension by main.js)
    if (P.pos.y < (P.voidY ?? -64)) this.hurt(4, 'out_of_world');
    // the head in a solid block
    // (noSuffocate: a server's minigame turns it off, Leon Network's Chameleon)
    if (!P.noclip && !this.noSuffocate && w && this.inWall(P)) this.hurt(1, 'in_wall');
    // gliding into a wall (player.js)
    if (P.wallHit) { this.hurt(P.wallHit, 'fly_into_wall'); P.wallHit = 0; }
    this.breathe(P);
    if (this.dead) return;
    this.tickEffects();
    if (this.dead) return;
    this.moved(P);
    this.landing(P);
    if (w) this.touching(P, w);
    this.freezing(P);
    // Peaceful: a point of health a second, a point of food each half second
    if (this.difficulty() === 'peaceful' && this.rule('naturalRegeneration') && !this.noRegen) {
      if (this.health < this.maxHealth && this.age % 20 === 0) this.heal(1);
      if (this.food < 20 && this.age % 10 === 0) this.food++;
    }
    this.tickFood();
    // old fights are forgotten
    if (this.fights.length && this.age - this.fights[0].age > 300) this.fights.shift();
  }
  /* Once a tick in creative: effects still run their course (Night Vision
     wears off, Regeneration heals), and the void still kills, the one
     damage creative is not safe from; nothing else here can hurt. */
  creativeTick(P) {
    if (this.dead) { this.deathTime++; return; }
    this.age++;
    this.lastHealth = this.health;
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.invul > 0) this.invul--;
    if (this.totemT > 0) this.totemT--;
    if (this.fire > 0) this.fire--;
    if (this.air < 300) this.air = Math.min(300, this.air + 4);
    if (P.pos.y < (P.voidY ?? -64)) this.hurt(4, 'out_of_world');
    if (!this.dead) this.tickEffects();
  }
  // the eye inside a suffocating block (a box 0.48 across at the eye, as the game checks)
  inWall(P) {
    const w = P.w, ey = P.pos.y + (P.eyeH || 1.62), r = 0.24, y = Math.floor(ey);
    for (let x = Math.floor(P.pos.x - r); x <= Math.floor(P.pos.x + r); x++)
      for (let z = Math.floor(P.pos.z - r); z <= Math.floor(P.pos.z + r); z++)
        if (suffocates(w.get(x, y, z))) return true;
    return false;
  }
  // air under water, Respiration, Water Breathing and Conduit Power
  breathe(P) {
    const eyeIn = P.eyeInWater && !(P.w && nameOf(P.w.get(Math.floor(P.pos.x), Math.floor(P.pos.y + (P.eyeH || 1.62)), Math.floor(P.pos.z))) === 'bubble_column');
    if (eyeIn) {
      // (riding a nautilus, Breath of the Nautilus holds the air where it is)
      if (this.effects.breath_of_the_nautilus) return;
      if (!this.effects.water_breathing && !this.effects.conduit_power) {
        const resp = this.helmetEnchant('respiration');
        if (!(resp > 0 && Math.random() >= 1 / (resp + 1))) this.air--;
        if (this.air <= -20) { this.air = 0; this.hurt(2, 'drown'); }
      }
    } else if (this.air < 300) this.air = Math.min(300, this.air + 4);
  }
  // exhaustion for moving (to the centimetre, as the game counts it), and a jump's worth
  moved(P) {
    const dx = P.pos.x - P.prev.x, dy = P.pos.y - P.prev.y, dz = P.pos.z - P.prev.z;
    if (!P.flying && !(this.hooks.riding && this.hooks.riding())) {
      const cm3 = Math.round(Math.sqrt(dx * dx + dy * dy + dz * dz) * 100), cm2 = Math.round(Math.sqrt(dx * dx + dz * dz) * 100);
      if (P.swimming || P.eyeInWater) { if (cm3 > 0) this.exhaust(0.01 * cm3 * 0.01); }
      else if (P.inWater) { if (cm2 > 0) this.exhaust(0.01 * cm2 * 0.01); }
      else if (P.onGround && P.sprinting && cm2 > 0) this.exhaust(0.1 * cm2 * 0.01);
      if (P.jumped) this.exhaust(P.sprinting ? 0.2 : 0.05);
    }
    P.jumped = false;
    // where a fall begins: the climbable block you were on, or nothing once you stand on the ground
    if (P.climbing && P.w) { const n = nameOf(P.w.get(Math.floor(P.pos.x), Math.floor(P.pos.y), Math.floor(P.pos.z))); this.climbFrom = CLIMB_NAMES.has(n) ? n : 'other'; }
    else if (P.onGround || P.inWater) this.climbFrom = P.inWater ? 'water' : null;
  }
  /* The fall the player counted on the way down (player.js), spent when it
     lands: hay and honey take 80% of it, a bed half, slime all of it unless
     you land sneaking, a stalagmite doubles it with 2.5 more; Jump Boost
     takes a block a level; Slow Falling never hurts. */
  landing(P) {
    // thrown up by your own wind charge (entities/mobs7.js): only what you fall below where it threw you from counts,
    // the game's impulse rule; spent on the first landing, in water or flying
    let from;
    if (P.impulseY !== undefined && (P.landed || P.inWater || P.flying || P.climbing)) { from = P.impulseY; P.impulseY = undefined; }
    if (this.effects.slow_falling) { P.fallDistance = 0; P.landed = null; return; }
    const l = P.landed;
    if (!l) return;
    P.landed = null;
    if (P.flying || P.inWater) return;
    const name = nameOf(l.block);
    const feet = P.w ? nameOf(P.w.get(Math.floor(P.pos.x), Math.floor(P.pos.y), Math.floor(P.pos.z))) : '';
    let dist = l.dist, k = 1, type = 'fall';
    if (from !== undefined) { if (from <= P.pos.y) return; dist = Math.min(dist, from - P.pos.y); }
    if (feet === 'pointed_dripstone') { dist += 2.5; k = 2; type = 'stalagmite'; }
    else if (name === 'slime_block') k = P.sneaking ? 1 : 0;
    else if (name === 'hay_block' || name === 'honey_block') k = 0.2;
    else if (/_bed$/.test(name)) k = 0.5;
    else if (name === 'powder_snow') k = 0;
    // the game's calculateFallPower: a millionth more, so a fall of exactly h blocks is h, then rounded down
    const n = Math.floor((dist + 1e-6 - 3 - this.effectLevel('jump_boost')) * k);
    if (n > 0) this.hurt(n, { type, fall: l.dist, from: this.climbFrom });
    this.climbFrom = null;
  }
  /* The blocks the body is in (cactus, berry bushes, fire, campfires, wither
     roses, powder snow) and the one under the feet (magma). */
  touching(P, w) {
    const p = P.pos, e = 1e-5, h = P.h || 1.8;
    let fire = 0, lava = P.inLava, snow = false;
    for (let y = Math.floor(p.y + e); y <= Math.floor(p.y + h - e); y++)
      for (let z = Math.floor(p.z - 0.3 + e); z <= Math.floor(p.z + 0.3 - e); z++)
        for (let x = Math.floor(p.x - 0.3 + e); x <= Math.floor(p.x + 0.3 - e); x++) {
          const b = w.get(x, y, z);
          if (!b) continue;
          const n = nameOf(b);
          switch (n) {
            case 'cactus': this.hurt(1, 'cactus'); break;
            case 'sweet_berry_bush': {
              const moved = Math.abs(p.x - P.prev.x) >= 0.003 || Math.abs(p.z - P.prev.z) >= 0.003;
              if ((w.meta(x, y, z) & 7) > 0 && moved) this.hurt(1, 'sweet_berry_bush');
              break;
            }
            case 'fire': case 'soul_fire': fire = Math.max(fire, n === 'soul_fire' ? 2 : 1); break;
            case 'campfire': case 'soul_campfire':
              if (!this.bootsEnchant('frost_walker')) this.hurt(n === 'soul_campfire' ? 2 : 1, 'campfire');
              break;
            case 'wither_rose': if (this.difficulty() !== 'peaceful') this.addEffect('wither', 1, 40, { rose: true }); break;
            case 'powder_snow': snow = true; break;
            case 'lava': lava = true; break;
          }
        }
    // fire: a second to catch, then 8 seconds (longer the more you stand in it)
    if (fire) {
      if (this.fire < 0) this.fire++;
      else this.fire += 1 + Math.floor(Math.random() * 2);
      if (this.fire >= 0) this.ignite(160);
      this.hurt(fire, 'in_fire');
    } else if (!lava && this.fire <= 0) this.fire = -FIRE_TICKS_IMMUNE;
    this.inPowderSnow = snow;
    // water, rain and powder snow put it out
    if (this.fire > 0 && (P.inWater || snow || (this.hooks.rainingAt && (this.hooks.rainingAt(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) || this.hooks.rainingAt(Math.floor(p.x), Math.floor(p.y + h), Math.floor(p.z))))))
      this.fire = -FIRE_TICKS_IMMUNE;
    // magma under the feet (not sneaking, not with Frost Walker)
    if (P.onGround && !P.sneaking && P.under && nameOf(P.under()) === 'magma_block' && !this.bootsEnchant('frost_walker')) this.hurt(1, 'hot_floor');
  }
  // any leather armour keeps the cold out
  canFreeze() {
    const a = this.inv ? this.inv.armor : null;
    if (a) for (const s of a) { const ar = s && armorOf(s.id); if (ar && ar.material === 'leather') return false; }
    return !this.creative;
  }
  freezing(P) {
    const can = this.canFreeze();
    if (this.inPowderSnow && can) this.frozen = Math.min(140, this.frozen + 1);
    else this.frozen = Math.max(0, this.frozen - 2);
    if (this.age % 40 === 0 && this.frozen >= 140 && can) this.hurt(1, 'freeze');
  }
  // the game's FoodData tick
  tickFood() {
    const d = this.difficulty();
    if (this.exhaustion > 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(this.saturation - 1, 0);
      else if (d !== 'peaceful') this.food = Math.max(this.food - 1, 0);
    }
    // (noRegen: a server's minigame turns it off, Leon Network's Prop Hunt seekers)
    const regen = this.rule('naturalRegeneration') && !this.noRegen, hurt = this.health > 0 && this.health < this.maxHealth;
    if (regen && this.saturation > 0 && hurt && this.food >= 20) {
      if (++this.foodTimer >= 10) {
        const f = Math.min(this.saturation, 6);
        this.heal(f / 6);
        this.exhaust(f);
        this.foodTimer = 0;
      }
    } else if (regen && this.food >= 18 && hurt) {
      if (++this.foodTimer >= 80) { this.heal(1); this.exhaust(6); this.foodTimer = 0; }
    } else if (this.food <= 0) {
      if (++this.foodTimer >= 80) {
        if (this.health > 10 || d === 'hard' || (this.health > 1 && d === 'normal')) this.hurt(1, 'starve');
        this.foodTimer = 0;
      }
    } else this.foodTimer = 0;
  }

  /* ---- the screen ---- */
  // the tip of the view when hurt, and the slow roll of a death: { roll, pitch } in radians
  viewTilt(alpha, strength = 1) {
    const o = this._tilt || (this._tilt = { roll: 0, pitch: 0 });
    o.roll = 0; o.pitch = 0;
    if (this.dead) { const f = Math.min(this.deathTime + alpha, 20); o.roll -= (40 - 8000 / (f + 200)) * Math.PI / 180; }
    let f = this.hurtTime - alpha;
    if (f >= 0 && this.hurtTime > 0) {
      f /= 10;
      const a = Math.sin(f * f * f * f * Math.PI) * 14 * strength * Math.PI / 180;
      o.roll += a * Math.cos(this.hurtDir);
      o.pitch -= a * Math.sin(this.hurtDir);
    }
    return o;
  }
  // what the HUD shows (one object, refilled every frame: nothing new is made)
  stats() {
    const ef = this.effects, o = this._st || (this._st = {});
    o.health = this.health; o.maxHealth = this.maxHealth; o.food = this.food; o.saturation = this.saturation; o.air = Math.max(0, this.air);
    o.xp = this.xpProgress; o.level = this.level; o.armor = this.armorValues().points; o.hurt = this.hurtTime; o.invul = this.invul;
    o.absorption = this.absorption; o.poison = !!ef.poison; o.wither = !!ef.wither; o.hungerEffect = !!ef.hunger; o.regen = !!ef.regeneration;
    o.frozen = this.frozen >= 140; o.freeze = Math.min(1, this.frozen / 140); o.fire = this.fire > 0; o.totem = this.totemT;
    o.hardcore = !!(this.hooks.hardcore && this.hooks.hardcore());
    return o;
  }
  toJSON() {
    return { health: this.health, food: this.food, saturation: this.saturation, exhaustion: this.exhaustion, air: this.air,
      level: this.level, xp: this.xpProgress, xpTotal: this.xpTotal, score: this.score, absorption: this.absorption, effects: this.effects,
      enchantSeed: this.enchantSeed, fire: this.fire, frozen: this.frozen, spawnPoint: this.spawnPoint, foodTimer: this.foodTimer };
  }
  fromJSON(o) {
    if (!o) return;
    this.health = o.health ?? 20; this.food = o.food ?? 20; this.air = o.air ?? 300;
    this.saturation = o.saturation ?? 5; this.exhaustion = o.exhaustion ?? 0;
    this.level = o.level | 0; this.xpProgress = o.xp || 0; this.xpTotal = o.xpTotal | 0; this.score = o.score | 0;
    this.absorption = o.absorption || 0; this.effects = o.effects && typeof o.effects === 'object' ? o.effects : {};
    for (const n in this.effects) { const e = this.effects[n]; if (!e || typeof e.level !== 'number') delete this.effects[n]; else if (e.ticks === null) e.ticks = -1; }
    if (o.enchantSeed) this.enchantSeed = o.enchantSeed | 0;
    this.fire = typeof o.fire === 'number' ? o.fire : -FIRE_TICKS_IMMUNE; this.frozen = o.frozen | 0;
    this.spawnPoint = o.spawnPoint || null; this.foodTimer = o.foodTimer | 0;
    this.dead = this.health <= 0;
  }
}

/* The old hand-only answers, kept for anything still asking them (mining.js
   and loot.js are the real ones now). */
export function breakTime(d) {
  if (!d || d.hardness === undefined) return 0.3;
  if (d.hardness < 0) return Infinity;
  if (d.hardness === 0) return 0;
  return Math.min(20, d.hardness * 1.5);
}
export function dropOf(b) {
  const d = BLOCKS[b];
  if (!d) return 0;
  if (d.lower) return dropOf(B[d.lower]);
  return FLUID[b] || d.item === false ? 0 : b;
}
