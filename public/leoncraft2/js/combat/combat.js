/* ---------------------------------------------------------------------------
   Leoncraft 2 - the player's side of a fight (Java Edition 26.x rules, from
   the Minecraft Wiki: Damage, Attack cooldown, Sword, Shield, Bow, Arrow,
   Crossbow, Trident, Mace and the enchantment pages).

   One per world, made by the entity manager (entities/manager.js), which
   hands it the player's hits, the hits on the player and a tick.

   Hitting (attack):
     the cooldown scales the damage (0.2 + 0.8 p^2, enchantments by p);
     a hit charged past 0.9 is "strong": falling (not on the ground, not
     sprinting, not climbing, in water, riding, blind or slow falling) it is
     a critical, x1.5; sprinting it knocks back an extra 0.5 and stops the
     sprint; standing or walking with a sword it sweeps everything within a
     block of the target (1 + Sweeping Edge's share of the damage, and a 0.4
     knock). Knockback enchantment adds 0.5 a level, Fire Aspect sets the
     target alight for 4 seconds a level. A mace falling more than 1.5
     blocks smashes. Each hit costs 0.1 exhaustion and wears the item.
   Being hit (hurtPlayer):
     damage from mobs is scaled by difficulty (Easy min(d/2 + 1, d), Hard
     x1.5, none on Peaceful); a raised shield stops what comes from in front;
     the 10 tick window (survival.js); a fresh hit knocks 0.4 away from where
     it came from (less with netherite's knockback resistance) and tilts the
     camera that way; Thorns hits back.
   Using (useItem, then tick while the button is held):
     the bow draws for up to 20 ticks and lets go on release (speed 3 x
     power, power = (f^2 + 2f) / 3 of f = ticks / 20; critical at full draw;
     Power, Punch, Flame, Infinity); the crossbow loads in 25 ticks (5 fewer
     a level of Quick Charge), holds its arrow and fires at 3.15 on the next
     click (Multishot three at 10 degrees apart, Piercing); the trident
     throws after 10 ticks (Loyalty brings it back, Riptide launches you in
     water or rain, Channeling calls lightning in a storm); the shield is up
     5 ticks after the button goes down, slowing you to a fifth from the start.
--------------------------------------------------------------------------- */
import { ITEMS, I, itemName, addCooldown } from '../items.js?v=107';
import { wear } from '../ui/inventory.js?v=107';
import { Living } from '../entities/entity.js?v=107';
import { weaponOf, enchOf, enchantBonus, chargeTicks, wearPerHit, smashBonus, ARTHROPOD } from './weapons.js?v=107';
import './trident.js?v=107';
import { rayBox } from '../entities/terrain.js?v=107';

/* The spear's charge (the use button held), as the Spear page gives it, by
   material: [ticks before it works, then engaged, tired and disengaged
   ticks, the damage multiplier, the speed (blocks a second) a hit must come
   at to throw a rider off]. Every tick of it, whatever living thing the look
   meets within 4.5 blocks (a margin of 0.125 round it), not hit by it in the
   last half second, is hit if you close on it at 4.6 blocks a second or more
   along the look: floor(that speed x the multiplier) and the fist's 1,
   knocked back at 5.1 or more while engaged or tired, thrown off its mount
   while engaged. It runs out at the end; you keep your stride meanwhile. */
const CHARGE = {
  wooden: [15, 100, 100, 100, 0.7, 14], golden: [14, 70, 100, 105, 0.7, 13], stone: [14, 90, 90, 95, 0.82, 13], copper: [13, 80, 85, 85, 0.82, 12],
  iron: [12, 50, 85, 90, 0.95, 11], diamond: [10, 60, 70, 70, 1.075, 10], netherite: [8, 50, 60, 65, 1.2, 9],
};
const THREE = window.THREE;

const R = () => Math.random();
const DEG = Math.PI / 180;
// damage kinds the shield can never stop
const UNBLOCKABLE = new Set(['fall', 'drown', 'magic', 'fire', 'void', 'cactus', 'lava', 'starve', 'poison', 'wither', 'freeze', 'berry', 'magma', 'lightning', 'suffocation', 'dragon_breath']);
// the source kinds of entities/ as survival.js names them (it picks the armour and protection rules by these)
const SURVIVAL_KIND = { mob: 'mob', player: 'mob', arrow: 'arrow', thrown: 'projectile', trident: 'projectile', explosion: 'explosion', magic: 'magic', fire: 'fire', lava: 'lava', lightning: 'lightning' };
const ARROWS = ['arrow', 'spectral_arrow', 'tipped_arrow'];
const lv = (fx, name) => (fx && fx[name] ? fx[name].level || 1 : 0);

export class Combat {
  constructor(m) {
    this.m = m;
    this.use = null;               // { kind: 'bow' | 'crossbow' | 'trident', t, slot, id } while the use button draws something
    this.shieldT = 0; this.shieldUp = false; this.shieldCool = 0;
    this.hurtDir = 0; this.dirAge = -1;
    this.zoom = 1; this.zoomPrev = 1;
    this.spin = 0; this.spinDmg = 8; this.spinStack = null;
    this.lastHit = null;
    // lightning on mobs (sim/weather.js asks window.__lc2.entities.lightning)
    if (!m.lightning) m.lightning = (x, y, z) => this.lightning(x, y, z);
  }
  get P() { return this.m.P; }
  get inv() { return this.m.inv; }
  get sv() { return this.m.survival; }
  get creative() { return this.m.mode === 'creative'; }
  held() { const inv = this.inv; return inv ? inv.slots[inv.selected] : null; }
  heldId() { const s = this.held(); return s ? s.id : 0; }
  fx() { return this.sv ? this.sv.effects : null; }

  /* ---- the attack cooldown ----
     the manager counts ticks since the last swing (ticksSinceSwing; a new
     item in the hand starts it again). The game uses half a tick more than
     the indicator shows. */
  // (legacy: the old combat Hypixel plays with, set on Leon Network: every hit at full strength, no sweep)
  cooldown() { return this.legacy ? 1 : Math.max(0, Math.min(1, (this.m.ticksSinceSwing + 0.5) / chargeTicks(this.heldId()))); }
  charge() { return this.legacy ? 1 : Math.max(0, Math.min(1, this.m.ticksSinceSwing / chargeTicks(this.heldId()))); }
  /* what the crosshair's indicator shows: the charge while it is under 1,
     2 for the full one (a living thing in reach and an item slower than 4
     attacks a second), 1 for nothing */
  indicator() {
    const c = this.charge();
    if (c < 1) return c;
    const t = this.m.inter && this.m.inter.entityTarget;
    if (t && t instanceof Living && !t.dead && chargeTicks(this.heldId()) > 5) return 2;
    return 1;
  }
  // how far a hit reaches: 3 blocks (5 in creative), a spear's jab 4.5
  reach() { return weaponOf(this.heldId()).kind === 'spear' ? (this.creative ? 6.5 : 4.5) : this.creative ? 5 : 3; }

  /* ---- the player hits e ---- */
  attack(e, spin) {
    const m = this.m, P = this.P;
    if (!e || e.removed) return false;
    const st = this.held(), id = st ? st.id : 0, w = weaponOf(id);
    const c = this.cooldown();
    // a spear's jab only goes at a full charge
    if (w.kind === 'spear' && c < 1 && !spin) return false;
    if (w.kind === 'spear' && !spin) this.lunge(st);
    const fx = this.fx();
    let base = spin ? this.spinDmg : w.damage;
    base = Math.max(0, base + 3 * lv(fx, 'strength') - 4 * lv(fx, 'weakness'));
    let bonus = enchantBonus(spin ? this.spinStack : st, e);
    base *= 0.2 + c * c * 0.8;
    bonus *= c;
    m.ticksSinceSwing = 0;
    const src = { type: 'player', attacker: m.player, player: true, x: P.pos.x, z: P.pos.z };
    // not alive (a boat, a minecart): it just takes the hit (another player on a server works it out from the parts and the charge, net/net.js)
    if (!(e instanceof Living)) return e.hurt ? e.hurt(base + bonus, src, { base, bonus, c, spin: !!spin }) : false;
    if (e.dead || (base <= 0 && bonus <= 0)) return false;
    const strong = c > 0.9;
    const sprintHit = P.sprinting && strong;
    // the mace: more for every block fallen (before the critical); Breach works on every hit with it
    let smash = false;
    if (w.kind === 'mace' && !spin && P.fallDistance > 1.5 && !P.flying && !P.gliding) {
      base += smashBonus(P.fallDistance, enchOf(st, 'density'));
      smash = true;
    }
    if (enchOf(st, 'breach')) src.breach = enchOf(st, 'breach');
    const crit = strong && P.fallDistance > 0 && !P.onGround && !P.climbing && !P.inWater && !m.riding && !P.flying
      && !P.sprinting && !lv(fx, 'blindness') && !lv(fx, 'slow_falling') && w.kind !== 'spear';
    if (crit) base *= 1.5;
    const mx = P.pos.x - P.prev.x, mz = P.pos.z - P.prev.z, slow = 0.1 * (1 + 0.2 * lv(fx, 'speed')) * 2.5;
    const sweep = strong && !crit && !sprintHit && P.onGround && mx * mx + mz * mz < slow * slow && w.kind === 'sword' && !spin && !this.legacy;
    const hp0 = e.health;
    const ok = e.hurt(base + bonus, src);
    if (!ok) { this.lastHit = { dmg: base + bonus, crit, sweep, knock: 0, cooldown: c, before: hp0, after: e.health, missed: true }; return false; }
    e.lastHurtByPlayer = m.age;
    // knockback: the enchantment and a sprint
    const kb = enchOf(st, 'knockback') + (sprintHit ? 1 : 0);
    const sn = Math.sin(P.yaw), cs = Math.cos(P.yaw);
    if (kb > 0) {
      e.knockback(kb * 0.5, sn, cs);
      P.vel.x *= 0.6; P.vel.z *= 0.6;
      P.sprinting = false;
    }
    if (sweep) this.sweep(e, st, base, c, sn, cs);
    this.afterHit(e, st);
    if (smash) this.smashed(e, st);
    // sparks: the critical's stars, the enchantments' blue ones, and dark hearts for a big hit
    // the game's crit emitters: 3 ticks of sparks round the middle of what was hit (entities/particles.js emit)
    if (crit) m.particlesP.emit('crit', e);
    if (bonus > 0) m.particlesP.emit('magic', e, [0.3, 0.8, 1]);
    const lost = hp0 - Math.max(0, e.health);
    if (lost > 2) m.particles('heart', e.pos.x, e.pos.y + e.h * 0.5, e.pos.z, Math.floor(lost * 0.5), e.w * 0.5, [0.45, 0.05, 0.05]);
    // the weapon wears, and a hit is tiring
    const wr = spin ? 0 : wearPerHit(id);
    if (wr && !this.creative) this.wearHeld(wr);
    if (this.sv && !this.creative) this.sv.exhaust(0.1);
    this.lastHit = { dmg: base + bonus, base, bonus, crit, sweep, smash, knock: kb, cooldown: c, before: hp0, after: e.health };
    return true;
  }
  /* Lunge, after a spear's jab (26.1.2's enchantment/lunge.json, post_piercing_attack): unless riding, gliding
     or in water, and with at least 7 food (or in creative), the jab pushes you along the look's level part by
     0.458 a level (apply_impulse, direction forward, coordinate scale 1/0/1, not normalised again), costs 4
     exhaustion a level and 1 durability, and plays item.spear.lunge_<level> (sound/game.js). Returns the level
     when it went, else 0. */
  lunge(st) {
    const lvl = Math.min(3, enchOf(st, 'lunge'));
    if (!lvl) return 0;
    const m = this.m, P = this.P, sv = this.sv;
    if (m.riding || P.gliding || P.inWater || P.swimming) return 0;
    if (!this.creative && sv && sv.food < 7) return 0;
    const k = 0.458 * lvl, cp = Math.cos(P.pitch);
    P.vel.x += -Math.sin(P.yaw) * cp * k; P.vel.z += -Math.cos(P.yaw) * cp * k;
    if (sv) sv.exhaust(4 * lvl);
    if (!this.creative) this.wearHeld(1);
    return lvl;
  }
  // a jab into the air (manager.swung): a spear at full charge still lunges
  airJab() {
    const st = this.held();
    if (st && weaponOf(st.id).kind === 'spear' && this.cooldown() >= 1) this.lunge(st);
  }
  /* A hit on something the manager does not keep (the dragon's parts, an
     end crystal: dim/realms.js): the same damage by the same rules, the
     cooldown started again, the weapon worn. Returns the damage. */
  strikeDamage() {
    const P = this.P, st = this.held(), id = st ? st.id : 0, w = weaponOf(id), fx = this.fx();
    const c = this.cooldown();
    let base = Math.max(0, w.damage + 3 * lv(fx, 'strength') - 4 * lv(fx, 'weakness')) * (0.2 + c * c * 0.8);
    const bonus = enchantBonus(st, null) * c;
    this.m.ticksSinceSwing = 0;
    const crit = c > 0.9 && P.fallDistance > 0 && !P.onGround && !P.climbing && !P.inWater && !this.m.riding && !P.flying && !P.sprinting && !lv(fx, 'blindness');
    if (crit) base *= 1.5;
    const wr = wearPerHit(id);
    if (wr && !this.creative) this.wearHeld(wr);
    if (this.sv && !this.creative) this.sv.exhaust(0.1);
    return base + bonus;
  }
  /* What the enchantments do to something hit (the target, and each one a sweep reaches):
     Fire Aspect sets it alight for 4 seconds a level, Bane of Arthropods gives an arthropod
     Slowness IV for 1.5 seconds to 1.5 + half a second a level above the first (26.1.2's apply_mob_effect:
     round(20 x a duration between min 1.5 and 1.5 + 0.5 per level above the first)) */
  afterHit(e, st) {
    if (e.dead) return;
    const fa = enchOf(st, 'fire_aspect');
    if (fa && e.setFire) e.setFire(4 * fa);
    const bane = enchOf(st, 'bane_of_arthropods');
    if (bane && ARTHROPOD.has(e.type) && e.addEffect) e.addEffect('slowness', 4, 30 + Math.round(R() * 10 * (bane - 1)), this.m.player);
  }
  // a sword's sweep: everything within a block of the target (and within 3 of you) takes 1 (and Sweeping Edge's share)
  sweep(e, st, base, c, sn, cs) {
    const m = this.m, P = this.P;
    const ratio = enchOf(st, 'sweeping_edge') / (enchOf(st, 'sweeping_edge') + 1);
    const x0 = e.pos.x - e.hw - 1, x1 = e.pos.x + e.hw + 1, z0 = e.pos.z - e.hw - 1, z1 = e.pos.z + e.hw + 1, y0 = e.pos.y - 0.25, y1 = e.pos.y + e.h + 0.25;
    const hit = [];
    m.forNear(e.pos.x, e.pos.z, 4, o => {
      if (o === e || o.removed || o.dead || !(o instanceof Living) || o === m.riding || o.vehicle === m.player) return;
      if (o.pos.x + o.hw < x0 || o.pos.x - o.hw > x1 || o.pos.z + o.hw < z0 || o.pos.z - o.hw > z1 || o.pos.y + o.h < y0 || o.pos.y > y1) return;
      if (o.dist2(P.pos.x, P.pos.y, P.pos.z) >= 9) return;
      hit.push(o);
    });
    for (const o of hit) {
      o.knockback(0.4, sn, cs);
      const ok = o.hurt((1 + ratio * base + enchantBonus(st, o)) * c, { type: 'player', attacker: m.player, player: true, x: P.pos.x, z: P.pos.z });
      o.lastHurtByPlayer = m.age;
      if (ok) this.afterHit(o, st);
    }
    m.particlesP.add('sweep', P.pos.x - sn, P.pos.y + 0.9, P.pos.z - cs, 1, 0);
    return hit.length;
  }
  // after a mace's smash: your fall is spent, you bounce a little, and what is round the target is thrown back
  smashed(e, st) {
    const m = this.m, P = this.P, fall = P.fallDistance;
    P.fallDistance = 0;
    P.vel.y = 0.01;
    const k = fall > 5 ? 2 : 1;
    // the ring of dust from the block under the target (the game's knockback() starts with level event 2013)
    const bx = Math.floor(e.pos.x), by = Math.floor(e.pos.y - 0.2), bz = Math.floor(e.pos.z);
    this.smashDust(bx, by, bz, m.world ? m.world.get(bx, by, bz) : 0);
    m.forNear(e.pos.x, e.pos.z, 4, o => {
      if (o === e || o.removed || o.dead || !(o instanceof Living || o.remotePlayer) || o === m.riding) return;
      const dx = o.pos.x - e.pos.x, dz = o.pos.z - e.pos.z, d = Math.hypot(dx, o.pos.y - e.pos.y, dz);
      if (d > 3.5) return;
      const f = (3.5 - d) * 0.7 * k * (1 - (o.kbResist || 0));
      const l = Math.hypot(dx, dz) || 1;
      // (another player: sent to their machine, which takes off their own knockback resistance)
      if (o.remotePlayer) { o.push(dx / l * f, 0.7 * f, dz / l * f); return; }
      o.vel.x += dx / l * f; o.vel.y += 0.7 * f; o.vel.z += dz / l * f;
    });
    // Wind Burst: a burst of wind where you are throws you up again, x1.2, x1.75, x2.2 (less 15% a level of Blast Protection worn)
    const wb = enchOf(st, 'wind_burst');
    if (wb) {
      let bp = 0;
      for (const a of (this.inv && this.inv.armor) || []) bp += enchOf(a, 'blast_protection');
      P.vel.y += ([1.2, 1.75, 2.2][wb - 1] || 1.5 + 0.35 * (wb - 1)) * Math.max(0, 1 - 0.15 * bp);
      P.onGround = false;
    }
  }
  // the dust itself (net/events.js wraps this to show it to the others near)
  smashDust(x, y, z, b) {
    const L = typeof window !== 'undefined' ? window.__lc2 : null, P = L && L.renderer && L.renderer.particles;
    if (b && P && P.smash) try { P.smash(x, y, z, b); } catch (err) { /* no dust */ }
  }
  // wear on the held item (a tool used in a fight)
  wearHeld(n) { if (this.inv && this.inv.damageSelected) this.inv.damageSelected(n); }

  /* ---- the player being hit ----
     src: { type, attacker, direct (the arrow), x, z (where it came from),
     noKnock, knock (the attacker's own knockback), yaw, axe } */
  hurtPlayer(amount, src) {
    const m = this.m, sv = this.sv;
    if (!m.player.alive() || this.creative || m.mode === 'spectator' || !sv) return false;
    const cause = src.attacker;
    // difficulty scales a mob's hit in survival.js (hurt), with the 10 tick window; not here as well
    if (amount <= 0) return false;
    if (this.blocks(src)) { this.blocked(amount, src); return false; }
    // the 10 tick window (survival.js keeps it): only a harder hit counts, and only by the difference
    const fresh = !(sv.invul > 10);
    if (!fresh && amount <= sv.lastHurt) return false;
    const before = sv.health;
    // (with who did it: the death message names them, difficulty scales a mob's hit, and the advancements know the killer)
    sv.hurt(amount, Object.assign({}, src, { type: SURVIVAL_KIND[src.type] || src.type || 'generic' }));
    if (fresh) {
      const P = this.P;
      // where it came from: an arrow's flight, or the attacker
      let dx, dz;
      const d = src.direct;
      if (d && d.vel && (d.vel.x || d.vel.z)) { dx = -d.vel.x; dz = -d.vel.z; }
      else if (src.x !== undefined) { dx = src.x - P.pos.x; dz = src.z - P.pos.z; }
      if (dx !== undefined) {
        this.setHurtDir(dx, dz);
        if (!src.noKnock && src.type !== 'explosion') {
          this.knockPlayer(0.4, dx, dz);
          if (src.knock) this.knockPlayer(src.knock * 0.5, Math.sin(src.yaw), Math.cos(src.yaw));
        }
      }
    }
    if (cause && cause.hurt && !cause.isPlayer && (src.type === 'mob')) this.thorns(cause);
    m.lastPlayerHurt = { amount, before, after: sv.health, src: src.type };
    if (m.riding && sv.dead) m.dismount();
    return true;
  }
  // the camera tilts away from where a hit came from (render: tilt())
  setHurtDir(dx, dz) {
    const P = this.P, fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), lx = -Math.cos(P.yaw), lz = Math.sin(P.yaw);
    this.hurtDir = Math.atan2(dx * fx + dz * fz, dx * lx + dz * lz);
    this.dirAge = this.m.age;
  }
  // the game's knockback on the player: half the speed kept, strength away from (dx, dz), up to 0.4 if on the ground
  knockPlayer(strength, dx, dz) {
    strength *= 1 - this.knockbackResistance();
    const l = Math.hypot(dx, dz);
    if (strength <= 0 || l < 1e-4) return;
    const v = this.P.vel;
    v.x = v.x / 2 - dx / l * strength;
    v.z = v.z / 2 - dz / l * strength;
    if (this.P.onGround) v.y = Math.min(0.4, v.y / 2 + strength);
    this.P.onGround = false;
  }
  knockbackResistance() { return this.sv && this.sv.armorValues ? Math.min(1, this.sv.armorValues().knockback) : 0; }
  // Thorns: each piece has a 15% a level chance to hit the attacker back for 1-4, and wears 2 more
  thorns(attacker) {
    const a = this.inv && this.inv.armor;
    if (!a) return;
    for (let i = 0; i < 4; i++) {
      const s = a[i], t = enchOf(s, 'thorns');
      if (!t || R() >= 0.15 * t) continue;
      const P = this.P;
      attacker.hurt(t > 10 ? t - 10 : 1 + Math.floor(R() * 4), { type: 'thorns', attacker: this.m.player, player: true, x: P.pos.x, z: P.pos.z });
      if (!this.creative && wear(s, 2, true)) { a[i] = null; this.inv.emit('broke', s); }
      this.inv.changed();
    }
  }

  /* ---- the shield ---- */
  shieldStack() {
    const inv = this.inv;
    if (!inv) return null;
    const main = inv.slots[inv.selected], off = inv.offhand;
    if (main && ITEMS[main.id] && ITEMS[main.id].name === 'shield') return main;
    if (off && ITEMS[off.id] && ITEMS[off.id].name === 'shield' && !this.mainHandUses(main)) return off;
    return null;
  }
  // does the item in the main hand do something of its own with the use button (so the off hand's shield waits)?
  mainHandUses(s) {
    if (!s) return false;
    const it = ITEMS[s.id];
    if (!it) return false;
    if (this.use || (this.P.usingItem && this.P.usingItem !== 'shield')) return true;
    if (it.food) return true;
    if (/^(bow|crossbow|trident|ender_pearl|snowball|egg|splash_potion|lingering_potion|potion|bucket|water_bucket|lava_bucket|spyglass|goat_horn|fishing_rod|wind_charge|experience_bottle)$/.test(it.name) || /_spawn_egg$/.test(it.name)) return true;
    // a block goes on what you look at
    const t = this.m.inter && this.m.inter.target;
    return !!(it.block && t && t.face);
  }
  shieldTick() {
    const P = this.P;
    const raising = !!(this.m.inter && this.m.inter.useHeld) && !!this.shieldStack() && this.shieldCool <= 0;
    if (this.shieldCool > 0) this.shieldCool--;
    this.shieldT = raising ? this.shieldT + 1 : 0;
    // slowed from the moment it comes up; it blocks from the fifth tick
    const up = this.shieldT >= 5;
    this.shieldUp = up;
    if (P) {
      if (raising) P.usingItem = 'shield';
      else if (P.usingItem === 'shield') P.usingItem = false;
    }
  }
  blocks(src) {
    if (!this.shieldUp || !src || UNBLOCKABLE.has(src.type)) return false;
    // a piercing arrow goes through
    if (src.direct && src.direct.pierce > 0) return false;
    const from = src.direct || src.attacker;
    const sx = from && from.pos ? from.pos.x : src.x, sz = from && from.pos ? from.pos.z : src.z;
    if (sx === undefined) return false;
    const P = this.P, lx = -Math.sin(P.yaw), lz = -Math.cos(P.yaw);
    // blocked if it comes from the half in front (a 90 degree cone either side of the look)
    return (sx - P.pos.x) * lx + (sz - P.pos.z) * lz > 0;
  }
  blocked(amount, src) {
    const m = this.m, P = this.P, a = src.attacker;
    // a melee attacker is pushed back; an axe puts the shield down for 5 seconds
    // (another player's too: sent back to their machine, net.js struck)
    if ((src.type === 'mob' || (a && a.remotePlayer)) && a && a.knockback && a.pos && !src.direct) a.knockback(0.5, P.pos.x - a.pos.x, P.pos.z - a.pos.z);
    if (src.axe) this.disableShield();
    // the shield wears by the hit, rounded up, from 3 up
    if (amount >= 3 && !this.creative) {
      const s = this.shieldStack();
      if (s) {
        const inv = this.inv;
        if (wear(s, Math.ceil(amount), false)) {
          if (inv.slots[inv.selected] === s) inv.slots[inv.selected] = null; else if (inv.offhand === s) inv.offhand = null;
          inv.emit('broke', s);
        }
        inv.changed();
      }
    }
    m.lastBlocked = { amount, src: src.type };
  }
  disableShield() { addCooldown('shield', 100); this.shieldCool = 100; this.shieldT = 0; this.shieldUp = false; if (this.P && this.P.usingItem === 'shield') this.P.usingItem = false; }

  /* ---- bows, crossbows, tridents: the use button ---- */
  // right click with stack in the main hand; true if it started (or is) drawing
  useItem(stack) {
    if (this.use) return true;
    if (!stack) return false;
    const it = ITEMS[stack.id];
    if (!it) return false;
    if (it.name === 'bow') {
      if (!this.creative && !this.findAmmo()) return false;
      this.begin('bow', stack);
      return true;
    }
    if (it.name === 'crossbow') {
      if (stack.charged && stack.charged.length) { this.fireCrossbow(stack); return true; }
      if (!this.creative && !this.findAmmo(true)) return false;
      this.begin('crossbow', stack);
      return true;
    }
    if (weaponOf(stack.id).kind === 'spear') {
      if (it.dur && (stack.dmg | 0) >= it.dur - 1) return false;
      this.begin('spear', stack);
      this.use.hits = new Map();
      this.P.usingItem = false;          // (a spear is charged at full stride)
      return true;
    }
    if (it.name === 'trident') {
      // one durability left: it will not go
      if (it.dur && (stack.dmg | 0) >= it.dur - 1) return false;
      if (enchOf(stack, 'riptide') && !this.wetOrRain()) return false;
      this.begin('trident', stack);
      return true;
    }
    return false;
  }
  // (off: drawn in the off hand, its turn at the click: hands.js withOffhand stands it in the selected slot meanwhile)
  begin(kind, stack) {
    const H = this.m.hooks && this.m.hooks.hands;
    this.use = { kind, t: 0, slot: this.inv.selected, id: stack.id, loaded: false, off: !!(H && H.offTurn) };
    this.P.usingItem = kind;
  }
  // the stack being drawn: the selected one, or the off hand's
  useStack(u) { const inv = this.inv; return !u || !inv ? null : u.off ? inv.offhand : inv.slots[inv.selected]; }
  // fn run with the hand in use standing as the held one (the off hand's bow wears, and is let go, as the main hand's)
  inUseHand(u, fn) {
    const H = this.m.hooks && this.m.hooks.hands;
    if (u && u.off && H && H.withOffhand && !H.offTurn) return H.withOffhand(fn);
    return fn();
  }
  stopUse() { this.use = null; if (this.P && (this.P.usingItem === 'bow' || this.P.usingItem === 'crossbow' || this.P.usingItem === 'trident')) this.P.usingItem = false; }
  // ticks a crossbow takes to load: 25, 5 fewer a level of Quick Charge
  crossbowTicks(s) { return Math.max(0, 25 - 5 * enchOf(s, 'quick_charge')); }
  useTick() {
    const u = this.use, inv = this.inv;
    if (!u) return;
    const s = this.useStack(u);
    // a different slot or item: put away without letting go
    if ((!u.off && inv.selected !== u.slot) || !s || s.id !== u.id || (this.sv && this.sv.dead)) { this.stopUse(); return; }
    if (!(this.m.inter && this.m.inter.useHeld)) { this.inUseHand(u, () => this.release(this.held())); return; }
    u.t++;
    if (u.kind === 'spear') this.inUseHand(u, () => this.chargeTick(this.held(), u));
  }
  // one tick of a spear's charge (CHARGE above)
  chargeTick(s, u) {
    const it = ITEMS[s.id], C = CHARGE[it.tool && it.tool.material] || CHARGE.wooden, m = this.m, P = this.P;
    const e = u.t - C[0];
    if (e < 0) return;
    if (e >= C[1] + C[2] + C[3]) { this.stopUse(); return; }
    const stage = e < C[1] ? 0 : e < C[1] + C[2] ? 1 : 2;
    const cp = Math.cos(P.pitch), lx = -Math.sin(P.yaw) * cp, ly = Math.sin(P.pitch), lz = -Math.cos(P.yaw) * cp;
    const ex = P.pos.x, ey = P.pos.y + (P.eyeH || 1.62), ez = P.pos.z, g = 0.125;
    // how you are really moving: the step the last tick took (the velocity left after it is
    // what friction leaves, about half a sprint's), the mount's when riding
    const mount = m.riding, mv = P.moved || [0, 0, 0];
    const v = mount ? { x: mount.pos.x - mount.prev.x, y: mount.pos.y - mount.prev.y, z: mount.pos.z - mount.prev.z } : { x: mv[0], y: mv[1], z: mv[2] };
    m.forNear(ex, ez, 8, t => {
      if (!(t instanceof Living || t.remotePlayer) || t.dead || t.removed || t === m.riding || t.vehicle === m.riding && m.riding) return;
      const d = rayBox(ex, ey, ez, lx, ly, lz, t.pos.x - t.hw - g, t.pos.y - g, t.pos.z - t.hw - g, t.pos.x + t.hw + g, t.pos.y + t.h + g, t.pos.z + t.hw + g);
      if (!(d <= 4.5)) return;
      const last = u.hits.get(t);
      if (last !== undefined && u.t - last < 10) return;
      const tv = t.vel || { x: 0, y: 0, z: 0 };
      const rel = ((v.x - tv.x) * lx + (v.y - tv.y) * ly + (v.z - tv.z) * lz) * 20;
      if (rel < 4.6) return;
      u.hits.set(t, u.t);
      const dmg = Math.floor(rel * C[4]) + 1 + enchantBonus(s, t);
      if (!t.hurt(dmg, { type: 'player', attacker: m.player, player: true, x: P.pos.x, z: P.pos.z, noKnock: true })) return;
      t.lastHurtByPlayer = m.age;
      if (stage <= 1 && rel >= 5.1) t.knockback(0.5, -lx, -lz);
      if (stage === 0 && rel >= C[5] && t.vehicle && m.unseat) m.unseat(t);
      if (!this.creative) this.wearHeld(1);
    });
  }
  release(s) {
    const u = this.use;
    this.stopUse();
    if (u.kind === 'bow') this.fireBow(s, u.t);
    else if (u.kind === 'crossbow') { if (u.t >= this.crossbowTicks(s)) this.loadCrossbow(s); }
    else if (u.kind === 'trident') { if (u.t >= 10) this.throwTrident(s); }
  }
  // the bow's power after drawing for so many ticks (0..1)
  static bowPower(t) { const f = t / 20; return Math.min(1, (f * f + f * 2) / 3); }

  /* The arrows to shoot: the off hand first, then the main hand, then the
     inventory from the first slot. A crossbow also takes a firework rocket,
     but only from a hand (the game's getHeldProjectile: arrow or firework in
     the off hand, then the main hand; the inventory is searched for arrows
     only). Returns { stack, slot } or null. */
  findAmmo(crossbow) {
    const inv = this.inv;
    const isArrow = s => s && ITEMS[s.id] && ARROWS.includes(ITEMS[s.id].name);
    const held = crossbow ? (s => isArrow(s) || (s && ITEMS[s.id] && ITEMS[s.id].name === 'firework_rocket')) : isArrow;
    if (held(inv.offhand)) return { stack: inv.offhand, slot: 'off' };
    if (held(inv.slots[inv.selected])) return { stack: inv.slots[inv.selected], slot: inv.selected };
    for (let i = 0; i < 36; i++) if (isArrow(inv.slots[i])) return { stack: inv.slots[i], slot: i };
    return null;
  }
  takeAmmo(a, n = 1) {
    const inv = this.inv;
    a.stack.count -= n;
    if (a.stack.count <= 0) { if (a.slot === 'off') inv.offhand = null; else inv.slots[a.slot] = null; }
    inv.changed();
  }
  fireBow(bow, ticks) {
    const power = Combat.bowPower(ticks);
    if (power < 0.1) return null;
    const ammo = this.findAmmo();
    const kind = ammo ? ITEMS[ammo.stack.id].name : 'arrow';
    if (!ammo && !this.creative) return null;
    // Infinity keeps plain arrows (they cannot be picked up then); creative keeps everything
    const infinite = this.creative || (enchOf(bow, 'infinity') > 0 && kind === 'arrow');
    const a = this.shoot(kind, ammo ? ammo.stack.potion : null, power * 3, 1, 0);
    if (!a) return null;
    a.crit = power >= 1;
    const pw = enchOf(bow, 'power');
    if (pw) a.base += pw * 0.5 + 0.5;
    a.knock = enchOf(bow, 'punch');
    if (enchOf(bow, 'flame')) a.fire = 100;
    a.pickup = infinite ? 2 : 1;
    if (!infinite && ammo) this.takeAmmo(ammo);
    if (!this.creative) this.wearHeld(1);
    this.lastShot = { kind: 'bow', power, speed: a.vel.length(), crit: a.crit, base: a.base };
    return a;
  }
  /* An arrow (or a tipped or spectral one) from the eyes along the look
     (turned by yawOff about the view's up), at speed, spread by inaccuracy,
     with the shooter's own movement added. */
  shoot(kind, potion, speed, inacc, yawOff) {
    const m = this.m, P = this.P;
    const ey = P.pos.y + (P.eyeH || 1.62) - 0.1;
    const a = m.spawn('arrow', P.pos.x, ey, P.pos.z, { natural: false });
    if (!a) return null;
    a.owner = m.player; a.item = kind; if (potion) a.potion = potion;
    if (kind === 'spectral_arrow') a.glow = 200;
    const dir = this.look(yawOff);
    a.shoot(dir.x, dir.y, dir.z, speed, inacc);
    a.vel.x += P.vel.x; a.vel.z += P.vel.z; if (!P.onGround) a.vel.y += P.vel.y;
    return a;
  }
  // the look direction, turned by yawOff radians about the camera's up
  look(yawOff) {
    const P = this.P, v = this._look || (this._look = new THREE.Vector3());
    v.set(-Math.sin(P.yaw) * Math.cos(P.pitch), Math.sin(P.pitch), -Math.cos(P.yaw) * Math.cos(P.pitch));
    if (yawOff) {
      const up = (this._up || (this._up = new THREE.Vector3())).set(Math.sin(P.yaw) * Math.sin(P.pitch), Math.cos(P.pitch), Math.cos(P.yaw) * Math.sin(P.pitch));
      v.applyAxisAngle(up, yawOff);
    }
    return v;
  }
  // the crossbow takes its arrow (three with Multishot, from one) when let go after a full load
  loadCrossbow(s) {
    const ammo = this.findAmmo(true);
    if (!ammo && !this.creative) return false;
    const kind = ammo ? ITEMS[ammo.stack.id].name : 'arrow';
    // a rocket keeps its flight and stars in the potion's place
    const potion = !ammo ? null : kind === 'firework_rocket' ? { flight: ammo.stack.flight || 1, explosions: ammo.stack.explosions || [] } : ammo.stack.potion || null;
    const n = enchOf(s, 'multishot') ? 3 : 1;
    s.charged = [];
    for (let i = 0; i < n; i++) s.charged.push(potion ? [kind, potion, i === 0 && !this.creative] : [kind, null, i === 0 && !this.creative]);
    if (ammo && !this.creative) this.takeAmmo(ammo);
    this.inv.changed();
    return true;
  }
  fireCrossbow(s) {
    const shots = s.charged;
    s.charged = null;
    const pierce = enchOf(s, 'piercing');
    const offs = [0, -10 * DEG, 10 * DEG];
    let fired = 0;
    for (let i = 0; i < shots.length; i++) {
      const [kind, potion, keep] = shots[i];
      if (kind === 'firework_rocket') { if (this.shootRocket(potion, offs[i] || 0)) fired += 3; continue; }  // a rocket wears the crossbow by 3
      const a = this.shoot(kind, potion, 3.15, 1, offs[i] || 0);
      if (!a) continue;
      a.crit = true;
      a.pierce = pierce;
      a.pickup = keep ? 1 : 2;
      a.fromCrossbow = true;
      fired++;
    }
    if (!this.creative && fired) this.wearHeld(fired);
    this.inv.changed();
    if (this.m.R) this.m.R.swing = 1;
    this.lastShot = { kind: 'crossbow', count: fired, pierce };
  }
  /* A firework rocket off a crossbow (the game's CrossbowItem.shootProjectile): from 0.15 under the eyes, at 1.6
     (the crossbow's power with a rocket loaded, against 3.15 for arrows), inaccuracy 1, no shooter's motion added;
     it flies straight with no gravity (shot at an angle) and goes off on what it hits (items2.js FireworkRocket). */
  shootRocket(st, yawOff) {
    const m = this.m, P = this.P;
    const r = m.spawn('firework_rocket', P.pos.x, P.pos.y + (P.eyeH || 1.62) - 0.15, P.pos.z, { natural: false });
    if (!r) return null;
    r.init(st || { flight: 1, explosions: [] });
    r.owner = m.player; r.angled = true;
    const dir = this.look(yawOff);
    r.shootAt(dir.x, dir.y, dir.z, 1.6, 1);
    return r;
  }
  // in water, or out in the rain (Riptide's rule)
  wetOrRain() {
    const P = this.P;
    if (P.inWater) return true;
    const sim = this.m.inter && this.m.inter.sim, W = sim && sim.weather;
    if (!W || !W.rainingAt) return false;
    const x = Math.floor(P.pos.x), z = Math.floor(P.pos.z);
    return !!(W.rainingAt(x, Math.floor(P.pos.y), z) || W.rainingAt(x, Math.floor(P.pos.y + 1.8), z));
  }
  throwTrident(s) {
    const m = this.m, P = this.P;
    const rip = enchOf(s, 'riptide');
    if (rip) {
      if (!this.wetOrRain()) return;
      // launched along the look: 3 x (1 + level) / 4 blocks a tick
      const d = this.look(0), f = 3 * (1 + rip) / 4;
      P.vel.x += d.x * f; P.vel.y += d.y * f; P.vel.z += d.z * f;
      if (P.onGround) { P.move ? P.move(0, 1.1999999, 0) : (P.pos.y += 1.2); P.onGround = false; }
      this.spin = 20; this.spinDmg = 8; this.spinStack = s;
      P.spinning = true;
      if (!this.creative) this.wearHeld(1);
      return;
    }
    const t = m.spawn('trident', P.pos.x, P.pos.y + (P.eyeH || 1.62) - 0.1, P.pos.z, { natural: false });
    if (!t) return;
    t.owner = m.player;
    t.stack = Object.assign({}, s, { count: 1 });
    if (s.ench) t.stack.ench = Object.assign({}, s.ench);
    if (!this.creative) { t.stack.dmg = (s.dmg | 0); wear(t.stack, 1, false); }
    t.pickup = this.creative ? 2 : 1;
    t.slot = this.inv.selected;
    const d = this.look(0);
    t.shoot(d.x, d.y, d.z, 2.5, 1);
    t.vel.x += P.vel.x; t.vel.z += P.vel.z; if (!P.onGround) t.vel.y += P.vel.y;
    if (!this.creative) { this.inv.slots[this.inv.selected] = null; this.inv.changed(); }
    this.lastShot = { kind: 'trident', speed: t.vel.length() };
  }
  // Riptide's spin: the first thing touched is hit (8, by the cooldown) and you bounce back off it
  spinTick() {
    if (this.spin <= 0) return;
    const m = this.m, P = this.P;
    this.spin--;
    if (!this.spin) { P.spinning = false; return; }
    let hit = null;
    m.forNear(P.pos.x, P.pos.z, 3, e => {
      if (hit || e.removed || e.dead || !(e instanceof Living || e.remotePlayer) || e === m.riding) return;
      if (Math.abs(e.pos.x - P.pos.x) < e.hw + 0.3 + 0.3 && Math.abs(e.pos.z - P.pos.z) < e.hw + 0.3 + 0.3 && e.pos.y < P.pos.y + 1.8 + 0.3 && e.pos.y + e.h > P.pos.y - 0.3) hit = e;
    });
    if (hit) {
      this.attack(hit, true);
      P.vel.multiplyScalar(-0.2);
      this.spin = 0; P.spinning = false;
    }
  }

  /* ---- arrows and tridents coming back to you ---- */
  // an arrow walked over: into the inventory (a creative-only one just goes); false if there is no room
  pickupArrow(a) {
    if (a.owner && !a.owner.isPlayer) return false;     // a skeleton's arrows stay where they are
    if (a.pickup === 2 || this.creative) return a.pickup === 2 ? this.creative : true;
    const name = a.item || 'arrow', id = I[name];
    if (id === undefined || !this.inv) return true;
    const st = { id, count: 1 };
    if (a.potion) st.potion = a.potion;
    return this.inv.addStack(st) === 0;
  }
  // a trident home again: back in the slot it left if that is free
  pickupTrident(t) {
    if (t.pickup === 2 || this.creative) return t.pickup === 2 ? this.creative : true;
    const inv = this.inv;
    if (!inv || !t.stack) return true;
    if (t.slot !== undefined && !inv.slots[t.slot]) { inv.slots[t.slot] = t.stack; inv.changed(); return true; }
    return inv.addStack(t.stack) === 0;
  }

  /* ---- lightning on mobs: 5 damage and fire within 3 blocks; a creeper is charged ---- */
  lightning(x, y, z) {
    this.m.forNear(x, z, 4, e => {
      if (e.removed || e.dead || !(e instanceof Living)) return;
      if ((e.pos.x - x) ** 2 + (e.pos.z - z) ** 2 > 9 || Math.abs(e.pos.y - y) > 6) return;
      if (e.type === 'creeper') e.charged = true;
      if (e.setFire) e.setFire(8);
      e.hurt(5, { type: 'lightning' });
    });
  }

  /* ---- once a tick: the hands at the start of the manager's tick, the rest at its end ---- */
  tick() {
    this.shieldTick();
    this.useTick();
    this.spinTick();
  }
  lateTick() {
    // the hit that came with no direction tilts the camera straight to the side
    const sv = this.sv;
    if (sv && sv.hurtTime === 10 && this.dirAge !== this.m.age) this.hurtDir = 0;
    this.deathT = sv && sv.dead ? (this.deathT || 0) + 1 : 0;
    // the bow pulls the view in as it draws (the game's FOV modifier, eased)
    this.zoomPrev = this.zoom;
    let want = 1;
    if (this.use && this.use.kind === 'bow') { const f = Math.min(1, this.use.t / 20); want = 1 - f * f * 0.15; }
    this.zoom += (want - this.zoom) * 0.5;
  }
  fovScale(alpha) { const k = this.zoomPrev + (this.zoom - this.zoomPrev) * (alpha || 0); return 1 + (k - 1) * (this.P && this.P.fovEffects !== undefined ? this.P.fovEffects : 1); }
  /* The camera's tilt while hurt (a quaternion to multiply the view by, or
     null): sin(f^4 pi) x 14 degrees about the axis the hit came along, f
     the hurt time left, and a slow roll over while dying. */
  tilt(alpha, strength = 1) {
    const sv = this.sv;
    if (!sv || (!sv.hurtTime && !sv.dead)) return null;
    const q = this._q || (this._q = new THREE.Quaternion()), t = this._t || (this._t = new THREE.Quaternion());
    const Y = this._Y || (this._Y = new THREE.Vector3(0, 1, 0)), Z = this._Z || (this._Z = new THREE.Vector3(0, 0, 1));
    q.identity();
    if (sv.dead) {
      const f = Math.min(20, this.deathT + (alpha || 0));
      q.setFromAxisAngle(Z, -(40 - 8000 / (f + 200)) * DEG);
    }
    let f = Math.max(0, (sv.hurtTime - (alpha || 0)) / 10);
    f = Math.sin(f * f * f * f * Math.PI);
    const r = f * 14 * DEG * strength, d = this.hurtDir;
    if (r) q.multiply(t.setFromAxisAngle(Y, -d)).multiply(t.setFromAxisAngle(Z, r)).multiply(t.setFromAxisAngle(Y, d));
    return q;
  }
  /* The held item while drawing (an offset on the hand's sway): a bow or
     crossbow comes in towards the middle and shakes once the pull is past a
     tenth; a trident is raised to throw. */
  /* What the use button is doing with a hand, for render/held.js: a bow
     drawing, a crossbow loading, a trident ready to throw (total: the ticks
     to full), a shield coming up, or a loaded crossbow held to aim; null for
     nothing. side 0 is the main hand. */
  useState(alpha) {
    const u = this.use, o = this._use || (this._use = {});
    if (u) {
      o.kind = u.kind; o.side = u.off ? 1 : 0; o.t = u.t + alpha;
      o.total = u.kind === 'bow' ? 20 : u.kind === 'trident' ? 10 : u.kind === 'spear' ? 1 : Math.max(1, this.crossbowTicks(this.useStack(u)));
      return o;
    }
    if (this.shieldT > 0) {
      const inv = this.inv, s = this.shieldStack();
      o.kind = 'block'; o.side = s && inv && s === inv.offhand && s !== inv.slots[inv.selected] ? 1 : 0; o.t = this.shieldT + alpha; o.total = 5;
      return o;
    }
    const inv = this.inv;
    if (inv) for (const side of [0, 1]) {
      const s = side ? inv.offhand : inv.slots[inv.selected];
      if (s && s.charged && s.charged.length && ITEMS[s.id] && ITEMS[s.id].name === 'crossbow') { o.kind = 'aim'; o.side = side; o.t = 0; o.total = 1; return o; }
    }
    return null;
  }
  // is the player's model red this frame (third person)?
  hurtFlash() { const sv = this.sv; return !!(sv && (sv.hurtTime > 0 || sv.dead)); }
}
