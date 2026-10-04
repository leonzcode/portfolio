/* ---------------------------------------------------------------------------
   Leoncraft 2 - survival: health, hunger, air, armour, effects, experience.

   Numbers from the Minecraft Wiki (Java Edition, Normal difficulty):

   Health 20 (ten hearts). A fall of more than three blocks hurts a point a
   block (Feather Falling and armour do not change that, except the
   enchantment's own protection), lava 4 a half second, the void 4, and 15
   seconds of air under water before drowning starts (2 a second).
   After a hit there are 10 ticks in which only a harder hit counts, and
   then only by how much harder it is.

   Hunger (food 0-20, saturation 0-food, exhaustion 0-40): every 4.0 of
   exhaustion takes a point of saturation, or of food when saturation is
   gone. Exhaustion: sprinting 0.1 a metre, swimming 0.01 a metre, a jump
   0.05 (0.2 sprinting), an attack 0.1, a block broken 0.005, any damage
   taken 0.1, healing 6 per point. With a full bar and saturation left,
   health comes back every 10 ticks (as much as saturation allows, up to a
   point, for exhaustion of what was used); at 18 or more, a point every 80
   ticks; at 0, starving takes a point every 80 ticks down to one heart.
   No sprinting at 6 or less.

   Armour: damage x (1 - min(20, max(points / 5, points - 4 x damage /
   (toughness + 8))) / 25), then Resistance (20% a level), then the
   Protection enchantments (4% per point of protection, up to 80%), then
   Absorption hearts take it before health. Each piece wears by a quarter
   of the damage (at least 1). Falling, drowning, starving, the void,
   poison and wither go straight through armour.

   Experience: a level takes 2L + 7 points up to 15, 5L - 38 up to 30, and
   9L - 158 after that.

   Effects: regeneration, poison, wither, hunger, saturation, absorption,
   resistance, fire resistance, water breathing, haste and mining fatigue
   (read by mining.js), and the rest kept so others can read them.
--------------------------------------------------------------------------- */
import { B, BLOCKS, FLUID } from './blocks.js?v=10';
import { ITEMS, armorOf } from './items.js?v=10';
import { wear } from './ui/inventory.js?v=10';

const BYPASS_ARMOR = new Set(['fall', 'drown', 'starve', 'void', 'magic', 'poison', 'wither', 'suffocation', 'generic', 'freeze', 'kill']);
const FIRE = new Set(['lava', 'fire', 'on_fire', 'hot_floor']);
const NO_EXHAUSTION = new Set(['starve', 'void', 'kill', 'poison', 'magic', 'wither']);

export function xpForLevel(level) { return level >= 30 ? 9 * level - 158 : level >= 15 ? 5 * level - 38 : 2 * level + 7; }

export class Survival {
  constructor() { this.inv = null; this.reset(); this.level = 0; this.xpProgress = 0; this.xpTotal = 0; this.enchantSeed = (Math.random() * 2147483647) | 0; }
  reset() {
    this.health = 20; this.food = 20; this.saturation = 5; this.exhaustion = 0; this.air = 300;
    this.fallFrom = null; this.foodTimer = 0; this.burn = 0; this.voidT = 0;
    this.dead = false; this.hurtTime = 0; this.lastHealth = 20; this.invul = 0; this.lastHurt = 0;
    this.absorption = 0; this.effects = {};
    this.lastSource = null;
    this.prevSwim = 0;
  }
  /* ---- damage ---- */
  // the hit after armour, effects and enchantments (what the combat code can ask before hurting)
  damageReduction(amount, source) {
    source = source || 'generic';
    if (FIRE.has(source) && this.effects.fire_resistance) return 0;
    let dmg = amount;
    if (!BYPASS_ARMOR.has(source)) {
      const { points, toughness } = this.armorValues();
      dmg = dmg * (1 - Math.min(20, Math.max(points / 5, points - 4 * dmg / (toughness + 8))) / 25);
    }
    if (this.effects.resistance && source !== 'void' && source !== 'kill') dmg *= Math.max(0, 1 - 0.2 * this.effects.resistance.level);
    const epf = this.protectionPoints(source);
    if (epf > 0) dmg *= 1 - Math.min(20, epf) / 25;
    return Math.max(0, dmg);
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
  // the armour's protection enchantments against a kind of damage
  protectionPoints(source) {
    const a = this.inv ? this.inv.armor : null;
    if (!a || source === 'void' || source === 'kill' || source === 'starve') return 0;
    let p = 0;
    for (const s of a) {
      if (!s || !s.ench) continue;
      const e = s.ench;
      p += (e.protection || 0);
      if (FIRE.has(source)) p += 2 * (e.fire_protection || 0);
      if (source === 'fall') p += 3 * (e.feather_falling || 0);
      if (source === 'explosion') p += 2 * (e.blast_protection || 0);
      if (source === 'projectile' || source === 'arrow') p += 2 * (e.projectile_protection || 0);
    }
    return p;
  }
  /* A hit of amount points (half hearts) from source ('fall', 'lava', 'mob',
     'arrow', 'explosion', 'drown', 'starve', 'void', 'poison'...). Goes
     through armour, Resistance, Protection and Absorption as the game does.
     Returns the damage taken (0 when it did not count). */
  hurt(amount, source) {
    if (this.dead || amount <= 0) return 0;
    source = source || 'generic';
    if (FIRE.has(source) && this.effects.fire_resistance) return 0;
    // the half second after a hit: only the part that is harder than the last one
    let raw = amount;
    if (this.invul > 10) {
      if (raw <= this.lastHurt) return 0;
      raw = raw - this.lastHurt;
      this.lastHurt = amount;
    } else { this.lastHurt = amount; this.invul = 20; this.hurtTime = 10; }
    // armour wears by a quarter of the hit
    if (!BYPASS_ARMOR.has(source) && this.inv) {
      const w = Math.max(1, Math.floor(raw / 4));
      const a = this.inv.armor;
      for (let i = 0; i < 4; i++) {
        const s = a[i];
        if (!s || !ITEMS[s.id] || !ITEMS[s.id].dur) continue;
        if (wear(s, w, true)) { a[i] = null; this.inv.emit('broke', s); }
      }
      this.inv.changed();
    }
    let dmg = this.damageReduction(raw, source);
    if (this.absorption > 0) { const t = Math.min(this.absorption, dmg); this.absorption -= t; dmg -= t; }
    if (!NO_EXHAUSTION.has(source)) this.exhaust(0.1);
    if (dmg <= 0) return 0;
    this.health = Math.max(0, this.health - dmg);
    this.lastSource = source;
    if (this.health <= 0) this.dead = true;
    return dmg;
  }
  heal(n) { if (!this.dead) this.health = Math.min(20, this.health + n); }

  /* ---- hunger ---- */
  exhaust(n) { this.exhaustion = Math.min(40, this.exhaustion + n); }
  canSprint() { return this.food > 6 || this.creative; }
  // a food eaten: hunger and saturation (saturation never above the food level), then its effects
  eat(hunger, saturation) {
    this.food = Math.min(20, this.food + hunger);
    this.saturation = Math.min(this.food, this.saturation + saturation);
  }
  wantsFood(always) { return always || this.food < 20; }

  /* ---- effects: name -> { level (1 = I), ticks } ---- */
  addEffect(name, level, ticks) {
    const e = this.effects[name];
    if (e && (e.level > level || (e.level === level && e.ticks >= ticks))) return;
    this.effects[name] = { level, ticks };
    if (name === 'absorption') this.absorption = Math.max(this.absorption, 4 * level);
  }
  clearEffects() { this.effects = {}; this.absorption = 0; }
  effectLevel(name) { const e = this.effects[name]; return e ? e.level : 0; }
  // the levels mining.js wants
  miningEffects() { return { haste: this.effectLevel('haste'), mining_fatigue: this.effectLevel('mining_fatigue'), conduit_power: this.effectLevel('conduit_power') }; }
  tickEffects() {
    for (const name in this.effects) {
      const e = this.effects[name], lv = e.level;
      switch (name) {
        case 'regeneration': { const k = 50 >> (lv - 1); if (k <= 0 || e.ticks % k === 0) this.heal(1); break; }
        case 'poison': { const k = 25 >> (lv - 1); if ((k <= 0 || e.ticks % k === 0) && this.health > 1) this.hurtEffect(1, 'poison'); break; }
        case 'wither': { const k = 40 >> (lv - 1); if (k <= 0 || e.ticks % k === 0) this.hurtEffect(1, 'wither'); break; }
        case 'hunger': this.exhaust(0.005 * lv); break;
        case 'saturation': this.eat(lv, 2 * lv); break;
      }
      if (--e.ticks <= 0) {
        delete this.effects[name];
        if (name === 'absorption') this.absorption = 0;
      }
    }
  }
  // effect damage skips the invulnerable half second, as the game's magic damage does
  hurtEffect(n, source) {
    if (this.dead) return;
    let dmg = this.damageReduction(n, source);
    if (this.absorption > 0) { const t = Math.min(this.absorption, dmg); this.absorption -= t; dmg -= t; }
    this.health = Math.max(source === 'poison' ? 1 : 0, this.health - dmg);
    this.hurtTime = Math.max(this.hurtTime, 10);
    if (this.health <= 0) { this.dead = true; this.lastSource = source; }
  }

  /* ---- experience ---- */
  addXp(points) {
    this.xpTotal += points;
    this.xpProgress += points / xpForLevel(this.level);
    while (this.xpProgress >= 1) {
      this.xpProgress = (this.xpProgress - 1) * xpForLevel(this.level);
      this.level++;
      this.xpProgress /= xpForLevel(this.level);
    }
  }
  addLevels(n) { this.level = Math.max(0, this.level + n); if (this.level === 0 && n < 0) this.xpProgress = 0; }
  // what a death leaves behind: 7 a level, at most 100
  deathXp() { return Math.min(100, this.level * 7); }

  /* ---- once a tick (20 a second), in survival ---- */
  tick(player) {
    if (this.dead) return;
    this.lastHealth = this.health;
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.invul > 0) this.invul--;
    const y = player.pos.y;
    // movement: exhaustion for sprinting and swimming, a jump's worth when leaving the ground upward
    const dx = player.pos.x - player.prev.x, dy = player.pos.y - player.prev.y, dz = player.pos.z - player.prev.z;
    if (!player.flying) {
      if (player.inWater || player.eyeInWater) this.exhaust(0.01 * Math.sqrt(dx * dx + dy * dy + dz * dz));
      else if (player.onGround && player.sprinting) this.exhaust(0.1 * Math.sqrt(dx * dx + dz * dz));
      if (player.jumped) { this.exhaust(player.sprinting ? 0.2 : 0.05); }
    }
    player.jumped = false;
    // Slow Falling never hurts
    if (this.effects.slow_falling) { player.fallDistance = 0; player.landed = null; }
    /* falling: the distance the player counted on the way down (player.js),
       spent when it lands; hay and honey take 80% of it, a bed half, and
       slime all of it unless you land sneaking; Jump Boost takes a block a level */
    if (player.landed) {
      const l = player.landed; player.landed = null;
      const name = BLOCKS[l.block] ? BLOCKS[l.block].name : '';
      const k = name === 'slime_block' ? (player.sneaking ? 1 : 0) : name === 'hay_block' || name === 'honey_block' ? 0.2 : /_bed$/.test(name) ? 0.5 : 1;
      const fell = l.dist - this.effectLevel('jump_boost');
      if (!player.flying && !player.inWater && fell > 3) this.hurt(Math.ceil((fell - 3) * k), 'fall');
    }
    // air: Respiration gives a chance to keep it, water breathing keeps it
    if (player.eyeInWater && !this.effects.water_breathing) {
      const resp = this.helmetEnchant('respiration');
      if (!(resp > 0 && Math.random() < resp / (resp + 1))) this.air--;
      if (this.air <= -20) { this.air = 0; this.hurt(2, 'drown'); }
    } else this.air = Math.min(300, this.air + 4);
    // lava and the void
    if (player.inLava) { if (++this.burn % 10 === 1) this.hurt(4, 'lava'); } else this.burn = 0;
    // the void: 64 below the dimension's floor (player.voidY, set per dimension by main.js)
    if (y < (player.voidY ?? -64)) { if (++this.voidT % 10 === 1) this.hurt(4, 'void'); } else this.voidT = 0;
    this.tickEffects();
    this.tickFood();
  }
  // a hay bale takes off 80% of a fall, a bed half
  landedOn(player) {
    const w = player.w;
    if (!w) return 1;
    const b = w.get(Math.floor(player.pos.x), Math.floor(player.pos.y - 0.2), Math.floor(player.pos.z));
    const d = BLOCKS[b];
    if (!d) return 1;
    if (d.name === 'hay_block' || d.name === 'honey_block') return 0.2;
    if (d.shape === 'bed') return 0.5;
    if (d.name === 'slime_block' || FLUID[b] || d.name === 'cobweb' || d.name === 'powder_snow') return 0;
    return 1;
  }
  helmetEnchant(name) { const h = this.inv && this.inv.armor[0]; return h && h.ench && h.ench[name] ? h.ench[name] : 0; }
  // the game's FoodData tick
  tickFood() {
    if (this.exhaustion > 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(this.saturation - 1, 0);
      else this.food = Math.max(this.food - 1, 0);
    }
    const hurt = this.health < 20;
    if (this.saturation > 0 && hurt && this.food >= 20) {
      if (++this.foodTimer >= 10) {
        const f = Math.min(this.saturation, 6);
        this.heal(f / 6);
        this.exhaust(f);
        this.foodTimer = 0;
      }
    } else if (this.food >= 18 && hurt) {
      if (++this.foodTimer >= 80) { this.heal(1); this.exhaust(6); this.foodTimer = 0; }
    } else if (this.food <= 0) {
      if (++this.foodTimer >= 80) {
        if (this.health > 1) this.hurt(1, 'starve');
        this.foodTimer = 0;
      }
    } else this.foodTimer = 0;
  }

  // what the HUD shows (one object, refilled every frame: nothing new is made)
  stats() {
    const ef = this.effects, o = this._st || (this._st = {});
    o.health = this.health; o.food = this.food; o.saturation = this.saturation; o.air = Math.max(0, this.air);
    o.xp = this.xpProgress; o.level = this.level; o.armor = this.armorValues().points; o.hurt = this.hurtTime;
    o.absorption = this.absorption; o.poison = !!ef.poison; o.wither = !!ef.wither; o.hungerEffect = !!ef.hunger; o.regen = !!ef.regeneration;
    return o;
  }
  toJSON() {
    return { health: this.health, food: this.food, saturation: this.saturation, exhaustion: this.exhaustion, air: this.air,
      level: this.level, xp: this.xpProgress, xpTotal: this.xpTotal, absorption: this.absorption, effects: this.effects, enchantSeed: this.enchantSeed };
  }
  fromJSON(o) {
    if (!o) return;
    this.health = o.health ?? 20; this.food = o.food ?? 20; this.air = o.air ?? 300;
    this.saturation = o.saturation ?? 5; this.exhaustion = o.exhaustion ?? 0;
    this.level = o.level | 0; this.xpProgress = o.xp || 0; this.xpTotal = o.xpTotal | 0;
    this.absorption = o.absorption || 0; this.effects = o.effects && typeof o.effects === 'object' ? o.effects : {};
    if (o.enchantSeed) this.enchantSeed = o.enchantSeed | 0;
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
