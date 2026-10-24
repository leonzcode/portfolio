/* ---------------------------------------------------------------------------
   Leoncraft 2 - status effects on mobs, thrown potions and their clouds.

   Mobs (any living thing) carry effects the way the player does
   (survival.js): name -> { level, ticks }, a stronger one replacing a weaker,
   the same level lasting longer. What each does, by the Minecraft Wiki
   (Java Edition):
     poison        1 damage every 25 >> (level - 1) ticks, never the last
                   point; not on the undead or on spiders
     wither        1 every 40 >> (level - 1) ticks; not on wither skeletons
     regeneration  heals 1 every 50 >> (level - 1) ticks; not the undead
     instant health / damage   4 << (level - 1) healed, 6 << (level - 1)
                   magic damage; the other way round on the undead
     speed, slowness           movement x (1 + 0.2 a level), x (1 - 0.15 a level)
     strength, weakness        +3, -4 attack damage a level
     resistance    20% less damage a level; fire resistance: no fire or lava
     water breathing           no drowning
     weaving, oozing, wind charged   on death: 2-3 cobwebs about, two
                   medium slimes, a burst of wind; infested: a hit has a 10%
                   chance of letting out silverfish (where there are any)

   A thrown splash potion breaks on the first block or mob it meets: every
   living thing in an 8.25 x 4.25 x 8.25 box round it, and within 4 blocks
   (to the nearest point of its box), gets each effect: instant ones scaled
   from 100% on a direct hit to 0 at 4 blocks, the rest for that share of
   the time (rounded), none at a second or less. A water bottle puts out
   fire there and on whatever burns, and hurts endermen, blazes, striders
   and snow golems by 1.

   A lingering potion leaves an area effect cloud: radius 3, shrinking to
   nothing over 30 seconds (600 ticks) after a half second's wait, checked
   every 5 ticks; whatever stands in it gets a quarter of each effect's time
   (half of an instant one) at most once a second, and each use takes 0.5
   off the radius. Under 0.5 it is gone.
--------------------------------------------------------------------------- */
import { Living, Entity, r3 } from './entity.js?v=107';
import { register, TYPES } from './mobs.js?v=107';
import { POTIONS } from '../brewing.js?v=107';
import { EFFECTS, effectId } from '../effects.js?v=107';
import { UNDEAD } from '../combat/weapons.js?v=107';
import { B } from '../blocks.js?v=107';

const R = () => Math.random();
const RI = n => Math.floor(Math.random() * n);
const isUndead = e => UNDEAD.has(e.type);
const NO_POISON = new Set(['spider', 'cave_spider']);
const NO_WITHER = new Set(['wither_skeleton', 'wither']);
const FIRE = new Set(['fire', 'lava', 'on_fire', 'in_fire', 'magma', 'hot_floor', 'fireball']);
const WATER_HURTS = new Set(['enderman', 'blaze', 'strider', 'snow_golem']);
const rgb = c => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];

/* ---------------------------------------------------------------------------
   Effects on any living thing
--------------------------------------------------------------------------- */
const LP = Living.prototype;
// may this effect go on it at all?
function canTake(e, n) {
  if ((n === 'poison' || n === 'regeneration') && isUndead(e)) return false;
  if (n === 'poison' && NO_POISON.has(e.type)) return false;
  if (n === 'wither' && NO_WITHER.has(e.type)) return false;
  return true;
}
/* An effect on a mob. Instant ones act at once, scaled by k (a splash's
   distance); the attacker is who threw or shot it. True when it took. */
LP.addEffect = function (name, level, ticks, attacker, k = 1) {
  const n = effectId(name) || name;
  if (this.dead || this.removed) return false;
  level = Math.max(1, level | 0);
  const def = EFFECTS[n];
  if (def && def.instant) {
    if (n === 'saturation') return false;
    const heals = (n === 'instant_health') !== isUndead(this);
    if (heals) this.heal(Math.floor(k * (4 << (level - 1)) + 0.5));
    else this.hurt(Math.floor(k * (6 << (level - 1)) + 0.5), { type: 'magic', attacker: attacker || null, player: !!(attacker && attacker.isPlayer), noKnock: true });
    return true;
  }
  if (!canTake(this, n)) return false;
  const fx = this.effects || (this.effects = {});
  const old = fx[n];
  ticks = ticks < 0 ? -1 : Math.max(1, ticks | 0);
  if (old && (old.level > level || (old.level === level && (old.ticks === -1 || (ticks !== -1 && old.ticks >= ticks))))) return false;
  fx[n] = { level, ticks };
  this.effectsChanged();
  return true;
};
LP.hasEffect = function (n) { return !!(this.effects && this.effects[n]); };
LP.effectLevel = function (n) { const e = this.effects && this.effects[n]; return e ? e.level : 0; };
LP.removeEffect = function (n) { if (!this.effects || !this.effects[n]) return false; delete this.effects[n]; this.effectsChanged(); return true; };
LP.clearEffects = function () { if (!this.effects) return false; this.effects = null; this.effectsChanged(); return true; };
// the attributes the effects change: the movement speed, kept from what it was before the first one
LP.effectsChanged = function () {
  const fx = this.effects || {};
  const sp = fx.speed ? fx.speed.level : 0, sl = fx.slowness ? fx.slowness.level : 0;
  if (sp || sl) {
    if (this._baseSpeed === undefined) this._baseSpeed = this.speed;
    this.speed = this._baseSpeed * (1 + 0.2 * sp) * Math.max(0, 1 - 0.15 * sl);
  } else if (this._baseSpeed !== undefined) { this.speed = this._baseSpeed; this._baseSpeed = undefined; }
  // strength and weakness go on its own hits (whatever kind of hit it makes)
  if ((fx.strength || fx.weakness) && !Object.prototype.hasOwnProperty.call(this, 'doHurtTarget') && typeof this.doHurtTarget === 'function') {
    const own = Object.getPrototypeOf(this).doHurtTarget;
    this.doHurtTarget = function (t) {
      const f = this.effects || {}, base = this.attackDamage;
      this.attackDamage = Math.max(0, base + 3 * (f.strength ? f.strength.level : 0) - 4 * (f.weakness ? f.weakness.level : 0));
      try { return own.call(this, t); } finally { this.attackDamage = base; }
    };
  }
  if (this.effects && !Object.keys(this.effects).length) this.effects = null;
};
// once a tick, after its own base tick: what the effects do, and their time running out
LP.tickEffects = function () {
  const fx = this.effects;
  if (!fx || this.dead) return;
  let changed = false;
  for (const n in fx) {
    const e = fx[n], lv = e.level, t = e.ticks === -1 ? this.age : e.ticks;
    switch (n) {
      case 'poison': { const k = 25 >> (lv - 1); if ((k <= 0 || t % k === 0) && this.health > 1) this.hurt(1, { type: 'magic', noKnock: true }); break; }
      case 'wither': { const k = 40 >> (lv - 1); if (k <= 0 || t % k === 0) this.hurt(1, { type: 'wither', noKnock: true }); break; }
      case 'regeneration': { const k = 50 >> (lv - 1); if ((k <= 0 || t % k === 0) && this.health < this.maxHealth) this.heal(1); break; }
      case 'water_breathing': this.air = 300; break;
    }
    if (this.dead || this.effects !== fx) return;
    if (e.ticks > 0 && --e.ticks === 0) { delete fx[n]; changed = true; }
  }
  if (changed) this.effectsChanged();
  // the swirl of the effects' colours about it
  if (this.effects && this.age % 5 === 0) {
    let r = 0, g = 0, b = 0, n = 0;
    for (const k in this.effects) { const d = EFFECTS[k]; if (!d) continue; const c = rgb(d.colour); r += c[0]; g += c[1]; b += c[2]; n++; }
    if (n && !this.hasEffect('invisibility')) this.m.particles('magic', this.pos.x + (R() - 0.5) * this.w, this.pos.y + R() * this.h, this.pos.z + (R() - 0.5) * this.w, 1, 0, [r / n, g / n, b / n]);
  }
};
const baseTick0 = LP.baseTick;
LP.baseTick = function () { baseTick0.call(this); if (this.effects) this.tickEffects(); };
// Resistance and Fire Resistance on the damage as it comes; Infested lets out silverfish
const hurt0 = LP.hurt;
LP.hurt = function (amount, source) {
  const fx = this.effects;
  if (fx && source) {
    if (fx.fire_resistance && FIRE.has(source.type)) return false;
    if (fx.resistance && source.type !== 'void' && source.type !== 'kill') {
      amount *= Math.max(0, 1 - 0.2 * fx.resistance.level);
      if (amount <= 0) return false;
    }
  }
  const ok = hurt0.call(this, amount, source);
  if (ok && fx && fx.infested && !this.dead && TYPES.silverfish && R() < 0.1) {
    for (let i = 0, n = 1 + RI(2); i < n; i++) this.m.spawn('silverfish', this.pos.x, this.pos.y + this.h / 2, this.pos.z, { natural: false });
  }
  return ok;
};
// what some effects leave behind at death
const die0 = LP.die;
LP.die = function (source) {
  const fx = this.effects;
  die0.call(this, source);
  if (!fx) return;
  const p = this.pos, T = this.m.t, W = this.m.world;
  if (fx.weaving && W && B.cobweb !== undefined) {
    // 2 or 3 cobwebs in the air round where it fell
    let n = 2 + RI(2);
    for (let k = 0; k < 15 && n > 0; k++) {
      const x = Math.floor(p.x) + RI(5) - 2, y = Math.floor(p.y) + RI(3) - 1, z = Math.floor(p.z) + RI(5) - 2;
      if (!T.get(x, y, z) && T.solid(x, y - 1, z)) { W.set(x, y, z, B.cobweb, 0); n--; }
    }
  }
  if (fx.oozing && TYPES.slime) {
    for (let i = 0; i < 2; i++) { const s = this.m.spawn('slime', p.x + (R() - 0.5), p.y + 0.2, p.z + (R() - 0.5), { natural: false }); if (s && s.setSize) s.setSize(2, true); }
  }
  if (fx.wind_charged) windBurst(this.m, p.x, p.y + this.h / 2, p.z, this);
};
// a wind burst: everything within 3 blocks pushed away (no damage, no blocks)
function windBurst(m, x, y, z, from) {
  m.particles('poof', x, y, z, 16, 0.6, [0.85, 0.9, 1]);
  const push = (e, isP) => {
    const dx = e.pos.x - x, dy = e.pos.y + 0.5 - y, dz = e.pos.z - z, d = Math.hypot(dx, dy, dz);
    if (d > 3 || d < 1e-3) return;
    const f = (1 - d / 3) * 1.2;
    if (isP) e.push(dx / d * f, dy / d * f + 0.3, dz / d * f); else { e.vel.x += dx / d * f; e.vel.y += dy / d * f + 0.3; e.vel.z += dz / d * f; }
  };
  m.forNear(x, z, 4, e => { if (e !== from && e instanceof Living && !e.dead) push(e, false); });
  if (m.player && m.player.alive()) push(m.player, true);
}
// kept with the mob
const toJSON0 = LP.toJSON, fromJSON0 = LP.fromJSON;
LP.toJSON = function () {
  const o = toJSON0.call(this);
  if (this.effects) { const a = []; for (const n in this.effects) a.push([n, this.effects[n].level, this.effects[n].ticks]); if (a.length) o.mfx = a; }
  return o;
};
LP.fromJSON = function (o) {
  fromJSON0.call(this, o);
  if (Array.isArray(o.mfx)) { this.effects = {}; for (const [n, l, t] of o.mfx) this.effects[n] = { level: l, ticks: t }; this.effectsChanged(); }
};

/* ---------------------------------------------------------------------------
   A potion's effects on one target (a mob, or the player through the manager)
     scale  the share of the time (a splash's distance, a cloud's quarter,
            an arrow's eighth); inst  the share of an instant effect
--------------------------------------------------------------------------- */
export function applyPotion(m, target, potion, scale, inst, attacker, minTicks) {
  const p = POTIONS[potion];
  if (!p || !target) return false;
  let any = false;
  for (const [n, lv, t] of p.effects) {
    const def = EFFECTS[n], instant = def && def.instant;
    if (target.isPlayer) {
      const sv = m.survival;
      if (!sv || m.mode === 'spectator') continue;
      if (instant) {
        if (n === 'instant_health') sv.heal(Math.floor(inst * (4 << (lv - 1)) + 0.5));
        else if (m.mode !== 'creative') sv.hurtEffect(Math.floor(inst * (6 << (lv - 1)) + 0.5), 'magic');
        any = true;
        continue;
      }
      const d = Math.floor(scale * t + 0.5);
      if (d > (minTicks || 0)) { sv.addEffect(n, lv, d); any = true; }
      continue;
    }
    if (!target.addEffect) continue;
    if (instant) { target.addEffect(n, lv, 1, attacker, inst); any = true; continue; }
    const d = Math.floor(scale * t + 0.5);
    if (d > (minTicks || 0) && target.addEffect(n, lv, d, attacker)) any = true;
  }
  return any;
}
// the nearest point of a box to (x, y, z): its distance squared
function boxDist2(x, y, z, x0, y0, z0, x1, y1, z1) {
  const dx = Math.max(x0 - x, 0, x - x1), dy = Math.max(y0 - y, 0, y - y1), dz = Math.max(z0 - z, 0, z - z1);
  return dx * dx + dy * dy + dz * dz;
}

/* A splash where a thrown potion broke (x, y, z the potion's corner);
   direct: what it hit, if it hit something. */
export function splashPotion(m, x, y, z, potion, owner, direct) {
  const p = POTIONS[potion || 'water'];
  if (!p) return;
  const water = potion === 'water' || !potion;
  const P = m.player, list = [];
  m.forNear(x, z, 6, e => {
    if (!(e instanceof Living) || e.dead || e.removed) return;
    if (Math.abs(e.pos.x - x) > 4.125 + e.hw || Math.abs(e.pos.z - z) > 4.125 + e.hw || e.pos.y > y + 2.125 || e.pos.y + e.h < y - 2.125) return;
    list.push([e, boxDist2(x, y, z, e.pos.x - e.hw, e.pos.y, e.pos.z - e.hw, e.pos.x + e.hw, e.pos.y + e.h, e.pos.z + e.hw)]);
  });
  if (P && P.alive()) list.push([P, boxDist2(x, y, z, P.pos.x - 0.3, P.pos.y, P.pos.z - 0.3, P.pos.x + 0.3, P.pos.y + 1.8, P.pos.z + 0.3)]);
  if (water) {
    // fire out where it broke and on the four blocks beside, and on whatever burns
    const W = m.world, bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    if (W) for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (const dy of [0, 1]) { const b = m.t.get(bx + dx, by + dy, bz + dz); if (b === B.fire || b === B.soul_fire) W.set(bx + dx, by + dy, bz + dz, 0, 0); }
    }
    for (const [e, d2] of list) {
      if (d2 >= 16) continue;
      if (e.isPlayer) { if (m.survival && m.survival.extinguish) m.survival.extinguish(); else m.pFire = 0; continue; }
      if (e.fire > 0) e.fire = 0;
      if (WATER_HURTS.has(e.type)) e.hurt(1, { type: 'water', attacker: owner || null, player: !!(owner && owner.isPlayer), noKnock: true });
      if (e.type === 'axolotl') e.air = Math.max(e.air || 0, 1800);
    }
    return;
  }
  for (const [e, d2] of list) {
    if (d2 >= 16) continue;
    const k = e === direct ? 1 : 1 - Math.sqrt(d2) / 4;
    applyPotion(m, e, potion, k, k, owner, 20);
  }
}

/* ---------------------------------------------------------------------------
   The area effect cloud a lingering potion leaves
--------------------------------------------------------------------------- */
export class AreaEffectCloud extends Entity {
  static W = 6; static H = 0.5; static STEP = 0; static NOT_PICKABLE = true; static NO_PUSH = true;
  constructor(m, type) {
    super(m, type);
    this.potion = 'water'; this.radius = 3; this.radiusOnUse = -0.5; this.radiusPerTick = -3 / 600;
    this.wait = 10; this.duration = 600; this.scale = 0.25; this.instScale = 0.5; this.delay = 20;
    this.used = new Map();            // who it last gave its effects to, and when (the tick it may again)
    this.owner = null; this.noPhysics = true;
  }
  tick() {
    this.prev.copy(this.pos);
    this.age++;
    const p = POTIONS[this.potion];
    if (!p || this.age > this.wait + this.duration) { this.remove(); return; }
    const waiting = this.age < this.wait;
    if (!waiting) {
      this.radius += this.radiusPerTick;
      if (this.radius < 0.5) { this.remove(); return; }
    }
    this.w = this.radius * 2; this.hw = this.radius;
    // its particles: a few at the middle while it waits, then spread over the disc
    const col = rgb(p.colour), r = waiting ? 0.2 : this.radius;
    const n = waiting ? (this.age % 2 ? 1 : 0) : Math.ceil(Math.PI * r * r * 0.25);
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, d = Math.sqrt(R()) * r;
      this.m.particles('magic', this.pos.x + Math.cos(a) * d, this.pos.y + 0.1, this.pos.z + Math.sin(a) * d, 1, 0, col);
    }
    if (waiting || this.age % 5 !== 0) return;
    for (const [k, t] of this.used) if (this.age >= t) this.used.delete(k);
    const x = this.pos.x, y = this.pos.y, z = this.pos.z, r2 = this.radius * this.radius;
    const take = (e, key) => {
      if (this.used.has(key)) return;
      if (applyPotion(this.m, e, this.potion, this.scale, this.instScale, this.owner, 0) || p.effects.length) {
        this.used.set(key, this.age + this.delay);
        this.radius += this.radiusOnUse;
      }
    };
    this.m.forNear(x, z, this.radius + 2, e => {
      if (!(e instanceof Living) || e.dead || e.removed) return;
      if (e.pos.y > y + 0.5 || e.pos.y + e.h < y) return;
      const dx = e.pos.x - x, dz = e.pos.z - z;
      if (dx * dx + dz * dz <= r2) take(e, e.id);
    });
    const P = this.m.player;
    if (P && P.alive() && P.pos.y <= y + 0.5 && P.pos.y + 1.8 >= y) {
      const dx = P.pos.x - x, dz = P.pos.z - z;
      if (dx * dx + dz * dz <= r2) take(P, 'player');
    }
    if (this.radius < 0.5) this.remove();
  }
  toJSON() { const o = super.toJSON(); Object.assign(o, { po: this.potion, r: r3(this.radius), a: this.age }); return o; }
  fromJSON(o) { super.fromJSON(o); this.potion = o.po || 'water'; this.radius = o.r || 3; this.age = o.a || 0; }
}
// nothing hits it, and nothing it is in counts as touched
AreaEffectCloud.prototype.hurt = undefined;
register('area_effect_cloud', AreaEffectCloud);

/* A lingering potion broke here: its cloud (none for water, or a potion with no effects). */
export function lingeringPotion(m, x, y, z, potion, owner) {
  const p = POTIONS[potion || 'water'];
  if (!p || !p.effects.length) { if (!potion || potion === 'water') splashPotion(m, x, y, z, 'water', owner, null); return null; }
  const c = m.spawn('area_effect_cloud', x, y, z, { natural: false });
  if (c) { c.potion = potion; c.owner = owner || null; }
  return c;
}
