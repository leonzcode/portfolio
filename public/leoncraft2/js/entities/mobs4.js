/* ---------------------------------------------------------------------------
   Leoncraft 2 - passive, tameable and village mobs.

   Numbers from the Minecraft Wiki's mob pages (Java Edition, 1.21): health,
   the movement speed attribute, attack damage on Normal, size, drops,
   experience, breeding food, and the goals each one runs in the game's
   priority order. The shapes give the familiar proportions; the textures
   are painted here, pixel by pixel, with our own patterns.

     wolf          tamed with bones (1 in 3), sits, follows and teleports to
                   you, fights for you; wild packs turn on whoever hits one
                   and hunt sheep, rabbits and foxes
     villager      wanders, looks at you, runs from zombies, opens doors
     iron_golem    100 health, throws what it hits into the air
     horse, donkey, mule   tamed by riding them until they stop bucking you
                   off; a saddle to steer, Space to charge a jump
     cat           tamed with raw fish, sits, follows; creepers keep away
     rabbit, mooshroom, fox, goat, polar_bear, turtle, frog, bee, llama,
     axolotl      (further down)

   The player is the only owner there can be, so "tamed" means "yours".
--------------------------------------------------------------------------- */
import { Mob, Living, DEG, wrap, yawTo, rotTowards, Goal, MOVE, LOOK, JUMP, TARGET, looted } from './entity.js?v=107';
import { FloatGoal, PanicGoal, StrollGoal, LookAtPlayerGoal, LookAroundGoal, TemptGoal, BreedGoal, FollowParentGoal,
  MeleeAttackGoal, LeapGoal, AvoidGoal, HurtByTargetGoal, randomLandPos, posAway } from './ai.js?v=107';
import { Animal, Cow, register, TYPES, DYES, DYE_RGB } from './mobs.js?v=107';
import { model } from './mobs2.js?v=107';
import { addArt } from './mobart.js?v=107';
import { B, BLOCKS, FLUID, SOLID } from '../blocks.js?v=107';
import { use as useBlock } from '../place.js?v=107';
import { stackToJSON, stackFromJSON, withCount as withCountOf, itemName as itemNameOf, itemId as itemIdOf, STEW_EFFECTS } from '../items.js?v=107';
import { MountScreen } from '../ui/containers.js?v=107';

// the stack in the player's hand (a mob's interact is told only the item's name), and a stack dropped where a mob is
const heldStack = m => (m.inv && m.inv.slots[m.inv.selected]) || null;
function dropStack(e, st) {
  if (!st) return;
  const H = e.m.hooks && e.m.hooks.hands, D = H && H.drops;
  if (D && D.spawn) D.spawn(e.pos.x, e.pos.y + 0.5, e.pos.z, withCountOf(st, st.count || 1));
  else e.m.dropItemAt(e.pos.x, e.pos.y + 0.5, e.pos.z, itemNameOf(st.id), st.count || 1);
}

const PI = Math.PI;
const R = () => Math.random();
const RI = n => Math.floor(Math.random() * n);
const between = (a, b) => a + RI(b - a + 1);
const POSE = 7, RX = 3, RY = 4, RZ = 5;
const set = (P, i, k, v) => { if (i !== undefined) P[i * POSE + k] = v; };
const add = (P, i, k, v) => { if (i !== undefined) P[i * POSE + k] += v; };
const tri = (f, p) => (Math.abs(f % p - p * 0.5) - p * 0.25) / (p * 0.25);   // a triangle wave, -1..1

/* Targets can be mobs as well as the player: the goals ask target.alive().
   (The player proxy has it; give living things the same question.) */
if (!('alive' in Living.prototype)) Living.prototype.alive = function () { return !this.dead && !this.removed; };

/* ---- what the player does and has done to them ----
   A pet fights whatever last hurt you and whatever you last hit. The
   manager has both moments in hand (hurtPlayer, attack); keep a note. */
function watchPlayer(m) {
  if (m.__petWatch) return;
  m.__petWatch = true;
  const hurt = m.hurtPlayer, attack = m.attack;
  m.hurtPlayer = function (amount, src) {
    const ok = hurt.call(this, amount, src);
    if (ok && src && src.attacker && !src.attacker.isPlayer) { this.playerHurtBy = src.attacker; this.playerHurtAt = this.age; }
    return ok;
  };
  m.attack = function (e) {
    const ok = attack.call(this, e);
    if (ok && e && !e.isPlayer) { this.playerHit = e; this.playerHitAt = this.age; }
    return ok;
  };
}
// somewhere a mob of this size can stand at (x, y, z) (block corner)
function standable(mob, x, y, z) {
  const T = mob.m.t, below = T.get(x, y - 1, z), d = BLOCKS[below];
  if (!below || !SOLID[below] || (d && d.leaves) || FLUID[below]) return false;
  if (FLUID[T.get(x, y, z)]) return false;
  const hw = mob.hw;
  return !T.boxHits(x + 0.5 - hw, y + 0.001, z + 0.5 - hw, x + 0.5 + hw, y + mob.h, z + 0.5 + hw);
}
const heldIs = (m, list) => list.indexOf(m.heldName()) >= 0;

/* ---------------------------------------------------------------------------
   Pets: tamed, ordered to sit, following their owner
--------------------------------------------------------------------------- */
// sitting when told to (unless the owner is close by and being hurt)
class SitGoal extends Goal {
  constructor(mob) { super(mob, MOVE | JUMP); }
  canUse() {
    const m = this.mob;
    if (!m.tamed || m.inWater || !m.onGround) return false;
    const M = m.m, p = M.player;
    if (m.dist2(p.pos.x, p.pos.y, p.pos.z) < 144 && M.playerHurtAt !== undefined && M.age - M.playerHurtAt < 100) return false;
    return m.ordered;
  }
  canContinue() { return this.canUse(); }
  interruptable() { return false; }
  start() { this.mob.nav.stop(); this.mob.sitting = true; }
  stop() { this.mob.sitting = false; }
}
/* Following: past start blocks it walks to you, and from 12 away it comes
   in a jump to a spot 2-3 blocks from you (ten tries). */
class FollowOwnerGoal extends Goal {
  constructor(mob, speed, start, stop) { super(mob, MOVE | LOOK); this.speed = speed; this.start2 = start * start; this.stop2 = stop * stop; }
  owner() { const p = this.mob.m.player; return p && p.alive() ? p : null; }
  canUse() {
    const m = this.mob, o = this.owner();
    if (!m.tamed || m.ordered || !o || m.vehicle || m.passengers.length || m.lying) return false;
    if (m.m.riding && m.m.riding === m) return false;
    return m.dist2(o.pos.x, o.pos.y, o.pos.z) >= this.start2;
  }
  canContinue() {
    const m = this.mob, o = this.owner();
    if (!o || m.ordered || m.vehicle) return false;
    return !m.nav.isDone() && m.dist2(o.pos.x, o.pos.y, o.pos.z) > this.stop2;
  }
  start() { this.t = 0; }
  stop() { this.mob.nav.stop(); }
  tick() {
    const m = this.mob, o = this.owner();
    if (!o) return;
    m.lookAt(o.pos.x, o.pos.y + 1.62, o.pos.z, 10, m.maxPitch());
    if (--this.t > 0) return;
    this.t = 10;
    if (m.dist2(o.pos.x, o.pos.y, o.pos.z) >= 144) this.teleport(o);
    else m.nav.moveTo(o.pos.x, o.pos.y, o.pos.z, this.speed, 1.5);
  }
  teleport(o) {
    const m = this.mob, ox = Math.floor(o.pos.x), oy = Math.floor(o.pos.y + 0.01), oz = Math.floor(o.pos.z);
    for (let i = 0; i < 10; i++) {
      const dx = between(-3, 3), dy = between(-1, 1), dz = between(-3, 3);
      if (Math.abs(dx) < 2 && Math.abs(dz) < 2) continue;
      if (!standable(m, ox + dx, oy + dy, oz + dz)) continue;
      m.setPos(ox + dx + 0.5, oy + dy, oz + dz + 0.5);
      m.vel.set(0, 0, 0); m.fallDist = 0;
      m.nav.stop();
      return true;
    }
    return false;
  }
}
// a target goal that holds while the target is alive, near and in reach
class PetTargetGoal extends Goal {
  constructor(mob) { super(mob, TARGET); this.unseen = 0; }
  canContinue() {
    const m = this.mob, t = m.target;
    if (!t || !t.alive() || (t.isPlayer && t.creative())) return false;
    const r = m.constructor.FOLLOW || 16;
    if (m.dist2(t.pos.x, t.pos.y, t.pos.z) > r * r) return false;
    if (m.canSee(t)) this.unseen = 0; else if (++this.unseen > 60) return false;
    return true;
  }
  start() { this.mob.target = this.t; this.unseen = 0; }
  stop() { this.mob.target = null; }
}
// whatever hurt the owner
class OwnerHurtByTargetGoal extends PetTargetGoal {
  canUse() {
    const m = this.mob, M = m.m;
    if (!m.tamed || m.ordered || M.playerHurtAt === undefined || M.playerHurtAt === this.seen) return false;
    const a = M.playerHurtBy;
    if (!a || !a.alive || !a.alive() || !m.wantsToAttack(a)) return false;
    this.seen = M.playerHurtAt; this.t = a;
    return true;
  }
}
// whatever the owner hits
class OwnerHurtTargetGoal extends PetTargetGoal {
  canUse() {
    const m = this.mob, M = m.m;
    if (!m.tamed || m.ordered || M.playerHitAt === undefined || M.playerHitAt === this.seen) return false;
    const a = M.playerHit;
    if (!a || a === m || !a.alive || !a.alive() || !m.wantsToAttack(a)) return false;
    this.seen = M.playerHitAt; this.t = a;
    return true;
  }
}
// a wild animal picking prey now and then (1 in 10 a tick, as the game does)
class PreyTargetGoal extends PetTargetGoal {
  constructor(mob, test, interval = 10, mustSee = false) { super(mob); this.test = test; this.interval = interval; this.mustSee = mustSee; }
  canUse() {
    const m = this.mob;
    if (m.tamed || RI(this.interval) !== 0) return false;
    const r = m.constructor.FOLLOW || 16;
    this.t = m.m.nearest(m, r, e => e !== m && !e.dead && this.test(e) && (!this.mustSee || m.canSee(e)));
    return !!this.t;
  }
  canContinue() { return !this.mob.tamed && super.canContinue(); }
}
// a target of a kind, tamed or not (wolves and skeletons)
class KindTargetGoal extends PreyTargetGoal {
  canUse() {
    const m = this.mob;
    if (RI(this.interval) !== 0) return false;
    this.t = m.m.nearest(m, m.constructor.FOLLOW || 16, e => e !== m && !e.dead && this.test(e) && (!this.mustSee || m.canSee(e)));
    return !!this.t;
  }
  canContinue() { return PetTargetGoal.prototype.canContinue.call(this); }
}
// the one it is angry with (neutral mobs: 20-39 seconds after being hit)
class AngerTargetGoal extends PetTargetGoal {
  canUse() {
    const m = this.mob, a = m.angryAt;
    if (!a || m.angerT <= 0 || !a.alive || !a.alive() || (a.isPlayer && a.creative())) return false;
    if (m.target === a) return false;
    const r = m.constructor.FOLLOW || 16;
    if (m.dist2(a.pos.x, a.pos.y, a.pos.z) > r * r) return false;
    this.t = a;
    return true;
  }
  canContinue() { const m = this.mob; return m.angerT > 0 && m.target === m.angryAt && super.canContinue(); }
}
// running about only while burning (wolves, cats: hit, they fight or flee by other goals)
class FirePanicGoal extends PanicGoal {
  canUse() { return this.mob.fire > 0 && super.canUse(); }
}
// sticking up for itself: what hurt it (never its owner)
class DefendSelfGoal extends HurtByTargetGoal {
  constructor(mob) { super(mob, false); }
  canUse() {
    const m = this.mob, a = m.lastHurtBy;
    if (a && a.isPlayer && m.tamed) return false;
    if (a && !a.isPlayer && m.tamed && a.tamed) return false;
    return super.canUse();
  }
}

export class Tamable extends Animal {
  constructor(m, type) {
    super(m, type);
    this.tamed = false;
    this.ordered = false;            // told to sit
    this.sitting = false;            // sitting now
    watchPlayer(m);
  }
  // what a pet would go for, on its owner's behalf (the game's wantsToAttack)
  wantsToAttack(t) {
    if (!t || t.isPlayer || t === this || t.dead) return false;
    if (t.type === 'creeper' || t.type === 'ghast' || t.type === 'armor_stand') return false;
    if (t.tamed) return false;                 // the owner's other pets, tamed horses
    return true;
  }
  tame() {
    this.tamed = true; this.persistent = true;
    this.nav.stop(); this.target = null;
    this.m.particles('heart', this.pos.x, this.pos.y + this.h * 0.6, this.pos.z, 7, this.w * 0.6);
  }
  tameFailed() { this.m.particles('smoke', this.pos.x, this.pos.y + this.h * 0.6, this.pos.z, 7, this.w * 0.6); }
  toggleSit() { this.ordered = !this.ordered; this.nav.stop(); this.target = null; this.jumping = false; }
  onHurt(amount, source) {
    super.onHurt(amount, source);
    // hurt while sitting: it gets up
    if (this.ordered && source.type !== 'fall') this.ordered = false;
  }
  inherit(a, b) { if (a.tamed || b.tamed) { this.tamed = true; this.persistent = true; } }
  toJSON() { const o = super.toJSON(); if (this.tamed) o.tm = 1; if (this.ordered) o.sit = 1; return o; }
  fromJSON(o) { super.fromJSON(o); this.tamed = !!o.tm; this.ordered = !!o.sit; }
}

/* ---------------------------------------------------------------------------
   Wolf: 8 health wild, 40 tamed; speed 0.3; 4 damage; 0.6 x 0.85.
   Bones tame it (each one 1 in 3); meat heals a tamed wolf by twice its
   food value and, at full health, makes it ready to breed.
--------------------------------------------------------------------------- */
// meat, and the food points each is worth (healing is twice that)
const WOLF_FOOD = {
  beef: 3, cooked_beef: 8, porkchop: 3, cooked_porkchop: 8, chicken: 2, cooked_chicken: 6, mutton: 2, cooked_mutton: 6,
  rabbit: 3, cooked_rabbit: 5, rotten_flesh: 4, rabbit_stew: 10, cod: 2, cooked_cod: 5, salmon: 2, cooked_salmon: 6, pufferfish: 1, tropical_fish: 1,
};
const WOLF_VARIANTS = ['pale', 'woods', 'ashen', 'black', 'chestnut', 'rusty', 'spotted', 'striped', 'snowy'];
const WOLF_BIOME = {
  taiga: 'pale', forest: 'woods', snowy_taiga: 'ashen', old_growth_pine_taiga: 'black', old_growth_spruce_taiga: 'chestnut',
  sparse_jungle: 'rusty', savanna_plateau: 'spotted', wooded_badlands: 'striped', grove: 'snowy',
};
const SKELETONS = new Set(['skeleton', 'stray', 'wither_skeleton', 'bogged']);
const WOLF_PREY = new Set(['sheep', 'rabbit', 'fox']);

class BegGoal extends Goal {
  constructor(mob, dist) { super(mob, LOOK); this.d2 = dist * dist; }
  wants() {
    const m = this.mob, h = m.m.heldName();
    return m.tamed ? WOLF_FOOD[h] !== undefined || h === 'bone' : h === 'bone';
  }
  canUse() {
    const m = this.mob, p = m.m.player;
    if (!p.alive() || m.dist2(p.pos.x, p.pos.y, p.pos.z) > this.d2 || m.angerT > 0) return false;
    return this.wants();
  }
  canContinue() { const m = this.mob, p = m.m.player; return this.t > 0 && p.alive() && m.dist2(p.pos.x, p.pos.y, p.pos.z) <= this.d2 && this.wants(); }
  start() { this.mob.begging = true; this.t = 40 + RI(40); }
  stop() { this.mob.begging = false; }
  tick() { this.t--; this.mob.lookAtEntity(this.mob.m.player, 10, this.mob.maxPitch()); }
}

export class Wolf extends Tamable {
  static W = 0.6; static H = 0.85; static HEALTH = 8; static SPEED = 0.3; static ATTACK = 4; static FOLLOW = 16;
  static MODEL = 'wolf'; static TEX = 'wolf_pale'; static SHADOW = 0.5; static TAMABLE = true; static MAX_PER_CHUNK = 8;
  static SPAWN_ON = ['grass_block', 'snow', 'snow_block', 'coarse_dirt', 'podzol'];
  static FOOD = Object.keys(WOLF_FOOD);
  constructor(m, type) {
    super(m, type);
    this.variant = 'pale'; this.collar = 'red';
    this.angerT = 0; this.angryAt = null;
    this.wet = false; this.shakeT = -1; this.oShake = -1;
    this.interest = 0; this.oInterest = 0; this.begging = false;
  }
  get eyeH() { return this.h * 0.8; }
  registerGoals() {
    this.goals.add(1, new FloatGoal(this));
    this.goals.add(1, new FirePanicGoal(this, 1.5));      // a wolf runs only from fire; hit, it fights
    this.goals.add(2, new SitGoal(this));
    this.goals.add(3, new AvoidGoal(this, e => e.type === 'llama' && !this.tamed && !e.dead, 24, 1.5, 1.5));
    this.goals.add(4, new LeapGoal(this, 0.4));
    this.goals.add(5, new MeleeAttackGoal(this, 1, true));
    this.goals.add(6, new FollowOwnerGoal(this, 1, 10, 2));
    this.goals.add(7, new BreedGoal(this, 1));
    this.goals.add(8, new StrollGoal(this, 1));
    this.goals.add(9, new BegGoal(this, 8));
    this.goals.add(10, new LookAtPlayerGoal(this, 8));
    this.goals.add(10, new LookAroundGoal(this));
    this.targets.add(1, new OwnerHurtByTargetGoal(this));
    this.targets.add(2, new OwnerHurtTargetGoal(this));
    this.targets.add(3, new DefendSelfGoal(this));
    this.targets.add(4, new AngerTargetGoal(this));
    this.targets.add(5, new PreyTargetGoal(this, e => WOLF_PREY.has(e.type) && !(e.type === 'fox' && false)));
    this.targets.add(7, new KindTargetGoal(this, e => SKELETONS.has(e.type), 10, false));
  }
  finalizeSpawn() {
    const b = this.m.spawner ? this.m.spawner.biome(Math.floor(this.pos.x), Math.floor(this.pos.z)) : 'taiga';
    this.variant = WOLF_BIOME[b] || 'pale';
  }
  texName() { return 'wolf_' + this.variant; }
  get angry() { return this.angerT > 0; }
  // angry with someone, and the pack with it (33 x 21 x 33 round the wolf)
  angerAt(a, spread = true) {
    if (!a || (a.isPlayer && (this.tamed || a.creative()))) return;
    this.angryAt = a; this.angerT = 400 + RI(380);
    if (!spread) return;
    this.m.forNear(this.pos.x, this.pos.z, 16, o => {
      if (o === this || o.type !== 'wolf' || o.dead || Math.abs(o.pos.y - this.pos.y) > 10) return;
      if (Math.abs(o.pos.x - this.pos.x) > 16 || Math.abs(o.pos.z - this.pos.z) > 16) return;
      if (o.tamed && (o.ordered || a.isPlayer)) return;
      if (o.tamed !== this.tamed) return;
      o.angerAt(a, false);
      if (!o.target) o.target = a;
    });
  }
  onHurt(amount, source) {
    super.onHurt(amount, source);
    const a = source.attacker;
    if (a && a !== this && !(a.isPlayer && this.tamed) && !(a.tamed && this.tamed)) this.angerAt(a, true);
  }
  aiStep() {
    // persistent anger runs out
    if (this.angerT > 0 && --this.angerT === 0) { if (this.target === this.angryAt) this.target = null; this.angryAt = null; }
    // a wolf is wet from water; out of it, it shakes itself dry
    this.oShake = this.shakeT;
    if (this.inWater) { this.wet = true; this.shakeT = -1; }
    else if (this.wet && this.onGround && this.shakeT < 0) this.shakeT = 0;
    if (this.shakeT >= 0) {
      if (this.shakeT > 0.4 && this.age % 2 === 0) {
        const n = 1 + RI(3);
        this.m.particles('splash', this.pos.x, this.pos.y + 0.8, this.pos.z, n, this.w * 0.5, [0.6, 0.7, 1]);
      }
      this.shakeT += 0.05;
      if (this.shakeT >= 2) { this.wet = false; this.shakeT = -1; this.oShake = -1; }
    }
    this.oInterest = this.interest;
    this.interest += ((this.begging ? 1 : 0) - this.interest) * 0.4;
    // a tamed wolf heals itself slowly? no: only food heals it (as the game does). A wild one regains health
    super.aiStep();
  }
  // a pet's own owner is never its target; nor its owner's other pets
  wantsToAttack(t) { return super.wantsToAttack(t) && !(t.type === 'wolf' && t.tamed); }
  interact(held, player) {
    const food = WOLF_FOOD[held];
    // wolf armour (the owner's: here every tamed wolf is yours): on a tamed adult, off with shears, mended with a scute
    if (this.tamed && this.ageT >= 0) {
      if (held === 'wolf_armor' && !this.body) { this.body = withCountOf(heldStack(this.m), 1); return 'consume'; }
      if (held === 'shears' && this.body) { dropStack(this, this.body); this.body = null; return 'damage'; }
      if (held === 'armadillo_scute' && this.body && (this.body.dmg | 0) > 0) { this.body.dmg = Math.max(0, (this.body.dmg | 0) - 8); return 'consume'; }
    }
    if (this.tamed) {
      if (food !== undefined && this.health < this.maxHealth) {
        this.heal(food * 2);
        this.m.particles('heart', this.pos.x, this.pos.y + this.h, this.pos.z, 2, 0.3);
        return 'consume';
      }
      if (held && held.endsWith('_dye')) {
        const c = held.slice(0, -4);
        if (DYES.indexOf(c) >= 0 && c !== this.collar) { this.collar = c; return 'consume'; }
      }
      if (food !== undefined && this.health >= this.maxHealth && this.feed()) return 'consume';
      if (food !== undefined && this.ageT < 0 && this.feed()) return 'consume';
      this.toggleSit();
      return 'swing';
    }
    if (held === 'bone' && !this.angry) {
      if (RI(3) === 0) { this.tame(); this.ordered = true; }
      else this.tameFailed();
      return 'consume';
    }
    return false;
  }
  tame() {
    super.tame();
    this.maxHealth = 40; this.health = 40;
    this.angerT = 0; this.angryAt = null;
  }
  inherit(a, b) {
    super.inherit(a, b);
    if (this.tamed) { this.maxHealth = 40; this.health = 40; }
    this.variant = (R() < 0.5 ? a : b).variant || 'pale';
  }
  // the tail: straight out when angry; tamed, its height shows the wolf's health
  tailAngle() {
    if (this.angry) return 1.5393804;
    if (this.tamed) return (0.55 - (1 - this.health / this.maxHealth) * 0.4) * PI;
    return PI / 5;
  }
  anim(A, a) {
    A.tail = this.tailAngle();
    A.angry = this.angry;
    A.interest = (this.oInterest + (this.interest - this.oInterest) * a) * 0.15 * PI;
    // shaking dry: the body rolls from head to tail
    const s = this.shakeT < 0 ? -1 : this.oShake + (this.shakeT - this.oShake) * a;
    const roll = off => {
      if (s < 0) return 0;
      let f = (s + off) / 1.8; f = Math.max(0, Math.min(1, f));
      return Math.sin(f * PI) * Math.sin(f * PI * 11) * 0.15 * PI;
    };
    A.roll0 = roll(0); A.roll1 = roll(-0.08); A.roll2 = roll(-0.16); A.roll3 = roll(-0.2);
  }
  layers(out) {
    if (this.tamed) { out.push(['wolf_collar', 'wolf_collar', DYE_RGB[this.collar] || DYE_RGB.red]); out.push(['wolf_eyes', 'wolf_eyes_tame', null]); }
    else if (this.angry) out.push(['wolf_eyes', 'wolf_eyes_angry', null]);
    if (this.body) {
      const b = this.body, left = 1 - (b.dmg | 0) / 64;
      out.push(['wolf_armor', 'wolf_armor', null, !!b.ench, true]);
      if (b.color !== undefined) out.push(['wolf_armor', 'wolf_armor_overlay', b.color, false, true]);
      // cracks as it wears: under 95%, 69% and 32% left (the game's thresholds)
      if (left <= 0.95) out.push(['wolf_armor', left <= 0.32 ? 'wolf_armor_crack_high' : left <= 0.69 ? 'wolf_armor_crack_medium' : 'wolf_armor_crack_low', null, false, true]);
    }
  }
  /* Wolf armour takes the hit instead of the wolf (all but drowning,
     freezing, suffocating, magic, thorns, wither, the void and crowding),
     worn a point for each point of damage; the wolf only flashes and is
     pushed. At 64 it breaks. */
  hurt(amount, source) {
    const b = this.body;
    if (!b || this.dead || this.removed || amount <= 0 || /^(drown|freeze|suffocat\w*|in_wall|magic|thorns|wither|void|cramming|kill)$/.test(source.type || '')) return super.hurt(amount, source);
    if (this.invul > 10) { if (amount <= this.lastHurt) return false; } else { this.invul = 20; this.hurtTime = 10; }
    this.lastHurt = amount;
    b.dmg = (b.dmg | 0) + Math.ceil(amount);
    if (b.dmg >= 64) { this.body = null; this.m.particles('poof', this.pos.x, this.pos.y + this.h * 0.6, this.pos.z, 8, 0.4); }
    if (!source.noKnock && source.x !== undefined) this.knockback(0.4, source.x - this.pos.x, source.z - this.pos.z);
    if (source.attacker) { this.lastHurtBy = source.attacker; this.lastHurtByTime = 100; }
    this.onHurt(0, source);
    return true;
  }
  get xp() { return this.ageT < 0 ? 0 : 1 + RI(3); }
  loot(drop) { if (this.body) { dropStack(this, this.body); this.body = null; } }
  toJSON() { const o = super.toJSON(); o.var = this.variant; if (this.collar !== 'red') o.col = this.collar; if (this.body) o.body = stackToJSON(this.body); return o; }
  fromJSON(o) {
    super.fromJSON(o);
    this.variant = o.var || 'pale'; this.collar = o.col || 'red';
    if (o.body) this.body = stackFromJSON(o.body);
    if (this.tamed) { this.maxHealth = 40; if (o.h !== undefined) this.health = o.h; }
  }
}
register('wolf', Wolf);

/* ---- the wolf's shape (game units: y down from 24 at the feet, -z the nose) ---- */
const wolfParts = (layer) => [
  { name: 'head', pivot: [-1, 13.5, -7], boxes: layer === 'eyes' ? [[-2, -3, -2, 6, 6, 4, 0, 0, 0.02]] : layer ? [] :
    [[-2, -3, -2, 6, 6, 4, 0, 0], [-2, -5, 0, 2, 2, 1, 16, 14], [2, -5, 0, 2, 2, 1, 16, 14], [-0.5, 0, -5, 3, 3, 4, 0, 10]] },
  { name: 'body', pivot: [0, 14, 2], rot: [PI / 2, 0, 0], boxes: layer ? [] : [[-3, -2, -3, 6, 9, 6, 18, 14]] },
  { name: 'mane', pivot: [-1, 14, -3], rot: [PI / 2, 0, 0], boxes: layer === 'collar' ? [[-3, -3, -3, 8, 6, 7, 21, 0, 0.1, false, 1]] : layer ? [] : [[-3, -3, -3, 8, 6, 7, 21, 0]] },
  { name: 'rightHind', pivot: [-2.5, 16, 7], boxes: layer ? [] : [[0, 0, -1, 2, 8, 2, 0, 18]] },
  { name: 'leftHind', pivot: [0.5, 16, 7], boxes: layer ? [] : [[0, 0, -1, 2, 8, 2, 0, 18]] },
  { name: 'rightFront', pivot: [-2.5, 16, -4], boxes: layer ? [] : [[0, 0, -1, 2, 8, 2, 0, 18]] },
  { name: 'leftFront', pivot: [0.5, 16, -4], boxes: layer ? [] : [[0, 0, -1, 2, 8, 2, 0, 18]] },
  { name: 'tail', pivot: [-1, 12, 8], rot: [PI / 5, 0, 0], boxes: layer ? [] : [[0, 0, -1, 2, 8, 2, 9, 18]] },
];
function wolfAnim(m, P, A) {
  const I = m.index;
  set(P, I.head, RX, A.pitch); set(P, I.head, RY, A.yaw);
  set(P, I.head, RZ, (A.interest || 0) + (A.roll0 || 0));
  const w = A.walk * 0.6662, s = A.amt;
  if (A.sitting) {
    // sitting: haunches down, front legs braced, chest up
    set(P, I.mane, 1, 16); set(P, I.mane, RX, 2 * PI / 5);
    set(P, I.body, 1, 18); set(P, I.body, 2, 0); set(P, I.body, RX, PI / 4);
    set(P, I.tail, 1, 21); set(P, I.tail, 2, 6);
    for (const k of ['rightHind', 'leftHind']) { set(P, I[k], 1, 22.7); set(P, I[k], 2, 2); set(P, I[k], RX, -PI / 2); }
    for (const k of ['rightFront', 'leftFront']) { set(P, I[k], 1, 17); set(P, I[k], RX, -0.4712389); }
    set(P, I.rightFront, 0, -2.49); set(P, I.leftFront, 0, 0.51);
  } else {
    set(P, I.rightHind, RX, Math.cos(w) * 1.4 * s); set(P, I.leftHind, RX, Math.cos(w + PI) * 1.4 * s);
    set(P, I.rightFront, RX, Math.cos(w + PI) * 1.4 * s); set(P, I.leftFront, RX, Math.cos(w) * 1.4 * s);
  }
  set(P, I.tail, RX, A.tail === undefined ? PI / 5 : A.tail);
  set(P, I.tail, RY, A.angry ? 0 : Math.cos(w) * 1.4 * s);
  set(P, I.mane, RZ, A.roll1 || 0); set(P, I.body, RZ, A.roll2 || 0); add(P, I.tail, RZ, A.roll3 || 0);
}
model('wolf', wolfParts(null), wolfAnim);
model('wolf_collar', wolfParts('collar'), wolfAnim);
model('wolf_eyes', wolfParts('eyes'), wolfAnim);
// wolf armour: over the body and the mane, a fifth of a pixel out
model('wolf_armor', wolfParts(null).map(p => Object.assign({}, p, { boxes: p.name === 'body' || p.name === 'mane' ? p.boxes.map(b => { const c = b.slice(); while (c.length < 11) c.push(0); c[8] = 0.2; c[9] = !!c[9]; c[10] = 1; return c; }) : [] })), wolfAnim);

/* ---- wolf coats ----
   Each variant: base fur, a darker back, a lighter belly and muzzle, and
   its own markings (spots, stripes). The face is drawn with plain eyes;
   tamed and angry eyes go over it as a layer. */
const WOLF_COATS = {
  pale: { base: 0xd8d4cc, back: 0xbcb6ac, belly: 0xeeebe4, muzzle: 0xe8e4dc, nose: 0x262222 },
  woods: { base: 0x7a5c3e, back: 0x4e3a26, belly: 0xb09272, muzzle: 0xa48666, nose: 0x1e1612 },
  ashen: { base: 0x9e9ea4, back: 0x76767e, belly: 0xc4c4c8, muzzle: 0xbcbcc0, nose: 0x202024 },
  black: { base: 0x2e2c2e, back: 0x1e1c1e, belly: 0x4a4648, muzzle: 0x6e6a68, nose: 0x0e0c0c },
  chestnut: { base: 0x7e4a2c, back: 0x5c341e, belly: 0xd8c8b4, muzzle: 0xe4d6c4, nose: 0x1e1410 },
  rusty: { base: 0xa85e2e, back: 0x7c4220, belly: 0xd29a62, muzzle: 0xdcb088, nose: 0x241610 },
  spotted: { base: 0xc8a46c, back: 0xb08c58, belly: 0xe2cca0, muzzle: 0xe0caa2, nose: 0x241a10, spots: 0x5a3e22 },
  striped: { base: 0xc49a5e, back: 0xa47c48, belly: 0xe0c494, muzzle: 0xdcc090, nose: 0x22180e, stripes: 0x6a4a28 },
  snowy: { base: 0xf2f2f0, back: 0xe2e2e0, belly: 0xfcfcfc, muzzle: 0xfcfcfc, nose: 0x3a3434 },
};
function paintWolf(p, c) {
  const fur = (x, y, w, h, col, amt = 0.07) => { p.fill(x, y, w, h, col, amt); p.speckle(x, y, w, h, p.shade(col, 0.9), 0.18, 0.03); p.speckle(x, y, w, h, p.shade(col, 1.08), 0.12, 0.03); };
  p.clear(0, 0, 64, 32);
  // head (0,0) 6x6x4: the face at (4,4)
  p.box(0, 0, 6, 6, 4, { all: (x, y, w, h) => fur(x, y, w, h, c.base) });
  fur(4, 0, 6, 4, c.back);                                     // top of the head
  const fx = 4, fy = 4;
  fur(fx, fy + 3, 6, 3, c.muzzle);                            // the cheeks under the eyes
  p.px(fx, fy + 2, 0xf4f4f0); p.px(fx + 1, fy + 2, 0x141414); // eyes
  p.px(fx + 4, fy + 2, 0x141414); p.px(fx + 5, fy + 2, 0xf4f4f0);
  p.px(fx + 1, fy + 1, p.shade(c.base, 0.85)); p.px(fx + 4, fy + 1, p.shade(c.base, 0.85));
  // ears (16,14): dark inside
  p.box(16, 14, 2, 2, 1, { all: (x, y, w, h) => fur(x, y, w, h, c.back) });
  p.fill(17, 15, 2, 2, p.shade(c.back, 0.6), 0.05);
  p.fill(20, 15, 2, 2, c.back, 0.05);
  // snout (0,10) 3x3x4: the nose on top of its front
  p.box(0, 10, 3, 3, 4, { all: (x, y, w, h) => fur(x, y, w, h, c.muzzle, 0.05) });
  fur(4, 10, 3, 4, p.shade(c.muzzle, 0.95));
  p.fill(4, 14, 3, 1, c.nose, 0.05);                          // the nose
  p.px(4, 10, c.nose); p.px(5, 10, c.nose); p.px(6, 10, c.nose);
  p.px(5, 16, p.shade(c.muzzle, 0.7));                        // the mouth
  // body (18,14) 6x9x6, turned up: its back face is the wolf's back, its front the belly
  p.box(18, 14, 6, 9, 6, { all: (x, y, w, h) => fur(x, y, w, h, c.base) });
  fur(36, 20, 6, 9, c.back);                                   // the back
  fur(24, 20, 6, 9, c.belly);                                  // the belly
  fur(18, 20, 2, 9, c.back); fur(34, 20, 2, 9, c.back);        // the back's edge on each side
  fur(22, 20, 2, 9, c.belly); fur(30, 20, 2, 9, c.belly);
  // mane (21,0) 8x6x7: thicker, a little lighter at the chest
  p.box(21, 0, 8, 6, 7, { all: (x, y, w, h) => fur(x, y, w, h, c.base, 0.09) });
  fur(43, 7, 8, 6, c.back);                                    // over the shoulders
  fur(28, 7, 8, 6, c.belly);                                   // the chest
  fur(21, 7, 2, 6, c.back); fur(41, 7, 2, 6, c.back);
  // legs (0,18), tail (9,18)
  p.box(0, 18, 2, 8, 2, { all: (x, y, w, h) => fur(x, y, w, h, c.base) });
  p.fill(0, 26, 8, 2, p.shade(c.belly, 0.95), 0.05);
  p.box(9, 18, 2, 8, 2, { all: (x, y, w, h) => fur(x, y, w, h, c.back) });
  p.fill(9, 26, 8, 2, p.shade(c.back, 0.8), 0.05);             // the tip
  if (c.spots) {
    for (const [x, y] of [[37, 21], [40, 24], [38, 27], [19, 22], [33, 25], [44, 9], [47, 11], [22, 9], [25, 23], [31, 21]]) { p.px(x, y, c.spots); p.px(x + 1, y, p.shade(c.spots, 1.15)); }
  }
  if (c.stripes) {
    for (let y = 21; y < 29; y += 2) { p.fill(36, y, 6, 1, c.stripes, 0.08); p.fill(18, y, 2, 1, c.stripes); p.fill(34, y, 2, 1, c.stripes); }
    for (let y = 8; y < 13; y += 2) p.fill(43, y, 8, 1, c.stripes, 0.08);
  }
}
for (const v of WOLF_VARIANTS) addArt('wolf_' + v, [64, 32], p => paintWolf(p, WOLF_COATS[v]));
// the collar: a band round the neck, white so the dye colour shows (a tinted layer)
addArt('wolf_collar', [64, 32], p => {
  p.clear(0, 0, 64, 32);
  p.fill(21, 7, 30, 2, 0xf0f0f0, 0.04);
  p.fill(28 + 3, 8, 2, 1, 0xd8d8d8);
});
/* wolf armour, our own: rows of scute plates over the back and shoulders;
   a pale overlay for the dye; dark cracks in three steps as it wears */
addArt('wolf_armor', [64, 32], p => {
  p.clear(0, 0, 64, 32);
  const scute = (x, y, w, h) => { p.fill(x, y, w, h, 0x9a6e62, 0.06); for (let j = 1; j < h; j += 3) p.fill(x, y + j, w, 1, 0x6e4a42, 0.04); for (let i = 0; i < w; i += 4) p.px(x + i, y, 0xc49a8a); };
  p.box(18, 14, 6, 9, 6, { all: scute });
  p.box(21, 0, 8, 6, 7, { all: scute });
});
addArt('wolf_armor_overlay', [64, 32], p => {
  p.clear(0, 0, 64, 32);
  for (let y = 21; y < 29; y += 3) p.fill(18, y, 30, 1, 0xf0f0f0, 0.03);
  for (let y = 8; y < 13; y += 3) p.fill(21, y, 30, 1, 0xf0f0f0, 0.03);
});
for (const [k, n] of [['low', 6], ['medium', 14], ['high', 26]]) addArt('wolf_armor_crack_' + k, [64, 32], p => {
  p.clear(0, 0, 64, 32);
  for (let i = 0; i < n; i++) {
    let x = 18 + Math.floor(p.r() * 30), y = (p.r() < 0.5 ? 1 : 15) + Math.floor(p.r() * 12);
    for (let s = 0; s < 3; s++) { p.px(x, y, 0x2a1e1a); x += p.r() < 0.5 ? 1 : 0; y += 1; }
  }
});
// eyes over the face: tamed (soft, a lighter brow) and angry (red, the brow down)
addArt('wolf_eyes_tame', [64, 32], p => {
  p.clear(0, 0, 64, 32);
  const fx = 4, fy = 4;
  p.px(fx, fy + 2, 0xf4f4f0); p.px(fx + 1, fy + 2, 0x141414); p.px(fx + 4, fy + 2, 0x141414); p.px(fx + 5, fy + 2, 0xf4f4f0);
  p.px(fx + 1, fy + 1, 0xf0ece4); p.px(fx + 4, fy + 1, 0xf0ece4);
});
addArt('wolf_eyes_angry', [64, 32], p => {
  p.clear(0, 0, 64, 32);
  const fx = 4, fy = 4;
  p.px(fx, fy + 2, 0xd82020); p.px(fx + 1, fy + 2, 0x500808); p.px(fx + 4, fy + 2, 0x500808); p.px(fx + 5, fy + 2, 0xd82020);
  p.px(fx + 1, fy + 1, 0x1a1414); p.px(fx + 2, fy + 1, 0x1a1414); p.px(fx + 3, fy + 1, 0x1a1414); p.px(fx + 4, fy + 1, 0x1a1414);
  p.px(fx, fy, 0x1a1414); p.px(fx + 5, fy, 0x1a1414);
});

/* ---------------------------------------------------------------------------
   Villager: 20 health, speed 0.5 (walking at half of it, running at three
   quarters), 0.6 x 1.95. Wanders, looks at you, runs from zombies and from
   whatever hurt it, opens and shuts wooden doors on its way.
--------------------------------------------------------------------------- */
const VILLAGER_FEARS = { zombie: 8, husk: 8, drowned: 8, zombie_villager: 8, vindicator: 10, evoker: 12, pillager: 15, ravager: 12, vex: 8, illusioner: 12, zoglin: 10 };
class VillagerPanicGoal extends Goal {
  constructor(mob, speed) { super(mob, MOVE); this.speed = speed; }
  threat() {
    const m = this.mob;
    if (m.lastHurtBy && m.lastHurtByTime > 0 && m.lastHurtBy.alive && m.lastHurtBy.alive()) return m.lastHurtBy;
    return m.m.nearest(m, 15, e => { const r = VILLAGER_FEARS[e.type]; return r !== undefined && !e.dead && m.dist2(e.pos.x, e.pos.y, e.pos.z) <= r * r; });
  }
  canUse() {
    const t = this.threat();
    if (!t) return false;
    const p = posAway(this.mob, 16, 7, t.pos);
    if (!p) return false;
    this.from = t; this.p = p;
    return true;
  }
  start() { this.mob.nav.moveTo(this.p[0], this.p[1], this.p[2], this.speed, 0.5); this.mob.panicking = true; }
  canContinue() { return !this.mob.nav.isDone(); }
  stop() { this.mob.panicking = false; }
}
export class Villager extends Mob {
  static W = 0.6; static H = 1.95; static HEALTH = 20; static SPEED = 0.5; static FOLLOW = 48; static CATEGORY = 'misc';
  static MODEL = 'villager'; static TEX = 'villager'; static SHADOW = 0.5; static BABY_HEAD = 1.4; static XP = 0;
  constructor(m, type) {
    super(m, type);
    this.canOpenDoors = true;
    this.persistent = true;
    this.ageT = 0;
    this.shakeT = 0;
    this.doors = [];                 // doors it opened, to shut behind it
  }
  get eyeH() { return this.ageT < 0 ? 0.81 : 1.62; }
  registerGoals() {
    this.goals.add(0, new FloatGoal(this));
    this.goals.add(1, new VillagerPanicGoal(this, 0.75));
    this.goals.add(5, new StrollGoal(this, 0.5, 80));
    this.goals.add(6, new LookAtPlayerGoal(this, 8, 0.04));
    this.goals.add(7, new LookAroundGoal(this));
  }
  walkValue(x, y, z) { return this.m.t.get(x, y - 1, z) === B.grass_block ? 2 : 0; }
  // a villager struck by lightning (manager.js lightning) is a witch where it stood, not on Peaceful (a wandering trader is only hurt)
  thunderHit(m) {
    if (this.type !== 'villager' || m.difficulty === 'peaceful') return undefined;
    const n = m.convertMob(this, 'witch', w => { w.persistent = true; });
    return n ? false : undefined;
  }
  aiStep() {
    super.aiStep();
    if (this.ageT < 0 && ++this.ageT === 0) this.setBaby(false);
    if (this.shakeT > 0) this.shakeT--;
    this.doorTick();
  }
  setBaby(b) { if (b) { this.ageT = -24000; this.w = 0.3; this.hw = 0.15; this.h = 0.975; } else { this.w = 0.6; this.hw = 0.3; this.h = 1.95; } }
  /* Doors: a closed wooden door on the next two steps of its path opens as
     it comes up to it; doors it opened shut once it is two blocks past and
     nobody stands in them. */
  doorTick() {
    const nav = this.nav, T = this.m.t, W = this.m.world;
    if (nav && nav.path && !nav.isDone()) {
      for (let k = nav.i; k < Math.min(nav.path.length, nav.i + 2); k++) {
        const n = nav.path[k];
        for (const dy of [0, 1]) {
          const x = n[0], y = n[1] + dy, z = n[2];
          const d = BLOCKS[T.get(x, y, z)];
          if (!d || d.shape !== 'door' || /^iron_/.test(d.name)) continue;
          if ((x + 0.5 - this.pos.x) ** 2 + (z + 0.5 - this.pos.z) ** 2 > 2.6) continue;
          const lowerY = T.meta(x, y, z) & 8 ? y - 1 : y;
          if (!(T.meta(x, lowerY, z) & 4)) { useBlock(W, x, lowerY, z); this.doors.push([x, lowerY, z]); }
          else if (!this.doors.some(q => q[0] === x && q[1] === lowerY && q[2] === z)) this.doors.push([x, lowerY, z]);
          break;
        }
      }
    }
    for (let i = this.doors.length - 1; i >= 0; i--) {
      const [x, y, z] = this.doors[i];
      if ((x + 0.5 - this.pos.x) ** 2 + (z + 0.5 - this.pos.z) ** 2 < 4) continue;
      const d = BLOCKS[T.get(x, y, z)];
      this.doors.splice(i, 1);
      if (!d || d.shape !== 'door' || !(T.meta(x, y, z) & 4)) continue;
      let busy = false;
      this.m.forNear(x + 0.5, z + 0.5, 2, e => { if (!e.removed && Math.abs(e.pos.x - x - 0.5) < 0.5 + e.hw && Math.abs(e.pos.z - z - 0.5) < 0.5 + e.hw && Math.abs(e.pos.y - y) < 2) busy = true; });
      const P = this.m.P;
      if (Math.abs(P.pos.x - x - 0.5) < 0.8 && Math.abs(P.pos.z - z - 0.5) < 0.8 && Math.abs(P.pos.y - y) < 2) busy = true;
      if (!busy) useBlock(W, x, y, z);
    }
  }
  onHurt(amount, source) { super.onHurt(amount, source); this.shakeT = 40; }
  // killed by a zombie: half the time on Normal, always on Hard, it comes back as a zombie villager
  die(source) {
    const a = source && source.attacker;
    const zombie = a && /^(zombie|husk|drowned|zombie_villager)$/.test(a.type);
    const d = this.m.difficulty;
    super.die(source);
    if (zombie && (d === 'hard' || (d === 'normal' && R() < 0.5)) && TYPES.zombie_villager) {
      const z = this.m.spawn('zombie_villager', this.pos.x, this.pos.y, this.pos.z, { natural: false, yaw: this.yaw });
      if (z) { z.persistent = true; this.remove(); }
    }
  }
  anim(A) { A.shake = this.shakeT > 0; }
  toJSON() { const o = super.toJSON(); if (this.ageT) o.age = this.ageT; return o; }
  fromJSON(o) { super.fromJSON(o); if (o.age < 0) { this.setBaby(true); this.ageT = o.age; } }
}
register('villager', Villager);

/* ---------------------------------------------------------------------------
   Iron golem: 100 health, speed 0.25, knockback resistance 1, 1.4 x 2.7.
   A hit does half its 15 attack plus 0 to 14 more (7.5 to 21.5 on Normal)
   and throws the target 0.4 a tick upwards. It goes for hostile mobs (not
   creepers) and leaves you alone unless you hit it. No fall damage, no
   drowning. Iron ingots mend it by 25.
--------------------------------------------------------------------------- */
class GolemTargetGoal extends PetTargetGoal {
  canUse() {
    const m = this.mob;
    if (RI(5) !== 0) return false;
    this.t = m.m.nearest(m, 16, e => e.constructor.HOSTILE && !e.dead && e.type !== 'creeper' && m.canSee(e));
    return !!this.t;
  }
}
// the golem walks slowly towards its target before the swing (the game's MoveTowardsTarget)
export class IronGolem extends Mob {
  static W = 1.4; static H = 2.7; static HEALTH = 100; static SPEED = 0.25; static ATTACK = 15; static KB_RESIST = 1; static FOLLOW = 16;
  static NO_FALL = true; static WATER_BREATHER = true; static CATEGORY = 'misc'; static XP = 0;
  static MODEL = 'iron_golem'; static TEX = 'iron_golem'; static SHADOW = 0.9;
  constructor(m, type) { super(m, type); this.attackT = 0; this.angerT = 0; this.angryAt = null; this.persistent = true; this.playerMade = false; }
  get eyeH() { return 2.3; }
  registerGoals() {
    this.goals.add(1, new MeleeAttackGoal(this, 1, true));
    this.goals.add(5, new StrollGoal(this, 0.6, 120));
    this.goals.add(7, new LookAtPlayerGoal(this, 6));
    this.goals.add(8, new LookAroundGoal(this));
    this.targets.add(2, new DefendSelfGoal(this));
    this.targets.add(3, new AngerTargetGoal(this));
    this.targets.add(3, new GolemTargetGoal(this));
  }
  walkValue(x, y, z) { return 0; }
  wantsToAttack() { return true; }
  onHurt(amount, source) {
    super.onHurt(amount, source);
    const a = source.attacker;
    if (a && a !== this) { this.angryAt = a; this.angerT = 400 + RI(380); }
  }
  aiStep() {
    if (this.attackT > 0) this.attackT--;
    if (this.angerT > 0 && --this.angerT === 0) { if (this.target === this.angryAt) this.target = null; this.angryAt = null; }
    // the game's heavy walker: nothing pushes it about (knockback resistance does the rest)
    super.aiStep();
  }
  doHurtTarget(t) {
    this.attackT = 10;
    const base = this.attackDamage;
    const dmg = base / 2 + RI(Math.floor(base));
    let ok;
    if (t.isPlayer) {
      ok = this.m.hurtPlayer(dmg, { type: 'mob', attacker: this, x: this.pos.x, z: this.pos.z, yaw: this.yaw });
      if (ok) t.push(0, 0.4, 0);
    } else {
      ok = t.hurt(dmg, { type: 'mob', attacker: this, x: this.pos.x, z: this.pos.z });
      if (ok) t.vel.y += 0.4;
    }
    this.lastDamage = dmg;
    return ok;
  }
  interact(held) {
    if (held === 'iron_ingot' && this.health < this.maxHealth) {
      this.heal(25);
      return 'consume';
    }
    return false;
  }
  loot(drop) { drop('iron_ingot', between(3, 5)); drop('poppy', RI(3)); }
  // cracks as it loses health: under three quarters, a half, a quarter
  texName() {
    const f = this.health / this.maxHealth;
    return f < 0.25 ? 'iron_golem_crack3' : f < 0.5 ? 'iron_golem_crack2' : f < 0.75 ? 'iron_golem_crack1' : 'iron_golem';
  }
  anim(A, a) { A.golemAttack = this.attackT > 0 ? this.attackT - a : 0; }
  toJSON() { const o = super.toJSON(); if (this.playerMade) o.pm = 1; return o; }
  fromJSON(o) { super.fromJSON(o); this.playerMade = !!o.pm; }
}
register('iron_golem', IronGolem);

model('iron_golem', [
  { name: 'head', pivot: [0, -7, -2], boxes: [[-4, -12, -5.5, 8, 10, 8, 58, 0], [-1, -5, -7.5, 2, 4, 2, 90, 0]] },
  { name: 'body', pivot: [0, -7, 0], boxes: [[-9, -2, -6, 18, 12, 11, 0, 0], [-4.5, 10, -3, 9, 5, 6, 62, 24, 0.5]] },
  { name: 'rightArm', pivot: [0, -7, 0], boxes: [[-13, -2.5, -3, 4, 30, 6, 0, 24]] },
  { name: 'leftArm', pivot: [0, -7, 0], boxes: [[9, -2.5, -3, 4, 30, 6, 20, 24]] },
  { name: 'rightLeg', pivot: [-4, 11, 0], boxes: [[-3.5, -3, -3, 6, 16, 5, 98, 0]] },
  { name: 'leftLeg', pivot: [5, 11, 0], boxes: [[-3.5, -3, -3, 6, 16, 5, 40, 24]] },
], (m, P, A) => {
  const I = m.index;
  set(P, I.head, RY, A.yaw); set(P, I.head, RX, A.pitch);
  const s = A.amt, t = tri(A.walk, 13);
  set(P, I.rightLeg, RX, -1.5 * t * s); set(P, I.leftLeg, RX, 1.5 * t * s);
  if (A.golemAttack > 0) {
    const k = -2 + 1.5 * tri(A.golemAttack, 10);
    set(P, I.rightArm, RX, k); set(P, I.leftArm, RX, k);
  } else {
    set(P, I.rightArm, RX, (-0.2 + 1.5 * t) * s); set(P, I.leftArm, RX, (-0.2 - 1.5 * t) * s);
  }
});
/* iron, rivets, a heavy brow, vines up the legs and round the middle */
function paintGolem(p, cracks) {
  const iron = 0xd6d0c4, light = 0xe8e4da, dark = 0xaaa498, rust = 0x8c7a62, vine = 0x4a7a2a, vineD = 0x335a1c;
  const metal = (x, y, w, h, c = iron) => { p.fill(x, y, w, h, c, 0.05); p.speckle(x, y, w, h, light, 0.12, 0.02); p.speckle(x, y, w, h, dark, 0.14, 0.03); };
  p.clear(0, 0, 128, 64);
  // body (0,0) 18x12x11
  p.box(0, 0, 18, 12, 11, { all: (x, y, w, h) => metal(x, y, w, h) });
  // a plate seam across the chest and rivets
  p.fill(11, 11 + 5, 18, 1, dark, 0.04);
  for (const x of [13, 26]) { p.px(x, 13, light); p.px(x, 19, light); }
  p.fill(11, 11 + 9, 18, 3, 0xc8c2b6, 0.06);
  // vines over the shoulders and chest
  for (const [x, y] of [[12, 11], [13, 12], [13, 13], [14, 14], [12, 14], [27, 11], [27, 12], [26, 13], [28, 13], [27, 14], [27, 15], [35, 11], [36, 12], [36, 13], [44, 11], [45, 12], [46, 12], [52, 11], [53, 12], [53, 13]]) p.px(x, y, (x + y) % 3 ? vine : vineD);
  // waist (62,24) 9x5x6
  p.box(62, 24, 9, 5, 6, { all: (x, y, w, h) => metal(x, y, w, h, 0xc8c2b6) });
  for (const [x, y] of [[69, 30], [70, 31], [72, 32], [76, 30], [77, 31], [80, 33], [85, 31], [86, 32]]) p.px(x, y, vine);
  // head (58,0) 8x10x8: the face at (66,8)
  p.box(58, 0, 8, 10, 8, { all: (x, y, w, h) => metal(x, y, w, h) });
  const fx = 66, fy = 8;
  p.fill(fx, fy + 2, 8, 1, 0x8e887c, 0.03);                   // the brow
  p.fill(fx + 1, fy + 3, 2, 2, 0x3a2a20, 0.05); p.fill(fx + 5, fy + 3, 2, 2, 0x3a2a20, 0.05);
  p.px(fx + 1, fy + 4, 0x9a2a1e); p.px(fx + 6, fy + 4, 0x9a2a1e);   // the eyes' glow
  p.fill(fx + 2, fy + 7, 4, 1, dark, 0.04);                   // the mouth line
  p.fill(fx + 1, fy + 8, 6, 1, 0xc8c2b6, 0.04);
  p.fill(66, 0, 8, 8, 0xcac4b8, 0.05);                         // the top
  // nose (90,0) 2x4x2
  p.box(90, 0, 2, 4, 2, { all: (x, y, w, h) => metal(x, y, w, h, 0xccc6ba) });
  // arms (0,24) and (20,24) 4x30x6: plates, darker hands
  for (const u of [0, 20]) {
    p.box(u, 24, 4, 30, 6, { all: (x, y, w, h) => metal(x, y, w, h) });
    p.fill(u, 24 + 6 + 24, 20, 6, 0xb8b2a6, 0.05);            // the hands
    p.fill(u, 24 + 6 + 10, 20, 1, dark, 0.03);
    for (const [x, y] of [[1, 8], [2, 9], [2, 10], [3, 12], [7, 9], [8, 10], [8, 11], [9, 13]]) p.px(u + x, 24 + y, vine);
  }
  // legs (98,0) and (40,24) 6x16x5: vines climbing from the feet
  for (const [u, v] of [[98, 0], [40, 24]]) {
    p.box(u, v, 6, 16, 5, { all: (x, y, w, h) => metal(x, y, w, h) });
    p.fill(u, v + 5 + 13, 22, 3, 0xbab4a8, 0.05);
    for (let k = 0; k < 9; k++) p.px(u + 5 + (k % 3), v + 5 + 15 - k, k % 2 ? vine : vineD);
    for (let k = 0; k < 6; k++) p.px(u + 13 + (k % 2), v + 5 + 15 - k, vine);
  }
  p.speckle(0, 0, 128, 64, rust, 0.004);
  if (!cracks) return;
  // cracks: dark jagged lines, more of them as it is hurt
  const crack = [[14, 18, 1], [20, 14, 1], [33, 16, 1], [46, 20, 1], [68, 12, 1], [2, 40, 2], [24, 34, 2], [44, 36, 2], [104, 10, 2], [16, 26, 3], [70, 4, 3], [30, 4, 3], [8, 50, 3], [50, 30, 3], [112, 14, 3]];
  for (const [x, y, lvl] of crack) {
    if (lvl > cracks) continue;
    let cx = x, cy = y;
    for (let k = 0; k < 6; k++) { p.px(cx, cy, 0x4a4640); if (k % 2) p.px(cx + 1, cy, 0x6a665e); cx += Math.floor(p.r() * 3) - 1; cy += 1; }
  }
}
addArt('iron_golem', [128, 64], p => paintGolem(p, 0));
addArt('iron_golem_crack1', [128, 64], p => paintGolem(p, 1));
addArt('iron_golem_crack2', [128, 64], p => paintGolem(p, 2));
addArt('iron_golem_crack3', [128, 64], p => paintGolem(p, 3));

/* ---------------------------------------------------------------------------
   Horses, donkeys and mules.

   Horse: health 15-30 (15 + 0..7 + 0..8), speed 0.1125-0.3375 (a quarter
   of 0.45 plus three random thirds of 0.3), jump strength 0.4-1.0 (0.4 plus
   three random fifths), 1.3965 x 1.6. Donkey and mule: health 15-30, speed
   0.175, jump 0.5.

   Taming is by riding: mount it with an empty hand; each tick there is a
   1 in 50 chance it decides, and it is yours if a random 0-99 is under its
   temper, else the temper goes up by 5 and it throws you off. Food raises
   the temper too. Tamed, a saddle makes it go where you look: W and S
   (backwards at a quarter), A and D sideways at half, at its own speed.
   Hold Space to charge the jump bar and let go: full at half a second, then
   it slips back towards 80%; a jump of 90% or more is a full jump of
   (jump strength) blocks a tick upwards, which with jump strength 1 clears
   5.9 blocks.
--------------------------------------------------------------------------- */
const HORSE_COATS = ['white', 'creamy', 'chestnut', 'brown', 'black', 'gray', 'dark_brown'];
const HORSE_MARKS = ['none', 'white', 'white_field', 'white_dots', 'black_dots'];
// food: [heal, growth seconds, temper, breeds]
const HORSE_FOOD = {
  sugar: [1, 30, 3, 0], wheat: [2, 20, 3, 0], hay_block: [20, 180, 0, 0], apple: [3, 60, 3, 0], carrot: [3, 60, 3, 0],
  golden_carrot: [4, 60, 5, 1], golden_apple: [10, 240, 10, 1], enchanted_golden_apple: [10, 240, 10, 1],
};
let groupCoat = 0;
// the game's way of mixing two parents' numbers: their mean, spread by their difference and 30% of the range
function offspring(a, b, min, max) {
  a = Math.max(min, Math.min(max, a)); b = Math.max(min, Math.min(max, b));
  const spread = Math.abs(a - b) + 0.3 * (max - min);
  let v = (a + b) / 2 + spread * ((R() + R() + R()) / 3 - 0.5);
  if (v > max) v = 2 * max - v; else if (v < min) v = 2 * min - v;
  return v;
}
// an untamed horse with someone on it runs about, and sooner or later decides
class BuckGoal extends Goal {
  constructor(mob, speed) { super(mob, MOVE); this.speed = speed; }
  canUse() {
    const m = this.mob;
    if (m.tamed || !m.passengers.length) return false;
    const p = randomLandPos(m, 5, 4);
    if (!p) return false;
    this.p = p;
    return true;
  }
  start() { this.mob.nav.moveTo(this.p[0], this.p[1], this.p[2], this.speed, 0.5); }
  canContinue() { const m = this.mob; return !m.tamed && m.passengers.length > 0 && !m.nav.isDone(); }
  tick() {
    const m = this.mob;
    if (m.tamed || RI(50) !== 0) return;
    const rider = m.passengers[0];
    if (rider && rider.isPlayer) {
      if (m.maxTemper > 0 && RI(m.maxTemper) < m.temper) { m.tameHorse(); return; }
      m.temper = Math.min(m.maxTemper, m.temper + 5);
    }
    if (m.m.riding === m) m.m.dismount();
    m.rear();
  }
}
// two horses, a horse and a donkey (a mule), two donkeys
class HorseBreedGoal extends BreedGoal {
  canUse() {
    const m = this.mob;
    if (!m.inLove || !m.tamed) return false;
    this.mate = m.m.nearest(m, 8, e => e !== m && e.inLove > 0 && !e.dead && e.tamed && (e.type === m.type || (e.type === 'horse' && m.type === 'donkey') || (e.type === 'donkey' && m.type === 'horse')));
    return !!this.mate;
  }
  tick() {
    const m = this.mob, o = this.mate;
    if (o.type === m.type) return super.tick();
    m.lookAtEntity(o, 10, m.maxPitch());
    if (m.age % 4 === 0) m.nav.moveTo(o.pos.x, o.pos.y, o.pos.z, this.speed, 1);
    this.t++;
    if (this.t >= 60 && m.dist2(o.pos.x, o.pos.y, o.pos.z) < 9) breedAs(m, o, 'mule');
  }
}
// the manager's breed(), for a baby of another kind
function breedAs(a, b, type) {
  const M = a.m;
  if (a.inLove <= 0 || b.inLove <= 0) return;
  a.inLove = 0; b.inLove = 0; a.ageT = 6000; b.ageT = 6000;
  const baby = M.spawn(type, (a.pos.x + b.pos.x) / 2, a.pos.y, (a.pos.z + b.pos.z) / 2, { natural: false });
  if (!baby) return;
  baby.ageT = -24000;
  if (baby.inherit) baby.inherit(a, b);
  M.particles('heart', baby.pos.x, baby.pos.y + 0.6, baby.pos.z, 7, 0.6);
  const xp = 1 + RI(7);
  M.xpEarned += xp;
  if (M.hooks.giveXp) M.hooks.giveXp(xp, baby.pos.x, baby.pos.y, baby.pos.z);
}

export class AbstractHorse extends Animal {
  static W = 1.3965; static H = 1.6; static HEALTH = 15; static SPEED = 0.225; static SHADOW = 0.75; static SCALE = 1.1;
  static MODEL = 'horse'; static TEX = 'horse_brown'; static TAMABLE = true;
  static FOOD = Object.keys(HORSE_FOOD);
  constructor(m, type) {
    super(m, type);
    this.tamed = false; this.temper = 0; this.maxTemper = 100;
    this.saddled = false;
    this.jumpStrength = 0.7;
    this.rearT = 0; this.stand = 0; this.oStand = 0;
    this.eatT = 0; this.eat = 0; this.oEat = 0;
    this.tailT = 0;
    this.jumpHeld = 0; this.jumpPending = 0; this.jumpingNow = false; this.leftGround = false; this.jumpBar = 0;
  }
  get eyeH() { return this.h * 0.95; }
  registerGoals() {
    this.goals.add(0, new FloatGoal(this));
    this.goals.add(1, new PanicGoal(this, 1.2));
    this.goals.add(1, new BuckGoal(this, 1.2));
    this.goals.add(2, new HorseBreedGoal(this, 1));
    this.goals.add(4, new FollowParentGoal(this, 1));
    this.goals.add(6, new StrollGoal(this, 0.7));
    this.goals.add(7, new LookAtPlayerGoal(this, 6));
    this.goals.add(8, new LookAroundGoal(this));
  }
  // the random numbers it is born with
  rollStats() {
    this.maxHealth = 15 + RI(8) + RI(9);
    this.speed = (0.45 + R() * 0.3 + R() * 0.3 + R() * 0.3) * 0.25;
    this.jumpStrength = 0.4 + R() * 0.2 + R() * 0.2 + R() * 0.2;
  }
  finalizeSpawn() { this.rollStats(); this.health = this.maxHealth; }
  inherit(a, b) {
    this.maxHealth = Math.round(offspring(a.maxHealth, b.maxHealth, 15, 30)); this.health = this.maxHealth;
    this.speed = offspring(a.speed, b.speed, 0.1125, 0.3375);
    this.jumpStrength = offspring(a.jumpStrength, b.jumpStrength, 0.4, 1);
  }
  tameHorse() {
    this.tamed = true; this.persistent = true; this.temper = this.maxTemper;
    this.m.particles('heart', this.pos.x, this.pos.y + this.h * 0.8, this.pos.z, 7, this.w * 0.5);
  }
  rear() { this.rearT = 20; this.nav.stop(); }
  // food: heals, grows a foal, raises the temper, puts a tamed adult in the mood
  eatFood(f) {
    const [heal, grow, temper, breeds] = f;
    let ate = false;
    if (this.health < this.maxHealth && heal > 0) { this.heal(heal); ate = true; }
    if (this.ageT < 0 && grow > 0) { this.ageT = Math.min(0, this.ageT + grow * 20); ate = true; this.m.particles('sparkle', this.pos.x, this.pos.y + this.h, this.pos.z, 4, 0.5); }
    if (temper > 0 && (ate || !this.tamed) && this.temper < this.maxTemper) { this.temper = Math.min(this.maxTemper, this.temper + temper); ate = true; }
    if (breeds && this.tamed && this.ageT === 0 && !this.inLove) { this.inLove = 600; ate = true; }
    if (ate) this.eatT = Math.max(this.eatT, 20);
    return ate;
  }
  canSaddle() { return this.tamed && this.ageT >= 0 && !this.saddled; }
  // horse armour: on a tamed adult horse or zombie horse only (not donkeys, mules or skeleton horses)
  canWearArmor() { return this.tamed && this.ageT >= 0 && (this.type === 'horse' || this.type === 'zombie_horse'); }
  // a donkey's or mule's chest, hung on its sides
  chestLayer(out) { if (this.chest && (this.type === 'donkey' || this.type === 'mule')) out.push(['donkey_chest', 'donkey_chest', null]); }
  setBody(st) {
    this.body = st;
    const a = st && HORSE_ARMOR[itemNameOf(st.id).replace(/_horse_armor$/, '')];
    this.armor = a ? a[0] : 0; this.toughness = a ? a[1] : 0;
  }
  // a donkey, mule or llama carries a chest (15 slots; a llama 3 a point of strength)
  canCarryChest() { return /^(donkey|mule|llama|trader_llama)$/.test(this.type); }
  chestSize() { return this.type === 'llama' || this.type === 'trader_llama' ? 3 * (this.strength || 3) : 15; }
  setChest(on) { this.chest = on; this.chestSlots = on ? (this.chestSlots && this.chestSlots.length === this.chestSize() ? this.chestSlots : new Array(this.chestSize()).fill(null)) : null; }
  // its screen's parts (ui/containers.js MountScreen): saddle, armour (or carpet), the chest's slots
  mountSlots() {
    const kinds = [], box = [];
    if (this.type !== 'llama' && this.type !== 'trader_llama') { kinds.push('saddle'); box.push(this.saddled ? { id: itemIdOf('saddle'), count: 1 } : null); }
    if (this.canWearArmor()) { kinds.push('armor'); box.push(this.body || null); }
    if (this.type === 'llama' || this.type === 'trader_llama') { kinds.push('carpet'); box.push(this.decor && this.decor !== 'trader' ? { id: itemIdOf(this.decor + '_carpet'), count: 1 } : null); }
    if (this.chest && this.chestSlots) for (const s of this.chestSlots) { kinds.push('chest'); box.push(s); }
    return { kinds, box, cols: this.chest && this.chestSlots ? this.chestSlots.length / 3 : 0 };
  }
  mountChanged(i, st) {
    const k = this.mountSlots().kinds[i];
    if (k === 'saddle') this.saddled = !!st;
    else if (k === 'armor') this.setBody(st || null);
    else if (k === 'carpet') this.decor = st ? itemNameOf(st.id).replace(/_carpet$/, '') : null;
    else if (k === 'chest') this.chestSlots[i - this.mountSlots().kinds.indexOf('chest')] = st || null;
  }
  openInventory() {
    const H = this.m.hooks && this.m.hooks.hands;
    if (!this.tamed || !H || !H.open) return false;
    H.open(new MountScreen(H.inv, H.icons, this));
    return true;
  }
  interact(held, player) {
    // sneaking: a tamed one's screen
    if (this.tamed && player && player.sneaking && player.sneaking() && this.openInventory()) return 'swing';
    if (this.passengers.length) return false;
    const f = HORSE_FOOD[held];
    if (f) return this.eatFood(f) ? 'consume' : 'swing';
    if (this.ageT < 0) return false;
    if (held === 'chest' && this.tamed && this.canCarryChest() && !this.chest) { this.setChest(true); return 'consume'; }
    if (!this.tamed) {
      if (held) { this.rear(); return 'swing'; }      // anything in hand but food: it rears
      this.m.mount(this);
      return 'swing';
    }
    if (held === 'saddle' && this.canSaddle()) { this.saddled = true; return 'consume'; }
    if (/_horse_armor$/.test(held || '') && this.canWearArmor() && !this.body) { this.setBody(withCountOf(heldStack(this.m), 1)); return 'consume'; }
    // shears take off the armour, then the saddle (1.21.5 on)
    if (held === 'shears' && (this.body || this.saddled)) {
      if (this.body) { dropStack(this, this.body); this.setBody(null); } else { this.saddled = false; dropStack(this, { id: itemIdOf('saddle'), count: 1 }); }
      return 'damage';
    }
    this.m.mount(this);
    return 'swing';
  }
  onMounted() { this.nav.stop(); this.jumpHeld = 0; this.jumpPending = 0; }
  // the seat: on the saddle, the rider's hips on its back
  ridingOffset() { return (21.5 / 16) * this.constructor.SCALE - 0.75 + 0.06; }
  /* ridden, tamed and saddled: the rider steers */
  rideControl(keys, rider) {
    if (!this.tamed) return false;
    this.jumping = false;
    if (!this.saddled) { this.zza = 0; this.xxa = 0; this.moveSpeedNow = 0; return true; }
    this.yaw = rider.yaw; this.pitch = 0;
    let f = (keys.w ? 1 : 0) - (keys.s ? 1 : 0), s = ((keys.a ? 1 : 0) - (keys.d ? 1 : 0)) * 0.5;
    if (f <= 0) f *= 0.25;
    // landing ends a jump
    if (this.jumpingNow && !this.onGround) this.leftGround = true;
    if (this.jumpingNow && this.leftGround && this.onGround) { this.jumpingNow = false; this.leftGround = false; }
    // the jump bar: fills over ten ticks, then slips back towards 80%
    if (keys[' ']) { if (this.onGround || this.jumpHeld > 0) this.jumpHeld++; }
    else if (this.jumpHeld > 0) {
      const t = this.jumpHeld, sc = t < 10 ? t * 0.1 : 0.8 + 2 / (t - 9) * 0.1, pw = Math.floor(sc * 100);
      this.jumpHeld = 0;
      if (pw > 0) { this.jumpPending = pw >= 90 ? 1 : 0.4 + 0.4 * pw / 90; this.rearT = Math.max(this.rearT, 4); }
    }
    this.jumpBar = this.jumpHeld > 0 ? (this.jumpHeld < 10 ? this.jumpHeld * 0.1 : 0.8 + 2 / (this.jumpHeld - 9) * 0.1) : 0;
    if (this.onGround && this.jumpPending === 0 && this.rearT > 0 && !this.jumpingNow) { f = 0; s = 0; }
    if (this.onGround && this.jumpPending > 0 && !this.jumpingNow) {
      this.vel.y = this.jumpStrength * this.jumpPending;
      if (f > 0) { this.vel.x += -0.4 * Math.sin(this.yaw) * this.jumpPending; this.vel.z += -0.4 * Math.cos(this.yaw) * this.jumpPending; }
      this.jumpingNow = true; this.leftGround = false; this.onGround = false;
      this.jumpPending = 0;
    }
    this.moveSpeedNow = this.speed;
    this.zza = f; this.xxa = s;
    return true;
  }
  // horses take half the fall damage, the rider none here
  landed(dist) {
    const n = Math.ceil(dist * 0.5 - 3);
    if (n > 0) this.hurt(n, { type: 'fall' });
  }
  aiStep() {
    super.aiStep();
    if (this.dead) return;
    // standing up on the hind legs, grazing, swishing the tail
    this.oStand = this.stand; this.oEat = this.eat;
    if (this.rearT > 0) this.rearT--;
    this.stand = this.rearT > 0 ? this.stand + (1 - this.stand) * 0.4 + 0.05 : this.stand - ((1 - this.stand) * 0.4 + 0.05) * 0.8;
    this.stand = Math.max(0, Math.min(1, this.stand));
    if (this.eatT > 0) this.eatT--;
    else if (!this.passengers.length && this.onGround && this.nav.isDone() && RI(300) === 0 && this.m.t.get(Math.floor(this.pos.x), Math.floor(this.pos.y - 0.5), Math.floor(this.pos.z)) === B.grass_block) { this.eatT = 30 + RI(30); }
    this.eat += ((this.eatT > 0 ? 1 : 0) - this.eat) * 0.3;
    if (this.eatT > 0 && !this.passengers.length) this.stopMoving();
    if (this.tailT > 0) this.tailT--; else if (RI(200) === 0) this.tailT = 8;
    // a horse heals a point now and then on its own
    if (RI(900) === 0) this.heal(1);
  }
  anim(A, a) {
    A.stand = this.oStand + (this.stand - this.oStand) * a;
    A.eat = this.oEat + (this.eat - this.oEat) * a;
    A.swish = this.tailT > 0;
  }
  layers(out) {
    this.chestLayer(out);
    if (this.body) { const mat = itemNameOf(this.body.id).replace(/_horse_armor$/, ''); out.push(['horse_armor', 'horse_armor_' + mat, mat === 'leather' ? (this.body.color !== undefined ? this.body.color : 0xA06540) : null, !!this.body.ench]); }
    if (this.saddled) out.push([this.passengers.length ? 'horse_saddle_reins' : 'horse_saddle', 'horse_saddle', null]);
  }
  loot(drop, byPlayer, L) {
    drop('leather', RI(3) + looted(L)); if (this.saddled) drop('saddle', 1); if (this.body) { dropStack(this, this.body); this.body = null; }
    if (this.chest && this.type !== 'llama' && this.type !== 'trader_llama') drop('chest', 1);
    if (this.chestSlots) { for (const s of this.chestSlots) if (s) dropStack(this, s); this.chestSlots = null; }
  }
  get xp() { return this.ageT < 0 ? 0 : 1 + RI(3); }
  toJSON() {
    const o = super.toJSON();
    o.st = [r4(this.maxHealth), r4(this.speed), r4(this.jumpStrength)];
    if (this.tamed) o.tm = 1; if (this.temper) o.tp = this.temper; if (this.saddled) o.sad = 1;
    if (this.body) o.body = stackToJSON(this.body);
    if (this.chest) { o.chest = 1; if (this.chestSlots) o.cs = this.chestSlots.map(s => (s ? stackToJSON(s) : null)); }
    return o;
  }
  fromJSON(o) {
    if (o.st) { this.maxHealth = o.st[0]; this.speed = o.st[1]; this.jumpStrength = o.st[2]; }
    super.fromJSON(o);
    this.tamed = !!o.tm; this.temper = o.tp || 0; this.saddled = !!o.sad;
    if (o.body) this.setBody(stackFromJSON(o.body));
    if (o.chest || o.ch) { this.setChest(true); if (Array.isArray(o.cs)) o.cs.forEach((a, i) => { if (i < this.chestSlots.length) this.chestSlots[i] = a ? stackFromJSON(a) : null; }); }
  }
}
const r4 = v => Math.round(v * 10000) / 10000;

export class Horse extends AbstractHorse {
  constructor(m, type) { super(m, type); this.coat = 'brown'; this.marks = 'none'; }
  finalizeSpawn(o) {
    super.finalizeSpawn(o);
    // a herd shares its coat; markings are each its own
    if (!o || !o.group) groupCoat = RI(7);
    this.coat = HORSE_COATS[groupCoat]; this.marks = HORSE_MARKS[RI(5)];
  }
  inherit(a, b) {
    super.inherit(a, b);
    // the coat from one parent (or, now and then, at random); the markings likewise
    const r = RI(9);
    this.coat = r < 4 ? a.coat : r < 8 ? b.coat : HORSE_COATS[RI(7)];
    const q = RI(5);
    this.marks = q < 2 ? a.marks : q < 4 ? b.marks : HORSE_MARKS[RI(5)];
  }
  texName() { return 'horse_' + this.coat; }
  layers(out) {
    if (this.marks !== 'none') out.push(['horse', 'horse_mark_' + this.marks, null]);
    super.layers(out);
  }
  toJSON() { const o = super.toJSON(); o.coat = this.coat; o.mk = this.marks; return o; }
  fromJSON(o) { super.fromJSON(o); this.coat = o.coat || 'brown'; this.marks = o.mk || 'none'; }
}
register('horse', Horse);

export class Donkey extends AbstractHorse {
  static H = 1.5; static SCALE = 0.87; static MODEL = 'donkey'; static TEX = 'donkey';
  rollStats() { this.maxHealth = 15 + RI(8) + RI(9); this.speed = 0.175; this.jumpStrength = 0.5; }
  inherit(a, b) { this.maxHealth = Math.round(offspring(a.maxHealth, b.maxHealth, 15, 30)); this.health = this.maxHealth; this.speed = 0.175; this.jumpStrength = 0.5; }
}
register('donkey', Donkey);
export class Mule extends Donkey {
  static H = 1.6; static SCALE = 0.92; static MODEL = 'donkey'; static TEX = 'mule';
  // mules cannot breed
  eatFood(f) { return super.eatFood([f[0], f[1], f[2], 0]); }
}
register('mule', Mule);

/* ---- the horse's shape: one part list for every horse, donkey and mule
   (so the saddle and the markings sit on the same bones) ---- */
function horseParts(kind) {
  const L = kind === 'saddle' || kind === 'reins';
  const ears = kind === 'donkey'
    ? [[[-1, -7, -0.5, 2, 7, 1, 26, 13]], [[-1, -7, -0.5, 2, 7, 1, 26, 13, 0, true]]]
    : [[[-1, -3, -0.5, 2, 3, 1, 19, 16]], [[-1, -3, -0.5, 2, 3, 1, 19, 16, 0, true]]];
  const leg = (x, z) => [[x, -1.01, z, 4, 11, 4, 48, 21]];
  return [
    { name: 'body', pivot: [0, 11, 5], boxes: L ? [[-5, -9, -9, 10, 7, 9, 0, 0, 0.3], [-6, -3.5, -5.5, 1, 2, 2, 38, 0], [5, -3.5, -5.5, 1, 2, 2, 38, 0]] : [[-5, -8, -17, 10, 10, 22, 0, 32, 0.05]] },
    { name: 'tail', parent: 'body', pivot: [0, -5, 2], rot: [PI / 6, 0, 0], boxes: L ? [] : [[-1.5, 0, 0, 3, 14, 4, 42, 36]] },
    { name: 'neck', pivot: [0, 4, -12], rot: [PI / 6, 0, 0], boxes: L ? (kind === 'reins' ? [[3.1, -6, -8, 0, 3, 16, 0, 40], [-3.1, -6, -8, 0, 3, 16, 0, 40]] : [])
      : [[-2.05, -6, -2, 4, 12, 7, 0, 35], [-1, -11, 5.01, 2, 16, 2, 56, 36]] },
    { name: 'head', parent: 'neck', pivot: [0, 0, 0], boxes: L ? [[-3, -11, -2, 6, 5, 7, 0, 13, 0.2], [-2, -11, -7, 4, 5, 5, 0, 25, 0.2], [2, -9, -6, 1, 2, 2, 30, 0], [-3, -9, -6, 1, 2, 2, 30, 0]]
      : [[-3, -11, -2, 6, 5, 7, 0, 13], [-2, -11, -7, 4, 5, 5, 0, 25]] },
    { name: 'leftEar', parent: 'head', pivot: [1.55, -11, 4.5], rot: [0, 0, kind === 'donkey' ? PI / 12 : 0], boxes: L ? [] : ears[0] },
    { name: 'rightEar', parent: 'head', pivot: [-1.55, -11, 4.5], rot: [0, 0, kind === 'donkey' ? -PI / 12 : 0], boxes: L ? [] : ears[1] },
    { name: 'leftHind', pivot: [4, 14, 7], boxes: L ? [] : leg(-3, -1) },
    { name: 'rightHind', pivot: [-4, 14, 7], boxes: L ? [] : leg(-1, -1) },
    { name: 'leftFront', pivot: [4, 14, -10], boxes: L ? [] : leg(-3, -1.9) },
    { name: 'rightFront', pivot: [-4, 14, -10], boxes: L ? [] : leg(-1, -1.9) },
  ];
}
function horseAnim(m, P, A) {
  const I = m.index, st = A.stand || 0, eat = A.eat || 0, ns = 1 - st, calm = 1 - Math.max(st, eat);
  const w = A.walk * 0.6662, s = A.amt;
  const yaw = Math.max(-20 * DEG, Math.min(20 * DEG, A.yaw));
  // the neck: forward and up, following the look; down to the grass to graze; up and back when rearing
  set(P, I.neck, RX, calm * (PI / 6 + A.pitch) + st * (PI / 12 + A.pitch) + eat * (2.18 + Math.sin(A.age * 0.5) * 0.05));
  set(P, I.neck, RY, (1 - eat) * yaw);
  set(P, I.neck, 1, 4 * (1 - st) - 6 * st + eat * 7);
  set(P, I.neck, 2, -12 * (1 - st) - 2 * st);
  // rearing: the body tips up about its back, front legs pawing the air
  set(P, I.body, RX, -PI / 4 * st);
  const paw = Math.cos(A.age * 0.6 + PI);
  const f8 = Math.cos(w + PI), f9 = f8 * 0.8 * s;
  set(P, I.leftHind, RX, PI / 12 * st - f8 * 0.5 * s * ns);
  set(P, I.rightHind, RX, PI / 12 * st + f8 * 0.5 * s * ns);
  set(P, I.leftFront, RX, (-PI / 3 + paw) * st + f9 * ns);
  set(P, I.rightFront, RX, (-PI / 3 - paw) * st - f9 * ns);
  for (const k of ['leftFront', 'rightFront']) { set(P, I[k], 1, 2.5 * st + 14 * ns); set(P, I[k], 2, -7.7 * st - 10 * ns); }
  // the tail lifts at a gallop and swishes now and then
  set(P, I.tail, RX, PI / 6 + s * 0.75);
  set(P, I.tail, RY, A.swish ? Math.cos(A.age * 0.7) : 0);
}
model('horse', horseParts('horse'), horseAnim);
model('donkey', horseParts('donkey'), horseAnim);
model('horse_saddle', horseParts('saddle'), horseAnim);
model('horse_saddle_reins', horseParts('reins'), horseAnim);
// a donkey's or mule's chest: one on each side of the body, 8 long, 8 high, 3 thick (the game's)
model('donkey_chest', horseParts('donkey').map(p => Object.assign({}, p, { boxes: p.name === 'body' ? [[5, -8, -6, 3, 8, 8, 0, 0], [-8, -8, -6, 3, 8, 8, 0, 0, 0, true]] : [] })), horseAnim);
addArt('donkey_chest', [64, 64], p => {
  p.clear(0, 0, 64, 64);
  p.box(0, 0, 3, 8, 8, { all: 0x9a6a2c, top: 0xa8763a }, 0.08);
  p.fill(0, 8 + 3, 22, 1, 0x4a3214);
  p.fill(8 + 3 - 1, 8 + 3, 2, 2, 0xc8c8c8, 0.03);
});
// horse armour: the horse's shape a tenth of a pixel out, without the tail or the mane
model('horse_armor', horseParts('horse').map(p => Object.assign({}, p, { boxes: p.name === 'tail' ? [] : p.boxes.filter(b => !(p.name === 'neck' && b[4] === 16)).map(b => { const c = b.slice(); while (c.length < 11) c.push(0); c[8] = (c[8] || 0) + 0.1; c[9] = !!c[9]; c[10] = 1; return c; }) })), horseAnim);

/* ---- horse coats: the base colour dappled, a darker (or paler) mane and tail ---- */
const COATS = {
  white: { base: 0xeae6de, dark: 0xc8c4bc, mane: 0xb8b4ac, hoof: 0x6a645c, nose: 0x8a7a72 },
  creamy: { base: 0xc8a06a, dark: 0xb08a58, mane: 0xe6d4b0, hoof: 0x4a3a2a, nose: 0x5a4636 },
  chestnut: { base: 0xa45e30, dark: 0x8a4c26, mane: 0x6a3418, hoof: 0x3a2a1e, nose: 0x3e2a1e },
  brown: { base: 0x6e4628, dark: 0x5a381e, mane: 0x241a14, hoof: 0x2a1e16, nose: 0x241a14 },
  black: { base: 0x2a2626, dark: 0x1e1a1a, mane: 0x121010, hoof: 0x141212, nose: 0x0e0c0c },
  gray: { base: 0x8e8a86, dark: 0x76726e, mane: 0x4a4644, hoof: 0x302c2a, nose: 0x3a3634 },
  dark_brown: { base: 0x3e2a1c, dark: 0x302016, mane: 0x141010, hoof: 0x18120e, nose: 0x120e0c },
  donkey: { base: 0x8a7a68, dark: 0x6e6050, mane: 0x3a3028, hoof: 0x2a2420, nose: 0xc8bcae, belly: 0xb4a898 },
  mule: { base: 0x4e3424, dark: 0x3e281a, mane: 0x1e1610, hoof: 0x1a1410, nose: 0x8a6a52, belly: 0x6a4e3a },
};
function paintHorse(p, c, donkey) {
  const hide = (x, y, w, h, col, dapple = 0.12) => { p.fill(x, y, w, h, col, 0.05); p.speckle(x, y, w, h, p.shade(col, 0.88), dapple, 0.03); p.speckle(x, y, w, h, p.shade(col, 1.1), dapple * 0.6, 0.03); };
  const hair = (x, y, w, h, col) => { p.fill(x, y, w, h, col, 0.06); for (let i = 0; i < w; i++) if (p.r() < 0.4) p.fill(x + i, y, 1, h, p.shade(col, 0.85 + p.r() * 0.3), 0.04); };
  p.clear(0, 0, 64, 64);
  // body (0,32) 10x10x22
  p.box(0, 32, 10, 10, 22, { all: (x, y, w, h) => hide(x, y, w, h, c.base) });
  hide(22, 32, 10, 22, c.dark, 0.1);                           // along the back
  if (c.belly) { hide(32, 32, 10, 22, c.belly); p.fill(0, 61, 22, 3, c.belly, 0.05); p.fill(32, 61, 22, 3, c.belly, 0.05); }
  if (donkey) { p.fill(26, 32, 2, 22, c.mane, 0.06); for (const x of [0, 32]) p.fill(x + 5, 54, 2, 5, c.mane, 0.06); }   // the dark stripe down the back, and over the shoulders
  // neck (0,35) 4x12x7 and the mane (56,36) 2x16x2
  p.box(0, 35, 4, 12, 7, { all: (x, y, w, h) => hide(x, y, w, h, c.base) });
  p.fill(18, 42, 4, 12, c.mane, 0.06);                          // the mane side of the neck (its back)
  p.box(56, 36, 2, 16, 2, { all: (x, y, w, h) => hair(x, y, w, h, c.mane) });
  // head (0,13) 6x5x7 and muzzle (0,25) 4x5x5; eyes on the sides near the front
  p.box(0, 13, 6, 5, 7, { all: (x, y, w, h) => hide(x, y, w, h, c.base, 0.08) });
  p.box(0, 25, 4, 5, 5, { all: (x, y, w, h) => hide(x, y, w, h, c.base, 0.06) });
  for (const [ex, ey] of [[5, 21], [14, 21]]) { p.px(ex, ey, 0x141010); p.px(ex + (ex < 10 ? 1 : -1), ey, 0x2e2622); p.px(ex, ey - 1, p.shade(c.base, 0.75)); }
  p.fill(5, 30, 4, 5, c.nose, 0.06);                            // the muzzle's end
  p.fill(0, 33, 18, 2, c.nose, 0.06);
  p.px(5, 31, 0x141010); p.px(8, 31, 0x141010);                 // nostrils
  p.fill(9, 25, 4, 5, p.shade(c.nose, 0.9), 0.05);              // under the chin
  if (donkey) { p.fill(5, 25, 4, 5, c.nose, 0.06); p.fill(0, 30, 18, 5, c.nose, 0.06); p.px(5, 31, 0x141010); p.px(8, 31, 0x141010); }
  // ears
  if (donkey) { p.box(26, 13, 2, 7, 1, { all: (x, y, w, h) => hide(x, y, w, h, c.base) }); p.fill(27, 14, 2, 7, p.shade(c.dark, 0.7), 0.05); p.fill(27, 14, 2, 2, c.mane, 0.05); }
  else { p.box(19, 16, 2, 3, 1, { all: (x, y, w, h) => hide(x, y, w, h, c.base) }); p.fill(20, 17, 2, 3, p.shade(c.base, 0.7), 0.05); }
  // tail (42,36) 3x14x4
  p.box(42, 36, 3, 14, 4, { all: (x, y, w, h) => hair(x, y, w, h, c.mane) });
  // legs (48,21) 4x11x4: hooves at the bottom
  p.box(48, 21, 4, 11, 4, { all: (x, y, w, h) => hide(x, y, w, h, c.base, 0.08) });
  p.fill(48, 33, 16, 3, c.hoof, 0.06);
  p.fill(56, 21, 4, 4, c.hoof, 0.05);
  if (donkey) p.fill(48, 30, 16, 3, p.shade(c.base, 1.15), 0.05);
}
for (const k of HORSE_COATS) addArt('horse_' + k, [64, 64], p => paintHorse(p, COATS[k], false));
addArt('donkey', [64, 64], p => paintHorse(p, COATS.donkey, true));
addArt('mule', [64, 64], p => paintHorse(p, COATS.mule, true));
// markings, drawn over the coat on the same shape
function paintMarks(p, kind) {
  p.clear(0, 0, 64, 64);
  const W = 0xf2f0ea, K = 0x16120e;
  const dots = (x, y, w, h, n, col) => { for (let i = 0; i < n; i++) { const dx = x + Math.floor(p.r() * (w - 1)), dy = y + Math.floor(p.r() * (h - 1)); p.fill(dx, dy, 2, 1 + (p.r() < 0.5 ? 1 : 0), col, 0.03); } };
  if (kind === 'white') {
    p.fill(48, 30, 16, 6, W, 0.03);                             // socks
    p.fill(7, 13, 2, 7, W, 0.03); p.fill(5, 25, 4, 5, W, 0.03); p.fill(5, 30, 4, 2, W, 0.03);   // a blaze down the face
    p.fill(8, 20, 2, 5, W, 0.03);
  } else if (kind === 'white_field') {
    for (const [x, y, w, h] of [[22, 34, 10, 8], [24, 46, 8, 6], [2, 55, 12, 6], [34, 55, 12, 6], [54, 54, 10, 7], [7, 36, 4, 6], [1, 44, 6, 6], [12, 44, 6, 6], [48, 25, 16, 11]]) { p.fill(x, y, w, h, W, 0.03); }
    for (const [x, y, w, h] of [[1, 54, 2, 2], [14, 58, 3, 2], [33, 60, 2, 2], [46, 56, 3, 3], [21, 40, 2, 3]]) p.fill(x, y, w, h, W, 0.03);
  } else if (kind === 'white_dots') {
    dots(22, 32, 10, 22, 22, W); dots(0, 54, 22, 10, 14, W); dots(32, 54, 22, 10, 14, W); dots(54, 54, 10, 10, 8, W);
    dots(48, 25, 16, 8, 8, W); dots(0, 42, 22, 12, 6, W);
  } else if (kind === 'black_dots') {
    dots(22, 32, 10, 22, 18, K); dots(0, 54, 22, 10, 12, K); dots(32, 54, 22, 10, 12, K); dots(54, 54, 10, 10, 6, K);
    dots(48, 25, 16, 8, 6, K); dots(0, 42, 22, 12, 5, K);
  }
}
for (const k of HORSE_MARKS) if (k !== 'none') addArt('horse_mark_' + k, [64, 64], p => paintMarks(p, k));
/* horse armour, our own pictures on the horse's shape: plates over the
   body, neck, head and the tops of the legs, the eyes and hooves left bare
   (leather is drawn pale and takes its dye as a tint) */
const HORSE_ARMOR = { leather: [3, 0], copper: [4, 0], iron: [5, 0], golden: [7, 0], diamond: [11, 2], netherite: [19, 3] };
const ARMOR_RGB = { leather: 0xe8e4dc, copper: 0xc4744e, iron: 0xd0d0d0, golden: 0xf2d34a, diamond: 0x62dccc, netherite: 0x4c4648 };
for (const mat in HORSE_ARMOR) addArt('horse_armor_' + mat, [64, 64], p => {
  const c = ARMOR_RGB[mat], line = p.shade(c, 0.72), lit = p.shade(c, 1.12);
  const plate = (x, y, w, h) => { p.fill(x, y, w, h, c, 0.05); for (let j = 3; j < h; j += 5) p.fill(x, y + j, w, 1, line, 0.03); p.fill(x, y, w, 1, lit, 0.03); };
  p.clear(0, 0, 64, 64);
  p.box(0, 32, 10, 10, 22, { all: plate });                     // the body
  p.box(0, 35, 4, 12, 7, { all: plate });                       // the neck
  p.box(0, 13, 6, 5, 7, { all: plate });                        // the head
  p.box(0, 25, 4, 5, 5, { all: plate });                        // the muzzle
  for (const [ex, ey] of [[5, 21], [14, 21]]) { p.clear(ex - 1, ey - 1, 3, 2); }
  p.fill(48, 25, 16, 5, c, 0.05); p.fill(48, 25, 16, 1, lit, 0.03);   // the tops of the legs
  if (mat === 'diamond' || mat === 'golden' || mat === 'copper') for (const [x, y] of [[4, 44], [26, 44], [12, 58], [40, 58], [8, 16], [2, 40]]) p.px(x, y, lit);
});
// the saddle and bridle: dark leather, a lighter seat, iron rings and stirrups
addArt('horse_saddle', [64, 64], p => {
  p.clear(0, 0, 64, 64);
  const lea = 0x6a3e1e, dark = 0x4a2a12, seat = 0x8a5630, iron = 0xb4b4b4;
  // the saddle box (0,0) 10x7x9: the seat on top, flaps down the sides, no underside
  p.box(0, 0, 10, 7, 9, { all: lea, top: (x, y, w, h) => { p.fill(x, y, w, h, seat, 0.08); p.fill(x, y, w, 1, dark); p.fill(x, y + h - 1, w, 1, dark); } }, 0.08);
  p.clear(19, 0, 10, 9);
  p.fill(0, 9, 38, 1, dark);
  p.fill(0, 15, 38, 1, dark);
  // stirrups (38,0) and bit rings (30,0), 1x2x2
  p.box(38, 0, 1, 2, 2, iron, 0.05);
  p.box(30, 0, 1, 2, 2, iron, 0.05);
  // the bridle over the head (0,13) and muzzle (0,25): straps only
  p.clear(0, 13, 32, 24);
  p.fill(0, 21, 26, 1, dark);                                   // round the head, behind the eyes
  p.fill(7, 13, 1, 7, dark); p.fill(12, 13, 1, 7, dark);
  p.fill(0, 31, 18, 1, dark);                                   // round the muzzle
  p.fill(5, 25, 4, 1, dark);
  // reins (0,40): two flat straps, 16 long and 3 deep (only their side faces show)
  p.fill(0, 56, 32, 3, dark, 0.05);
  p.fill(0, 56, 32, 1, lea);
});

/* ---------------------------------------------------------------------------
   Cat: 10 health, speed 0.3, 3 damage, 0.6 x 0.7 (drawn at 0.8). A stray
   keeps 16 blocks from you unless you hold raw cod or salmon; feed it one
   and there is a 1 in 3 chance it is yours (it sits). Tamed: right click to
   sit or stand, it follows from 10 blocks (stopping 5 off), comes in a jump
   from 12, eats fish to heal. Strays hunt rabbits. Creepers keep away.
--------------------------------------------------------------------------- */
const CAT_COATS = ['tabby', 'black', 'red', 'siamese', 'british_shorthair', 'calico', 'persian', 'ragdoll', 'white', 'jellie', 'all_black'];
const CAT_FOOD = { cod: 2, salmon: 2 };
// keeping away from the player (strays): run off within dist, faster when close
class AvoidPlayerGoal extends Goal {
  constructor(mob, dist, walk, sprint, when) { super(mob, MOVE); this.dist = dist; this.walk = walk; this.sprint = sprint; this.when = when; }
  canUse() {
    const m = this.mob, p = m.m.player;
    if (!p.alive() || p.creative() || (this.when && !this.when())) return false;
    if (m.dist2(p.pos.x, p.pos.y, p.pos.z) > this.dist * this.dist) return false;
    const to = posAway(m, 16, 7, p.pos);
    if (!to) return false;
    if (p.dist2(to[0], to[1], to[2]) < m.dist2(p.pos.x, p.pos.y, p.pos.z)) return false;
    this.p = to;
    return true;
  }
  start() { this.mob.nav.moveTo(this.p[0], this.p[1], this.p[2], this.walk, 0.5); this.mob.fleeing = true; }
  canContinue() { return !this.mob.nav.isDone() && (!this.when || this.when()); }
  stop() { this.mob.fleeing = false; }
  tick() { const m = this.mob, p = m.m.player; m.nav.speed = m.dist2(p.pos.x, p.pos.y, p.pos.z) < 49 ? this.sprint : this.walk; }
}
export class Cat extends Tamable {
  static W = 0.6; static H = 0.7; static HEALTH = 10; static SPEED = 0.3; static ATTACK = 3; static FOLLOW = 16;
  static MODEL = 'cat'; static TEX = 'cat_tabby'; static SHADOW = 0.4; static SCALE = 0.8; static TAMABLE = true; static SAFE_FALL = 0;
  static FOOD = Object.keys(CAT_FOOD);
  constructor(m, type) { super(m, type); this.coat = 'tabby'; this.collar = 'red'; }
  get eyeH() { return 0.35; }
  registerGoals() {
    this.goals.add(1, new FloatGoal(this));
    this.goals.add(1, new FirePanicGoal(this, 1.5));
    this.goals.add(2, new SitGoal(this));
    this.goals.add(3, new TemptGoal(this, 0.6, Object.keys(CAT_FOOD)));
    this.goals.add(4, new AvoidPlayerGoal(this, 16, 0.8, 1.33, () => !this.tamed));
    this.goals.add(6, new FollowOwnerGoal(this, 1, 10, 5));
    this.goals.add(8, new LeapGoal(this, 0.3));
    this.goals.add(9, new MeleeAttackGoal(this, 1, true));
    this.goals.add(10, new BreedGoal(this, 0.8));
    this.goals.add(11, new StrollGoal(this, 0.8));
    this.goals.add(12, new LookAtPlayerGoal(this, 10));
    this.targets.add(1, new PreyTargetGoal(this, e => e.type === 'rabbit'));
    this.targets.add(2, new DefendSelfGoal(this));
  }
  finalizeSpawn() { this.coat = CAT_COATS[RI(10)]; }
  texName() { return 'cat_' + this.coat; }
  interact(held) {
    const food = CAT_FOOD[held];
    if (this.tamed) {
      if (food !== undefined && this.health < this.maxHealth) { this.heal(food); return 'consume'; }
      if (held && held.endsWith('_dye')) {
        const c = held.slice(0, -4);
        if (DYES.indexOf(c) >= 0 && c !== this.collar) { this.collar = c; return 'consume'; }
      }
      if (food !== undefined && this.feed()) return 'consume';
      this.toggleSit();
      return 'swing';
    }
    if (food !== undefined) {
      if (RI(3) === 0) { this.tame(); this.ordered = true; }
      else this.tameFailed();
      return 'consume';
    }
    return false;
  }
  inherit(a, b) { super.inherit(a, b); this.coat = (R() < 0.5 ? a : b).coat || 'tabby'; }
  anim(A) {
    // creeping up on food, low to the ground; running flat out from you
    A.crouch = !this.sitting && this.goals.list.some(g => g.running && g instanceof TemptGoal);
    A.sprint = !this.sitting && (this.fleeing || (this.target && this.aggressive)) && this.walkAmt > 0.6;
  }
  layers(out) { if (this.tamed) out.push(['cat_collar', 'cat_collar', DYE_RGB[this.collar] || DYE_RGB.red]); }
  loot(drop, byPlayer, L) { drop('string', RI(3) + looted(L)); }
  get xp() { return this.ageT < 0 ? 0 : 1 + RI(3); }
  toJSON() { const o = super.toJSON(); o.coat = this.coat; if (this.collar !== 'red') o.col = this.collar; return o; }
  fromJSON(o) { super.fromJSON(o); this.coat = o.coat || 'tabby'; this.collar = o.col || 'red'; }
}
register('cat', Cat);

const catParts = collar => [
  { name: 'head', pivot: [0, 15, -9], boxes: collar ? [] : [[-2.5, -2, -3, 5, 4, 5, 0, 0], [-1.5, -0.02, -4, 3, 2, 2, 0, 24], [-2, -3, 0, 1, 1, 2, 0, 10], [1, -3, 0, 1, 1, 2, 6, 10]] },
  { name: 'body', pivot: [0, 12, -10], rot: [PI / 2, 0, 0], boxes: collar ? [[-2, 3, -8, 4, 16, 6, 20, 0, 0.05, false, 1]] : [[-2, 3, -8, 4, 16, 6, 20, 0]] },
  { name: 'tail1', pivot: [0, 15, 8], rot: [0.9, 0, 0], boxes: collar ? [] : [[-0.5, 0, 0, 1, 8, 1, 0, 15]] },
  { name: 'tail2', parent: 'tail1', pivot: [0, 8, 0], rot: [0.83, 0, 0], boxes: collar ? [] : [[-0.5, 0, 0, 1, 8, 1, 4, 15]] },
  { name: 'leftHind', pivot: [1.1, 18, 5], boxes: collar ? [] : [[-1, 0, 1, 2, 6, 2, 8, 13]] },
  { name: 'rightHind', pivot: [-1.1, 18, 5], boxes: collar ? [] : [[-1, 0, 1, 2, 6, 2, 8, 13]] },
  { name: 'leftFront', pivot: [1.2, 14.1, -5], boxes: collar ? [] : [[-1, 0, 0, 2, 10, 2, 40, 0]] },
  { name: 'rightFront', pivot: [-1.2, 14.1, -5], boxes: collar ? [] : [[-1, 0, 0, 2, 10, 2, 40, 0]] },
];
function catAnim(m, P, A) {
  const I = m.index;
  set(P, I.head, RX, A.pitch); set(P, I.head, RY, A.yaw);
  const w = A.walk * 0.6662, s = A.amt;
  if (A.sitting) {
    // sitting up: the body tipped back onto the haunches, front legs straight, the tail round on the ground
    set(P, I.body, 1, 5); set(P, I.body, 2, -4); set(P, I.body, RX, PI / 4);
    set(P, I.head, 1, 9.5); set(P, I.head, 2, -6.5);
    set(P, I.tail1, 1, 22.5); set(P, I.tail1, 2, 7); set(P, I.tail1, RX, 1.7278761);
    set(P, I.tail2, RX, 0.94);
    for (const k of ['leftFront', 'rightFront']) { set(P, I[k], 1, 14); set(P, I[k], 2, -6); set(P, I[k], RX, -0.15707964); }
    for (const k of ['leftHind', 'rightHind']) { set(P, I[k], 1, 21); set(P, I[k], 2, 3); set(P, I[k], RX, -PI / 2); }
    return;
  }
  if (A.crouch) { add(P, I.body, 1, 1); add(P, I.head, 1, 2); add(P, I.tail1, 1, 1); set(P, I.tail1, RX, PI / 2); set(P, I.tail2, RX, 0); }
  if (A.sprint) {
    // the bound: front legs together, back legs together
    set(P, I.leftHind, RX, Math.cos(w) * s); set(P, I.rightHind, RX, Math.cos(w + 0.3) * s);
    set(P, I.leftFront, RX, Math.cos(w + PI) * s); set(P, I.rightFront, RX, Math.cos(w + PI + 0.3) * s);
    set(P, I.tail2, RX, 0.83 + PI / 10 * Math.cos(w) * s);
  } else {
    set(P, I.leftHind, RX, Math.cos(w) * s); set(P, I.rightHind, RX, Math.cos(w + PI) * s);
    set(P, I.leftFront, RX, Math.cos(w + PI) * s); set(P, I.rightFront, RX, Math.cos(w) * s);
    if (!A.crouch) set(P, I.tail2, RX, 0.83 + PI / 4 * Math.cos(w) * s);
  }
}
model('cat', catParts(false), catAnim);
model('cat_collar', catParts(true), catAnim);

/* ---- cat coats ---- */
const CAT_ART = {
  tabby: { base: 0x8e7c62, belly: 0xc2b294, stripe: 0x4e4232, eye: 0x7ab840 },
  black: { base: 0x1e1c22, belly: 0xeeeeea, eye: 0x9ac440, tux: true },
  red: { base: 0xd8883e, belly: 0xeec08a, stripe: 0xa85a22, eye: 0xd8b830 },
  siamese: { base: 0xeadfca, belly: 0xf4ecdc, point: 0x4a3426, eye: 0x4a8ad8 },
  british_shorthair: { base: 0x8a8e98, belly: 0x9a9ea8, eye: 0xe0a030 },
  calico: { base: 0xf0ece4, belly: 0xf8f6f0, patch: 0xd07a30, patch2: 0x2a2626, eye: 0x7ab840 },
  persian: { base: 0xe4cca4, belly: 0xf0dec0, eye: 0xd09a30, fluff: 0xd2b88e },
  ragdoll: { base: 0xf2eee6, belly: 0xfaf8f2, point: 0x7a6656, eye: 0x4a8ad8 },
  white: { base: 0xf4f4f2, belly: 0xfcfcfa, eye: 0x6ab0e0 },
  jellie: { base: 0x8a8a8a, belly: 0xeeeeea, patch2: 0x2e2e30, eye: 0x7ab840, tux: true },
  all_black: { base: 0x161418, belly: 0x1e1c20, eye: 0xd8c830 },
};
function paintCat(p, c) {
  const fur = (x, y, w, h, col) => { p.fill(x, y, w, h, col, 0.06); p.speckle(x, y, w, h, p.shade(col, 0.88), 0.15, 0.03); };
  p.clear(0, 0, 64, 32);
  // head (0,0) 5x4x5, nose (0,24), ears (0,10) and (6,10)
  p.box(0, 0, 5, 4, 5, { all: (x, y, w, h) => fur(x, y, w, h, c.base) });
  p.box(0, 24, 3, 2, 2, { all: (x, y, w, h) => fur(x, y, w, h, c.tux ? c.belly : c.point || c.belly) });
  p.box(0, 10, 1, 1, 2, { all: (x, y, w, h) => fur(x, y, w, h, c.point || c.base) });
  p.box(6, 10, 1, 1, 2, { all: (x, y, w, h) => fur(x, y, w, h, c.point || c.base) });
  // body (20,0) 4x16x6, turned up: front face the belly, back face its back
  p.box(20, 0, 4, 16, 6, { all: (x, y, w, h) => fur(x, y, w, h, c.base) });
  fur(26, 6, 4, 16, c.belly);
  fur(24, 6, 2, 16, c.belly); fur(30, 6, 2, 16, c.belly);
  // tail (0,15), (4,15); legs: hind (8,13), front (40,0)
  p.box(0, 15, 1, 8, 1, { all: (x, y, w, h) => fur(x, y, w, h, c.base) });
  p.box(4, 15, 1, 8, 1, { all: (x, y, w, h) => fur(x, y, w, h, c.point || c.base) });
  p.box(8, 13, 2, 6, 2, { all: (x, y, w, h) => fur(x, y, w, h, c.base) });
  p.box(40, 0, 2, 10, 2, { all: (x, y, w, h) => fur(x, y, w, h, c.base) });
  if (c.stripe) {
    for (let y = 7; y < 22; y += 3) { p.fill(36, y, 4, 1, c.stripe, 0.06); p.fill(20, y, 3, 1, c.stripe); p.fill(33, y, 3, 1, c.stripe); }
    p.px(6, 5, c.stripe); p.px(8, 5, c.stripe); p.px(7, 0, c.stripe); p.px(7, 2, c.stripe);
    for (let y = 16; y < 24; y += 2) p.fill(0, y, 8, 1, c.stripe);
    for (let y = 3; y < 12; y += 3) p.fill(40, y, 8, 1, c.stripe);
  }
  if (c.point) {
    // dark face, ears, paws and tail tip
    p.fill(5, 5, 5, 4, c.point, 0.06); p.fill(6, 5, 3, 1, p.shade(c.point, 1.6), 0.04);
    p.fill(40, 9, 8, 3, c.point, 0.05); p.fill(8, 18, 8, 3, c.point, 0.05);
    p.fill(4, 16, 4, 8, c.point, 0.05);
  }
  if (c.tux) {
    // a white chest, muzzle and paws
    p.fill(6, 7, 3, 2, c.belly, 0.04); p.fill(40, 9, 8, 3, c.belly, 0.04); p.fill(8, 18, 8, 3, c.belly, 0.04);
    p.fill(26, 6, 4, 6, c.belly, 0.04);
  }
  if (c.patch) for (const [x, y, w, h, k] of [[36, 7, 4, 4, 1], [36, 14, 4, 5, 2], [20, 9, 3, 4, 1], [31, 15, 4, 4, 2], [5, 0, 3, 3, 1], [11, 5, 3, 2, 2], [0, 18, 4, 3, 1]]) p.fill(x, y, w, h, k === 1 ? c.patch : c.patch2, 0.05);
  if (c.patch2 && !c.patch) for (const [x, y, w, h] of [[36, 8, 4, 5], [33, 12, 3, 4], [20, 15, 3, 3], [5, 0, 5, 2], [0, 15, 8, 4]]) p.fill(x, y, w, h, c.patch2, 0.05);
  if (c.fluff) p.speckle(0, 0, 48, 24, c.fluff, 0.18, 0.04);
  // the face: eyes with slit pupils, a pink nose
  const fx = 5, fy = 5;
  p.px(fx + 1, fy + 1, c.eye); p.px(fx + 3, fy + 1, c.eye);
  p.px(fx + 1, fy + 2, p.shade(c.eye, 0.55)); p.px(fx + 3, fy + 2, p.shade(c.eye, 0.55));
  p.px(3, 26, 0xd88a90);
  p.fill(2, 27, 3, 1, p.shade(c.tux ? c.belly : c.point || c.belly, 0.85));
  p.px(2, 12, 0xd8a0a0); p.px(8, 12, 0xd8a0a0);                // pink inside the ears
}
for (const k of CAT_COATS) addArt('cat_' + k, [64, 32], p => paintCat(p, CAT_ART[k]));
addArt('cat_collar', [64, 32], p => { p.clear(0, 0, 64, 32); p.fill(20, 6, 20, 1, 0xf0f0f0, 0.04); p.px(27, 7, 0xe0c040); });

/* ---------------------------------------------------------------------------
   Rabbit: 3 health, speed 0.3, 0.4 x 0.5. It only moves by hopping: a hop of
   0.2 (walking) or 0.3 upwards, 0.5 up a step, then a pause on landing (10
   ticks, 2 when fleeing). Runs from players (8 blocks), wolves (10) and
   monsters (4) at 2.2 times its speed, comes for carrots, golden carrots and
   dandelions, raids carrot crops. Drops 0-1 hide, 0-1 raw rabbit, and a
   rabbit's foot one time in ten. Coats by where it was born.
--------------------------------------------------------------------------- */
const RABBIT_COATS = ['brown', 'white', 'black', 'white_splotched', 'gold', 'salt'];
class RaidGardenGoal extends Goal {
  constructor(mob) { super(mob, MOVE | LOOK); }
  canUse() {
    const m = this.mob;
    if (m.carrotT > 0 || m.ageT < 0 || RI(20) !== 0) return false;
    const T = m.m.t, x0 = Math.floor(m.pos.x), y0 = Math.floor(m.pos.y), z0 = Math.floor(m.pos.z);
    let best = null, bd = 1e9;
    for (let dy = -1; dy <= 1; dy++) for (let dz = -8; dz <= 8; dz++) for (let dx = -8; dx <= 8; dx++) {
      if (T.get(x0 + dx, y0 + dy, z0 + dz) !== B.carrots) continue;
      const d = dx * dx + dz * dz + dy * dy;
      if (d < bd) { bd = d; best = [x0 + dx, y0 + dy, z0 + dz]; }
    }
    if (!best) return false;
    this.c = best;
    return m.nav.moveTo(best[0] + 0.5, best[1], best[2] + 0.5, 0.7, 0.5);
  }
  canContinue() { return this.t > 0 && this.mob.m.t.get(this.c[0], this.c[1], this.c[2]) === B.carrots; }
  start() { this.t = 200; }
  tick() {
    const m = this.mob, [x, y, z] = this.c;
    this.t--;
    m.lookAt(x + 0.5, y + 0.2, z + 0.5, 10, m.maxPitch());
    if ((x + 0.5 - m.pos.x) ** 2 + (z + 0.5 - m.pos.z) ** 2 < 0.8 && Math.abs(y - m.pos.y) < 1) {
      const meta = m.m.t.meta(x, y, z);
      if (meta > 0) m.m.world.set(x, y, z, B.carrots, meta - 1); else m.m.world.set(x, y, z, 0, 0);
      m.m.particles('poof', x + 0.5, y + 0.3, z + 0.5, 4, 0.3, [0.9, 0.55, 0.15]);
      m.carrotT = 40; this.t = 0;
    } else if (m.nav.isDone()) m.nav.moveTo(x + 0.5, y, z + 0.5, 0.7, 0.5);
  }
}
export class Rabbit extends Animal {
  static W = 0.4; static H = 0.5; static HEALTH = 3; static SPEED = 0.3; static PANIC = 2.2;
  static MODEL = 'rabbit'; static TEX = 'rabbit_brown'; static SHADOW = 0.3; static SCALE = 0.6; static BABY_HEAD = 1.3;
  static FOOD = ['carrot', 'golden_carrot', 'dandelion'];
  constructor(m, type) { super(m, type); this.coat = 'brown'; this.hopT = 0; this.hopDur = 0; this.hopCool = 0; this.carrotT = 0; }
  get eyeH() { return 0.35; }
  static checkSpawn(S, x, y, z) {
    const T = S.m.t, b = T.get(x, y - 1, z);
    return (b === B.grass_block || b === B.snow_block || b === B.sand || b === B.snow || T.get(x, y, z) === B.snow) && S.brightEnough(x, y, z) && S.onGround(Rabbit, x, y, z);
  }
  registerGoals() {
    this.goals.add(1, new FloatGoal(this));
    this.goals.add(1, new PanicGoal(this, 2.2));
    this.goals.add(2, new BreedGoal(this, 0.8));
    this.goals.add(3, new TemptGoal(this, 1, Rabbit.FOOD));
    this.goals.add(4, new AvoidPlayerGoal(this, 8, 2.2, 2.2));
    this.goals.add(4, new AvoidGoal(this, e => e.type === 'wolf' && !e.dead, 10, 2.2, 2.2));
    this.goals.add(4, new AvoidGoal(this, e => e.constructor.HOSTILE && !e.dead && this.dist2(e.pos.x, e.pos.y, e.pos.z) < 16, 4, 2.2, 2.2));
    this.goals.add(5, new RaidGardenGoal(this));
    this.goals.add(6, new StrollGoal(this, 0.6));
    this.goals.add(11, new LookAtPlayerGoal(this, 10));
  }
  finalizeSpawn() {
    const b = this.m.spawner ? this.m.spawner.biome(Math.floor(this.pos.x), Math.floor(this.pos.z)) : 'plains';
    const i = RI(100);
    if (b === 'desert') this.coat = 'gold';
    else if (/snowy|ice_spikes|frozen|grove/.test(b)) this.coat = i < 80 ? 'white' : 'white_splotched';
    else this.coat = i < 50 ? 'brown' : i < 90 ? 'salt' : 'black';
  }
  texName() { return 'rabbit_' + this.coat; }
  inherit(a, b) { this.coat = (R() < 0.5 ? a : b).coat; }
  /* hopping: the move control turns it and says how fast; on the ground it
     stands until the next hop, which carries it */
  moveControl() {
    // in the air it keeps the way it took off (it turns to the next point on the ground,
    // before it hops, as the game's faces its next path point), so a hop never flies on
    // sideways while it has already turned to whatever comes after
    const y0 = this.yaw;
    super.moveControl();
    if (!this.onGround && !this.inWater) this.yaw = y0;
    const want = this.zza > 0 || this.mcOp === 3;
    if (this.onGround) {
      if (this.hopT > 0 && this.hopT >= this.hopDur) { this.hopT = 0; }
      if (want && this.hopCool <= 0) {
        const mod = this.mcSpeed || 1;
        let up = mod <= 0.6 ? 0.2 : 0.3;
        if (this.mcOp === 3 || this.hCollide) up = 0.5;
        this.vel.y = up;
        let h = (this.speed * mod) * (this.speed * mod);
        if (h < 0.1) h += 0.1;
        this.vel.x += -Math.sin(this.yaw) * h; this.vel.z += -Math.cos(this.yaw) * h;
        this.onGround = false;
        this.hopT = 1; this.hopDur = up >= 0.3 ? 10 : 7;
        this.hopCool = mod < 2.2 ? 10 : 2;
      }
      this.zza = 0; this.jumping = false; this.mcOp = 0;
    } else this.zza = 0;
  }
  aiStep() {
    super.aiStep();
    if (this.hopT > 0 && this.hopT < this.hopDur) this.hopT++;
    if (this.onGround && this.hopCool > 0 && this.hopT === 0) this.hopCool--;
    else if (this.onGround && this.hopT >= this.hopDur) { this.hopT = 0; }
    if (this.carrotT > 0) this.carrotT--;
  }
  anim(A, a) { A.hop = this.hopT > 0 ? Math.min(1, (this.hopT + a) / this.hopDur) : 0; }
  loot(drop, byPlayer, L) {
    drop('rabbit_hide', RI(2) + looted(L));
    drop(this.fire > 0 ? 'cooked_rabbit' : 'rabbit', RI(2) + looted(L));
    if (byPlayer && R() < 0.1 + 0.03 * L) drop('rabbit_foot', 1);
  }
  toJSON() { const o = super.toJSON(); o.coat = this.coat; return o; }
  fromJSON(o) { super.fromJSON(o); this.coat = o.coat || 'brown'; }
}
register('rabbit', Rabbit);

model('rabbit', [
  { name: 'body', pivot: [0, 19, 8], rot: [-0.34906584, 0, 0], boxes: [[-3, -2, -10, 6, 5, 10, 0, 0]] },
  { name: 'head', pivot: [0, 16, -1], boxes: [[-2.5, -4, -5, 5, 4, 5, 32, 0], [-0.5, -2.5, -5.5, 1, 1, 1, 32, 9]] },
  { name: 'rightEar', parent: 'head', pivot: [0, 0, 0], rot: [0, -0.2617994, 0], boxes: [[-2.5, -9, -1, 2, 5, 1, 52, 0]] },
  { name: 'leftEar', parent: 'head', pivot: [0, 0, 0], rot: [0, 0.2617994, 0], boxes: [[0.5, -9, -1, 2, 5, 1, 58, 0]] },
  { name: 'tail', pivot: [0, 20, 7], rot: [-0.3490659, 0, 0], boxes: [[-1.5, -1.5, 0, 3, 3, 2, 52, 6]] },
  { name: 'leftHaunch', pivot: [3, 17.5, 3.7], rot: [-0.34906584, 0, 0], boxes: [[-1, 0, 0, 2, 4, 5, 30, 15]] },
  { name: 'rightHaunch', pivot: [-3, 17.5, 3.7], rot: [-0.34906584, 0, 0], boxes: [[-1, 0, 0, 2, 4, 5, 16, 15]] },
  { name: 'leftFoot', pivot: [3, 17.5, 3.7], boxes: [[-1, 5.5, -3.7, 2, 1, 7, 26, 24]] },
  { name: 'rightFoot', pivot: [-3, 17.5, 3.7], boxes: [[-1, 5.5, -3.7, 2, 1, 7, 8, 24]] },
  { name: 'leftFront', pivot: [3, 17, -1], rot: [-0.19198622, 0, 0], boxes: [[-1, 0, -1, 2, 7, 2, 8, 15]] },
  { name: 'rightFront', pivot: [-3, 17, -1], rot: [-0.19198622, 0, 0], boxes: [[-1, 0, -1, 2, 7, 2, 0, 15]] },
], (m, P, A) => {
  const I = m.index;
  set(P, I.head, RX, A.pitch); set(P, I.head, RY, A.yaw);
  // the hop: haunches and feet kick back, front legs reach forward
  const f = Math.sin((A.hop || 0) * PI);
  set(P, I.leftHaunch, RX, (f * 50 - 21) * DEG); set(P, I.rightHaunch, RX, (f * 50 - 21) * DEG);
  set(P, I.leftFoot, RX, f * 50 * DEG); set(P, I.rightFoot, RX, f * 50 * DEG);
  set(P, I.leftFront, RX, (f * -40 - 11) * DEG); set(P, I.rightFront, RX, (f * -40 - 11) * DEG);
});
const RABBIT_ART = {
  brown: { base: 0x8a6a4a, belly: 0xb89a78, ear: 0x6a5038, eye: 0x1a1210 },
  white: { base: 0xf0f0ee, belly: 0xfafaf8, ear: 0xe8c8c8, eye: 0xb02a2a },
  black: { base: 0x2c2a2a, belly: 0x3e3a3a, ear: 0x222020, eye: 0x6a2a20 },
  white_splotched: { base: 0xf0f0ee, belly: 0xfafaf8, ear: 0x2a2828, eye: 0x1a1210, splotch: 0x2a2828 },
  gold: { base: 0xd8b878, belly: 0xeed8a8, ear: 0xc09858, eye: 0x1a1210 },
  salt: { base: 0x7e7672, belly: 0xa8a29e, ear: 0x5e5854, eye: 0x1a1210, salt: 0xe8e4e0 },
};
function paintRabbit(p, c) {
  const fur = (x, y, w, h, col) => { p.fill(x, y, w, h, col, 0.06); p.speckle(x, y, w, h, p.shade(col, 0.88), 0.15, 0.03); };
  p.clear(0, 0, 64, 32);
  p.box(0, 0, 6, 5, 10, { all: (x, y, w, h) => fur(x, y, w, h, c.base) });          // body
  fur(26, 0, 6, 10, c.belly);                                                         // its underside
  p.box(32, 0, 5, 4, 5, { all: (x, y, w, h) => fur(x, y, w, h, c.base) });          // head
  p.box(52, 0, 2, 5, 1, { all: (x, y, w, h) => fur(x, y, w, h, c.base) });          // ears
  p.box(58, 0, 2, 5, 1, { all: (x, y, w, h) => fur(x, y, w, h, c.base) });
  p.fill(53, 1, 2, 5, c.ear, 0.05); p.fill(59, 1, 2, 5, c.ear, 0.05);
  p.box(52, 6, 3, 3, 2, { all: (x, y, w, h) => fur(x, y, w, h, 0xf2f2f0) });        // the white tail
  p.box(32, 9, 1, 1, 1, 0xd88a90);                                                    // nose
  p.box(8, 15, 2, 7, 2, { all: (x, y, w, h) => fur(x, y, w, h, c.base) });          // front legs
  p.box(0, 15, 2, 7, 2, { all: (x, y, w, h) => fur(x, y, w, h, c.base) });
  p.box(30, 15, 2, 4, 5, { all: (x, y, w, h) => fur(x, y, w, h, c.base) });         // haunches
  p.box(16, 15, 2, 4, 5, { all: (x, y, w, h) => fur(x, y, w, h, c.base) });
  p.box(26, 24, 2, 1, 7, { all: (x, y, w, h) => fur(x, y, w, h, c.belly) });        // feet
  p.box(8, 24, 2, 1, 7, { all: (x, y, w, h) => fur(x, y, w, h, c.belly) });
  // the face (37,5): eyes high on the sides of the head
  p.px(37, 6, c.eye); p.px(41, 6, c.eye);
  p.px(32 + 2, 5 + 1, c.eye); p.px(42 + 2, 5 + 1, c.eye);
  p.fill(38, 7, 3, 2, c.belly, 0.04);
  if (c.splotch) for (const [x, y, w, h] of [[10, 2, 4, 4], [16, 10, 5, 4], [2, 11, 4, 3], [33, 5, 3, 3], [38, 1, 3, 2], [27, 11, 3, 3]]) p.fill(x, y, w, h, c.splotch, 0.05);
  if (c.salt) p.speckle(0, 0, 64, 32, c.salt, 0.12, 0.03);
}
for (const k of RABBIT_COATS) addArt('rabbit_' + k, [64, 32], p => paintRabbit(p, RABBIT_ART[k]));

/* ---------------------------------------------------------------------------
   Mooshroom: a cow (10 health, speed 0.2) in red, with red mushrooms on its
   back and head; shears take them off (five red mushrooms) and leave a
   plain cow; a bowl gets mushroom stew, a bucket milk. Mushroom fields only.
--------------------------------------------------------------------------- */
/* Mooshroom: red, or brown (Minecraft Wiki, Mooshroom). Lightning turns a red one brown and a brown one
   red (and does not hurt it); a calf takes a parent's colour, the other colour one time in 1024 when both
   parents are the same; shearing a brown one gives brown mushrooms. A brown one fed a small flower
   gives suspicious stew with that flower's effect the next time it is milked with a bowl. */
export class Mooshroom extends Cow {
  static TEX = 'mooshroom';
  constructor(m, type) { super(m, type); this.variant = 'red'; this.stew = null; }
  texName() { return this.variant === 'brown' ? 'mooshroom_brown' : 'mooshroom'; }
  sound(ev) {
    const S = typeof window !== 'undefined' && window.__lc2sound && window.__lc2sound.Sound;
    if (S) try { S.play(ev, this.pos.x, this.pos.y + this.h * 0.5, this.pos.z, 2, 1, 'neutral'); } catch (e) { /* no sound */ }
  }
  thunderHit() {
    this.variant = this.variant === 'brown' ? 'red' : 'brown';
    this.sound('entity.mooshroom.convert');
    return false;
  }
  inherit(a, b) {
    const va = a.variant || 'red', vb = b.variant || 'red';
    this.variant = va === vb && RI(1024) === 0 ? (va === 'brown' ? 'red' : 'brown') : RI(2) ? va : vb;
  }
  toJSON() { const o = super.toJSON(); if (this.variant === 'brown') o.vr = 'brown'; if (this.stew) o.se = this.stew; return o; }
  fromJSON(o) { super.fromJSON(o); this.variant = o.vr === 'brown' ? 'brown' : 'red'; this.stew = Array.isArray(o.se) ? o.se.slice(0, 2) : null; }
  static checkSpawn(S, x, y, z) { return S.m.t.get(x, y - 1, z) === B.mycelium && S.brightEnough(x, y, z) && S.onGround(Mooshroom, x, y, z); }
  walkValue(x, y, z) { return this.m.t.get(x, y - 1, z) === B.mycelium ? 10 : this.m.brightness(x, y, z) - 0.5; }
  interact(held, player) {
    if (held === 'shears' && this.ageT >= 0) {
      const c = this.m.spawn('cow', this.pos.x, this.pos.y, this.pos.z, { natural: false, yaw: this.yaw });
      if (c) { c.health = this.health; c.bodyYaw = c.headYaw = this.bodyYaw; c.persistent = true; }
      this.m.particles('explosion', this.pos.x, this.pos.y + this.h * 0.5, this.pos.z, 1, 0);
      this.m.dropAt(this, this.variant === 'brown' ? 'brown_mushroom' : 'red_mushroom', 5);
      this.remove();
      return 'damage';
    }
    if (held === 'bowl' && this.ageT >= 0) {
      const P = this.m.P, H = this.m.hooks.hands, D = H && H.drops, id = itemIdOf('suspicious_stew');
      if (this.stew && D && D.spawn && id) {
        D.spawn(P.pos.x, P.pos.y + 0.5, P.pos.z, { id, count: 1, stew: this.stew.slice() });
        this.stew = null;
        this.sound('entity.mooshroom.suspicious_milk');
      } else { this.m.dropItemAt(P.pos.x, P.pos.y + 0.5, P.pos.z, 'mushroom_stew', 1, false, true); this.sound('entity.mooshroom.milk'); }
      return 'consume';
    }
    // a small flower to a brown one: its effect, kept for the next bowl (smoke if it already has one)
    if (this.variant === 'brown' && held && STEW_EFFECTS[held]) {
      if (this.stew) { this.m.particles('smoke', this.pos.x, this.pos.y + this.h * 0.5, this.pos.z, 2, 0.3); return 'swing'; }
      this.stew = STEW_EFFECTS[held].slice();
      this.m.particles('magic', this.pos.x, this.pos.y + this.h * 0.5, this.pos.z, 4, 0.3);
      this.sound('entity.mooshroom.eat');
      return 'consume';
    }
    return super.interact(held, player);
  }
  layers(out) { if (this.ageT >= 0) out.push(['mooshroom_shrooms', this.variant === 'brown' ? 'mooshroom_shrooms_brown' : 'mooshroom_shrooms', null]); }
}
register('mooshroom', Mooshroom);
// the mushrooms: on the cow's bones (head, body), each a stalk and a cap
const shroom = (x, y, z, up) => up === 'z'
  ? [[x - 0.5, y - 0.5, z, 1, 1, 2, 0, 0], [x - 1.5, y - 1.5, z + 2, 3, 3, 2, 8, 0]]
  : [[x - 0.5, y - 2, z - 0.5, 1, 2, 1, 0, 0], [x - 1.5, y - 4, z - 1.5, 3, 2, 3, 8, 0]];
model('mooshroom_shrooms', [
  { name: 'head', pivot: [0, 4, -8], boxes: shroom(0, -4, -3, 'y') },
  { name: 'body', pivot: [0, 5, 2], rot: [PI / 2, 0, 0], boxes: [...shroom(-2, -4, 3, 'z'), ...shroom(3, 1, 3, 'z'), ...shroom(-1, 5, 3, 'z')] },
], (m, P, A) => { const I = m.index; set(P, I.head, RY, A.yaw); set(P, I.head, RX, A.pitch); });
addArt('mooshroom_shrooms', [64, 32], p => {
  p.clear(0, 0, 64, 32);
  p.box(0, 0, 1, 2, 1, 0xe8dcc8, 0.05);                      // stalk
  p.box(8, 0, 3, 2, 3, { all: 0xc82a22, bottom: 0xe0c8b0 }, 0.08);   // the red cap, white spots
  for (const [x, y] of [[11, 0], [13, 2], [12, 1], [8, 4], [12, 4], [16, 3], [18, 4], [10, 4]]) p.px(x, y, 0xf4f0ea);
});
// a brown one's: plain brown caps
addArt('mooshroom_shrooms_brown', [64, 32], p => {
  p.clear(0, 0, 64, 32);
  p.box(0, 0, 1, 2, 1, 0xe8dcc8, 0.05);
  p.box(8, 0, 3, 2, 3, { all: 0x9a7356, bottom: 0xd8c4a8 }, 0.08);
});
// the mooshroom's coat: deep red, pale patches, a light muzzle
const mooshroomCoat = (red, pale, dark) => p => {
  p.box(0, 0, 8, 8, 6, red, 0.08);
  const fx = 6, fy = 6;
  p.fill(fx + 2, fy + 5, 4, 3, pale, 0.04);
  p.fill(fx + 2, fy + 6, 4, 2, 0xc8a8a0, 0.05);
  p.px(fx + 3, fy + 7, 0x5a2a24); p.px(fx + 4, fy + 7, 0x5a2a24);
  p.px(fx + 0, fy + 3, 0x101010); p.px(fx + 1, fy + 3, 0xffffff);
  p.px(fx + 6, fy + 3, 0xffffff); p.px(fx + 7, fy + 3, 0x101010);
  p.box(22, 0, 1, 3, 1, 0xd8d0c0, 0.05);
  p.box(18, 4, 12, 18, 10, red, 0.08);
  for (const [x, y, w, h] of [[20, 16, 5, 4], [34, 20, 6, 5], [44, 15, 4, 6], [52, 24, 5, 4], [24, 28, 6, 3], [40, 8, 4, 3]]) { p.fill(x, y, w, h, pale, 0.04); p.speckle(x - 1, y - 1, w + 2, h + 2, pale, 0.3, 0.04); }
  p.speckle(18, 4, 44, 28, dark, 0.07);
  p.box(52, 0, 4, 6, 1, 0xe2a8a8, 0.06);
  p.box(0, 16, 4, 12, 4, red, 0.08);
  p.fill(0, 20 + 4, 16, 3, pale, 0.04);
  p.fill(0, 20 + 10, 16, 2, 0x26201a, 0.06);
};
addArt('mooshroom', [64, 32], mooshroomCoat(0xa4261e, 0xd8d0c8, 0x7a1a14));
// a brown one: a brown coat, the same pale patches
addArt('mooshroom_brown', [64, 32], mooshroomCoat(0x8a6a4c, 0xd8d0c8, 0x6a4e36));

/* ---------------------------------------------------------------------------
   Fox: 10 health, speed 0.3, 2 damage, 0.6 x 0.7. Sleeps through the day
   (curled up, eyes shut; you wake it by coming close unless you sneak),
   hunts at dusk and by night: chickens, rabbits and fish, crouching as it
   creeps up and pouncing from a few blocks off. Keeps away from you (16
   blocks), from wolves and polar bears. Sweet berries and glow berries to
   breed. Red in the taiga, white in the snow.
--------------------------------------------------------------------------- */
const FOX_PREY = new Set(['chicken', 'rabbit', 'cod', 'salmon', 'tropical_fish']);
class FoxSleepGoal extends Goal {
  constructor(mob) { super(mob, MOVE | LOOK | JUMP); }
  disturbed() {
    const m = this.mob, p = m.m.player;
    if (p.alive() && !p.creative() && !p.sneaking() && m.dist2(p.pos.x, p.pos.y, p.pos.z) < 36 && !m.trusts) return true;
    return !!m.m.nearest(m, 8, e => (e.type === 'wolf' || e.type === 'polar_bear') && !e.dead);
  }
  canUse() {
    const m = this.mob;
    if (!m.m.isDay() || m.target || m.lastHurtBy || !m.onGround || m.inWater || RI(140) !== 0) return false;
    return !this.disturbed();
  }
  canContinue() { const m = this.mob; return m.m.isDay() && !m.lastHurtBy && !m.target && !this.disturbed(); }
  start() { const m = this.mob; m.sleeping = true; m.nav.stop(); m.stopMoving(); }
  stop() { this.mob.sleeping = false; }
  tick() { this.mob.stopMoving(); }
}
// the fox's spring: from 2 to 6 blocks, high and long, at its prey
class FoxPounceGoal extends Goal {
  constructor(mob) { super(mob, MOVE | JUMP); }
  canUse() {
    const m = this.mob, t = m.target;
    if (!t || !t.alive() || !m.onGround || m.isBaby) return false;
    const d2 = m.dist2(t.pos.x, t.pos.y, t.pos.z);
    return d2 >= 4 && d2 <= 36 && RI(8) === 0 && m.canSee(t);
  }
  canContinue() { return !this.mob.onGround || this.t < 2; }
  start() {
    const m = this.mob, t = m.target;
    const dx = t.pos.x - m.pos.x, dz = t.pos.z - m.pos.z, l = Math.hypot(dx, dz) || 1;
    const k = Math.min(0.8, l * 0.12 + 0.15);
    m.vel.x = dx / l * k; m.vel.z = dz / l * k; m.vel.y = 0.5;
    m.yaw = m.bodyYaw = m.headYaw = yawTo(dx, dz);
    m.pouncing = true; this.t = 0;
  }
  tick() { this.t++; }
  stop() { this.mob.pouncing = false; }
}
export class Fox extends Animal {
  static W = 0.6; static H = 0.7; static HEALTH = 10; static SPEED = 0.3; static ATTACK = 2; static FOLLOW = 32;
  static MODEL = 'fox'; static TEX = 'fox_red'; static SHADOW = 0.4; static PANIC = 2.2;
  static FOOD = ['sweet_berries', 'glow_berries']; static SPAWN_ON = ['grass_block', 'snow', 'snow_block', 'podzol', 'coarse_dirt'];
  constructor(m, type) { super(m, type); this.kind = 'red'; this.sleeping = false; this.trusts = false; this.crouch = 0; this.oCrouch = 0; }
  get eyeH() { return 0.4; }
  registerGoals() {
    this.goals.add(0, new FloatGoal(this));
    this.goals.add(1, new PanicGoal(this, 2.2));
    this.goals.add(2, new BreedGoal(this, 1));
    this.goals.add(3, new AvoidPlayerGoal(this, 16, 1.6, 1.4, () => !this.trusts && !this.target));
    this.goals.add(4, new AvoidGoal(this, e => (e.type === 'wolf' || e.type === 'polar_bear') && !e.dead, 8, 1.6, 1.4));
    this.goals.add(5, new FollowParentGoal(this, 1.25));
    this.goals.add(6, new FoxPounceGoal(this));
    this.goals.add(7, new MeleeAttackGoal(this, 1.2, true));
    this.goals.add(8, new FoxSleepGoal(this));
    this.goals.add(10, new StrollGoal(this, 1));
    this.goals.add(11, new LookAtPlayerGoal(this, 24, 0.02));
    this.goals.add(12, new LookAroundGoal(this));
    this.targets.add(1, new DefendSelfGoal(this));
    this.targets.add(3, new PreyTargetGoal(this, e => FOX_PREY.has(e.type) && (e.type !== 'chicken' || !e.isBaby)));
  }
  finalizeSpawn() {
    const b = this.m.spawner ? this.m.spawner.biome(Math.floor(this.pos.x), Math.floor(this.pos.z)) : 'taiga';
    this.kind = /snowy|grove|frozen|ice/.test(b) ? 'snow' : 'red';
  }
  texName() { return 'fox_' + this.kind + (this.sleeping ? '_sleep' : ''); }
  inherit(a, b) { this.kind = (R() < 0.5 ? a : b).kind; this.trusts = true; }
  onHurt(amount, source) { super.onHurt(amount, source); this.sleeping = false; }
  aiStep() {
    super.aiStep();
    // crouched while it closes on prey a few blocks off
    this.oCrouch = this.crouch;
    const t = this.target, near = t && !t.dead && this.dist2(t.pos.x, t.pos.y, t.pos.z) < 100 && !this.pouncing;
    this.crouch += ((near ? 1 : 0) - this.crouch) * 0.25;
    if (near && this.nav && this.nav.speed > 0.7) this.nav.speed = 0.6 + (this.dist2(t.pos.x, t.pos.y, t.pos.z) < 9 ? 0.6 : 0);
  }
  anim(A, a) { A.sleeping = this.sleeping; A.crouch = this.oCrouch + (this.crouch - this.oCrouch) * a; A.pounce = !!this.pouncing; }
  loot() {}
  toJSON() { const o = super.toJSON(); o.kind = this.kind; if (this.trusts) o.tr = 1; return o; }
  fromJSON(o) { super.fromJSON(o); this.kind = o.kind || 'red'; this.trusts = !!o.tr; }
}
register('fox', Fox);
model('fox', [
  { name: 'head', pivot: [0, 16.5, -3], boxes: [[-4, -2, -5, 8, 6, 6, 0, 0], [-4, -4, -4, 2, 2, 1, 28, 0], [2, -4, -4, 2, 2, 1, 34, 0], [-2, 2.01, -8, 4, 2, 3, 28, 4]] },
  { name: 'body', pivot: [0, 16, -6], rot: [PI / 2, 0, 0], boxes: [[-3, 4, -3.5, 6, 11, 6, 0, 12]] },
  { name: 'rightHind', pivot: [-2, 17.5, 7], boxes: [[-1, 0.5, -1, 2, 6, 2, 24, 12]] },
  { name: 'leftHind', pivot: [2, 17.5, 7], boxes: [[-1, 0.5, -1, 2, 6, 2, 24, 12]] },
  { name: 'rightFront', pivot: [-2, 17.5, 0], boxes: [[-1, 0.5, -1, 2, 6, 2, 24, 12]] },
  { name: 'leftFront', pivot: [2, 17.5, 0], boxes: [[-1, 0.5, -1, 2, 6, 2, 24, 12]] },
  { name: 'tail', pivot: [0, 15, 8.5], rot: [1.52, 0, 0], boxes: [[-2, 0, -2.5, 4, 9, 5, 32, 12]] },
], (m, P, A) => {
  const I = m.index, w = A.walk * 0.6662, s = A.amt;
  set(P, I.head, RX, A.pitch); set(P, I.head, RY, A.yaw);
  if (A.sleeping) {
    // curled up on the ground: legs tucked, head down on the paws and turned, the tail round the front
    set(P, I.body, 1, 20); set(P, I.head, 1, 20.5); set(P, I.head, 2, -2.5); set(P, I.head, RY, 0.7); set(P, I.head, RX, 0.1); set(P, I.head, RZ, 0.15);
    for (const k of ['rightHind', 'leftHind', 'rightFront', 'leftFront']) { set(P, I[k], 1, 21); set(P, I[k], RX, k.endsWith('Front') ? -PI / 2 : PI / 2); }
    set(P, I.tail, 1, 21); set(P, I.tail, 2, 7); set(P, I.tail, RX, PI / 2); set(P, I.tail, RY, -1.2);
    return;
  }
  const c = A.crouch || 0;
  set(P, I.rightHind, RX, Math.cos(w) * 1.4 * s); set(P, I.leftHind, RX, Math.cos(w + PI) * 1.4 * s);
  set(P, I.rightFront, RX, Math.cos(w + PI) * 1.4 * s); set(P, I.leftFront, RX, Math.cos(w) * 1.4 * s);
  if (c > 0.01) {
    // creeping: everything low, the tail out straight
    add(P, I.body, 1, 1.5 * c); add(P, I.head, 1, 2 * c); add(P, I.tail, 1, 1.5 * c);
    for (const k of ['rightHind', 'leftHind', 'rightFront', 'leftFront']) add(P, I[k], 1, 1.5 * c);
  }
  if (A.pounce) { set(P, I.rightFront, RX, -1.2); set(P, I.leftFront, RX, -1.2); set(P, I.rightHind, RX, 1.1); set(P, I.leftHind, RX, 1.1); set(P, I.tail, RX, 1.7); }
  set(P, I.tail, RY, Math.cos(w * 0.5) * 0.25 * s);
});
function paintFox(p, c, sleep) {
  const fur = (x, y, w, h, col) => { p.fill(x, y, w, h, col, 0.06); p.speckle(x, y, w, h, p.shade(col, 0.9), 0.14, 0.03); };
  p.clear(0, 0, 64, 32);
  // head (0,0) 8x6x6: the face (6,6) with white cheeks and a black-tipped snout
  p.box(0, 0, 8, 6, 6, { all: (x, y, w, h) => fur(x, y, w, h, c.base) });
  p.fill(6, 9, 8, 3, c.white, 0.04); p.fill(0, 10, 6, 2, c.white, 0.04); p.fill(14, 10, 6, 2, c.white, 0.04);
  if (sleep) { p.fill(7, 8, 2, 1, c.dark, 0.03); p.fill(11, 8, 2, 1, c.dark, 0.03); }
  else { p.px(7, 8, 0xf4f0e8); p.px(8, 8, 0x141010); p.px(11, 8, 0x141010); p.px(12, 8, 0xf4f0e8); }
  // ears (28,0) and (34,0): dark backs, tips
  p.box(28, 0, 2, 2, 1, { all: (x, y, w, h) => fur(x, y, w, h, c.base) });
  p.box(34, 0, 2, 2, 1, { all: (x, y, w, h) => fur(x, y, w, h, c.base) });
  p.fill(29, 1, 2, 1, c.dark); p.fill(35, 1, 2, 1, c.dark);
  p.fill(29, 1, 2, 2, c.inner, 0.04); p.fill(35, 1, 2, 2, c.inner, 0.04);
  // snout (28,4) 4x2x3
  p.box(28, 4, 4, 2, 3, { all: (x, y, w, h) => fur(x, y, w, h, c.white) });
  fur(31, 4, 4, 3, c.base);
  p.fill(31, 7, 4, 1, c.nose); p.px(32, 7, 0x0e0c0c); p.px(33, 7, 0x0e0c0c);
  // body (0,12) 6x11x6 turned up: its back face is the fox's back, the front its pale belly
  p.box(0, 12, 6, 11, 6, { all: (x, y, w, h) => fur(x, y, w, h, c.base) });
  fur(6, 18, 6, 11, c.white); fur(4, 18, 2, 11, c.white); fur(12, 18, 2, 11, c.white);
  fur(18, 18, 6, 11, p.shade(c.base, 0.92));
  // legs (24,12): dark socks
  p.box(24, 12, 2, 6, 2, { all: (x, y, w, h) => fur(x, y, w, h, c.base) });
  p.fill(24, 16, 8, 4, c.dark, 0.05);
  // tail (32,12) 4x9x5: the white tip
  p.box(32, 12, 4, 9, 5, { all: (x, y, w, h) => fur(x, y, w, h, c.base) });
  p.fill(32, 23, 18, 3, c.tip, 0.04);
  p.fill(41, 12, 4, 5, c.tip, 0.04);
}
const FOX_ART = {
  red: { base: 0xd8762a, white: 0xf2ece2, dark: 0x3a2a22, inner: 0x2a1e18, nose: 0x2a2020, tip: 0xf4f0e8 },
  snow: { base: 0xeceae6, white: 0xfaf8f4, dark: 0x5a524c, inner: 0x4a423c, nose: 0x2a2424, tip: 0xfcfcfa },
};
for (const k of ['red', 'snow']) { addArt('fox_' + k, [64, 32], p => paintFox(p, FOX_ART[k], false)); addArt('fox_' + k + '_sleep', [64, 32], p => paintFox(p, FOX_ART[k], true)); }

/* ---------------------------------------------------------------------------
   Goat: 10 health, speed 0.2, 0.9 x 1.3; jumps high (and far: up to 5
   blocks to a spot it likes), takes 10 blocks less fall damage. Every
   30-300 seconds (5-15 for a screaming goat) it picks something within 4-9
   blocks, lowers its head and charges: 2 damage (1 for a kid) and a big
   shove. Wheat to breed, a bucket for milk.
--------------------------------------------------------------------------- */
class GoatRamGoal extends Goal {
  constructor(mob) { super(mob, MOVE | LOOK | JUMP); }
  canUse() {
    const m = this.mob;
    if (m.ramCool > 0 || !m.onGround || m.panicking) return false;
    const p = m.m.player;
    const cands = [];
    if (p.alive() && !p.creative()) { const d2 = m.dist2(p.pos.x, p.pos.y, p.pos.z); if (d2 >= 16 && d2 <= 81) cands.push(p); }
    m.m.forNear(m.pos.x, m.pos.z, 9, e => { if (e !== m && e.type !== 'goat' && e.alive && e.alive() && e.h !== undefined && e instanceof Living) { const d2 = m.dist2(e.pos.x, e.pos.y, e.pos.z); if (d2 >= 16 && d2 <= 81) cands.push(e); } });
    if (!cands.length) { m.ramCool = 20; return false; }
    this.t = cands[RI(cands.length)];
    return m.canSee(this.t);
  }
  start() { this.phase = 0; this.n = 0; this.mob.nav.stop(); this.mob.ramming = true; this.tx = this.t.pos.x; this.tz = this.t.pos.z; }
  canContinue() { return this.phase < 3 && this.t && this.t.alive() && this.n < 160; }
  stop() { const m = this.mob; m.ramming = false; m.ramCool = m.screaming ? 100 + RI(200) : 600 + RI(5400); m.stopMoving(); }
  tick() {
    const m = this.mob, t = this.t;
    this.n++;
    m.lookAtEntity(t, 30, 30);
    if (this.phase === 0) {
      // head down, a moment's warning
      m.yaw = m.bodyYaw = rotTowards(m.yaw, yawTo(this.tx - m.pos.x, this.tz - m.pos.z), 20 * DEG);
      if (this.n >= 20) { this.phase = 1; this.dx = this.tx - m.pos.x; this.dz = this.tz - m.pos.z; const l = Math.hypot(this.dx, this.dz) || 1; this.dx /= l; this.dz /= l; this.n0 = this.n; }
      return;
    }
    if (this.phase === 1) {
      // the charge, in a straight line
      m.yaw = m.bodyYaw = m.headYaw = yawTo(this.dx, this.dz);
      m.moveSpeedNow = m.speed * 3; m.zza = m.moveSpeedNow; m.mcOp = 2;
      const hit = Math.abs(t.pos.x - m.pos.x) < m.hw + (t.hw || 0.3) + 0.3 && Math.abs(t.pos.z - m.pos.z) < m.hw + (t.hw || 0.3) + 0.3 && Math.abs(t.pos.y - m.pos.y) < 1.5;
      if (hit) {
        const dmg = m.isBaby ? 1 : 2, k = 2.5 * (m.isBaby ? 0.5 : 1);
        if (t.isPlayer) { m.m.hurtPlayer(dmg, { type: 'mob', attacker: m, x: m.pos.x, z: m.pos.z, noKnock: true }); t.knockback(k * 0.5, -this.dx, -this.dz); t.push(0, 0.1, 0); }
        else { t.hurt(dmg, { type: 'mob', attacker: m, noKnock: true }); t.knockback(k * 0.5, -this.dx, -this.dz); }
        this.phase = 3; return;
      }
      if (m.hCollide && this.n - this.n0 > 3) {
        // into a wall: hard blocks knock a horn off
        const x = Math.floor(m.pos.x + this.dx * (m.hw + 0.3)), z = Math.floor(m.pos.z + this.dz * (m.hw + 0.3)), y = Math.floor(m.pos.y + 0.5);
        const d = BLOCKS[m.m.t.get(x, y, z)];
        if (d && /stone|log|ore|packed_ice|copper|deepslate|granite|diorite|andesite|tuff|calcite/.test(d.name) && m.horns > 0 && !m.isBaby) { m.horns--; m.m.dropAt(m, 'goat_horn', 1); }
        this.phase = 3; return;
      }
      if (this.n - this.n0 > 40) this.phase = 3;
    }
  }
}
// the long jump: now and then, a leap of up to 5 blocks to somewhere it can stand
class GoatLongJumpGoal extends Goal {
  constructor(mob) { super(mob, MOVE | JUMP); }
  canUse() {
    const m = this.mob;
    if (!m.onGround || m.ramming || m.passengers.length || RI(m.jumpChance()) !== 0) return false;
    for (let i = 0; i < 12; i++) {
      const dx = between(-5, 5), dz = between(-5, 5), dy = between(-3, 3);
      if (dx * dx + dz * dz < 9) continue;
      const x = Math.floor(m.pos.x) + dx, y = Math.floor(m.pos.y) + dy, z = Math.floor(m.pos.z) + dz;
      if (!standable(m, x, y, z)) continue;
      this.to = [x + 0.5, y, z + 0.5];
      return true;
    }
    return false;
  }
  start() {
    const m = this.mob, [x, y, z] = this.to;
    const dx = x - m.pos.x, dz = z - m.pos.z, dy = y - m.pos.y, l = Math.hypot(dx, dz);
    // a lob that lands there: about 14 ticks in the air
    const T = 14 + Math.max(0, dy) * 2;
    m.vel.x = dx / T / 0.91 * 1.1; m.vel.z = dz / T / 0.91 * 1.1;
    m.vel.y = Math.min(1.0, 0.42 + Math.max(0, dy) * 0.12 + l * 0.02);
    m.yaw = m.bodyYaw = m.headYaw = yawTo(dx, dz);
    m.onGround = false; this.n = 0; m.leaping = true;
  }
  canContinue() { return this.n < 3 || !this.mob.onGround; }
  tick() { this.n++; }
  stop() { this.mob.leaping = false; }
}
export class Goat extends Animal {
  static W = 0.9; static H = 1.3; static HEALTH = 10; static SPEED = 0.2; static ATTACK = 2; static SAFE_FALL = 10;
  static MODEL = 'goat'; static TEX = 'goat'; static SHADOW = 0.6; static PANIC = 2;
  static checkSpawn(S, x, y, z) { const b = S.m.t.get(x, y - 1, z); return (b === B.stone || b === B.snow_block || b === B.snow || b === B.packed_ice || b === B.grass_block) && S.brightEnough(x, y, z) && S.onGround(Goat, x, y, z); }
  constructor(m, type) { super(m, type); this.ramCool = 600 + RI(5400); this.horns = 2; this.screaming = false; this.ramming = false; }
  registerGoals() {
    super.registerGoals();
    this.goals.add(2, new GoatRamGoal(this));
    this.goals.add(5, new GoatLongJumpGoal(this));
  }
  jumpChance() { return this.screaming ? 100 : 300; }
  finalizeSpawn() { this.screaming = R() < 0.02; if (this.screaming) this.ramCool = 100 + RI(200); }
  aiStep() { if (this.ramCool > 0) this.ramCool--; super.aiStep(); }
  moveControl() { if (this.mcOp === 2) { this.mcOp = 0; return; } super.moveControl(); }
  jumpFromGround() { this.vel.y = 0.42 * 1.4; this.onGround = false; }
  interact(held) {
    if (held === 'bucket' && this.ageT >= 0) return 'milk';
    return super.interact(held);
  }
  anim(A) { A.ram = this.ramming; }
  layers(out) { if (this.horns > 0 && this.ageT >= 0) out.push(['goat_horns', 'goat', null]); }
  toJSON() { const o = super.toJSON(); if (this.horns !== 2) o.hn = this.horns; if (this.screaming) o.scr = 1; return o; }
  fromJSON(o) { super.fromJSON(o); this.horns = o.hn !== undefined ? o.hn : 2; this.screaming = !!o.scr; }
}
register('goat', Goat);
const goatParts = horns => [
  { name: 'head', pivot: [0, 6, -7], rot: [0.5, 0, 0], boxes: horns ? [] : [[-3, -6, -4, 6, 6, 6, 0, 0], [-2, -5, -9, 4, 4, 5, 24, 0], [-1, -1, -8, 2, 4, 2, 42, 0], [-6, -5, -1, 3, 2, 1, 50, 0], [3, -5, -1, 3, 2, 1, 50, 0, 0, true]] },
  { name: 'horns', parent: 'head', pivot: [0, -6, 0], rot: [-0.6, 0, 0], boxes: horns ? [[-2.5, -7, -1, 2, 7, 2, 0, 52], [0.5, -7, -1, 2, 7, 2, 0, 52, 0, true]] : [] },
  { name: 'body', pivot: [0, 0, 0], boxes: horns ? [] : [[-4.5, 3, -8, 9, 11, 16, 0, 12], [-5, 3.5, -8.5, 10, 7, 9, 0, 40, 0.1]] },
  { name: 'rightHind', pivot: [-3, 14, 6], boxes: horns ? [] : [[-1.5, 0, -1.5, 3, 10, 3, 50, 12]] },
  { name: 'leftHind', pivot: [3, 14, 6], boxes: horns ? [] : [[-1.5, 0, -1.5, 3, 10, 3, 50, 12, 0, true]] },
  { name: 'rightFront', pivot: [-3, 14, -6], boxes: horns ? [] : [[-1.5, 0, -1.5, 3, 10, 3, 50, 26]] },
  { name: 'leftFront', pivot: [3, 14, -6], boxes: horns ? [] : [[-1.5, 0, -1.5, 3, 10, 3, 50, 26, 0, true]] },
];
function goatAnim(m, P, A) {
  const I = m.index, w = A.walk * 0.6662, s = A.amt;
  set(P, I.head, RY, A.yaw); set(P, I.head, RX, 0.5 + A.pitch + (A.ram ? 0.6 : 0));
  set(P, I.rightHind, RX, Math.cos(w) * 1.4 * s); set(P, I.leftHind, RX, Math.cos(w + PI) * 1.4 * s);
  set(P, I.rightFront, RX, Math.cos(w + PI) * 1.4 * s); set(P, I.leftFront, RX, Math.cos(w) * 1.4 * s);
}
model('goat', goatParts(false), goatAnim);
model('goat_horns', goatParts(true), goatAnim);
addArt('goat', [64, 64], p => {
  const wool = 0xe8e4dc, shade = 0xcac4b8, face = 0xd8d2c6, dark = 0x3a3430;
  const fur = (x, y, w, h, col) => { p.fill(x, y, w, h, col, 0.05); p.speckle(x, y, w, h, shade, 0.2, 0.03); };
  p.clear(0, 0, 64, 64);
  p.box(0, 0, 6, 6, 6, { all: (x, y, w, h) => fur(x, y, w, h, face) });            // skull
  p.box(24, 0, 4, 4, 5, { all: (x, y, w, h) => fur(x, y, w, h, face) });           // muzzle
  p.fill(29, 5, 4, 4, 0xc8c0b2, 0.04); p.px(29, 6, dark); p.px(32, 6, dark);         // the muzzle's end, nostrils
  p.box(42, 0, 2, 4, 2, { all: (x, y, w, h) => fur(x, y, w, h, 0xf2f0ea) });       // beard
  p.box(50, 0, 3, 2, 1, { all: (x, y, w, h) => fur(x, y, w, h, face) });           // ears
  p.fill(51, 1, 3, 2, 0xb8a898, 0.04);
  // eyes on the sides of the skull (rectangular pupils)
  p.px(4, 9, 0xd8b040); p.px(5, 9, 0x1a1410); p.px(12, 9, 0xd8b040); p.px(13, 9, 0x1a1410);
  p.box(0, 12, 9, 11, 16, { all: (x, y, w, h) => fur(x, y, w, h, wool) });          // body
  p.box(0, 40, 10, 7, 9, { all: (x, y, w, h) => fur(x, y, w, h, 0xf2f0ea) });       // the shaggy shoulders
  p.box(50, 12, 3, 10, 3, { all: (x, y, w, h) => fur(x, y, w, h, wool) });          // legs, hooves
  p.box(50, 26, 3, 10, 3, { all: (x, y, w, h) => fur(x, y, w, h, wool) });
  p.fill(50, 22, 12, 3, 0x4a4038, 0.06); p.fill(50, 36, 12, 3, 0x4a4038, 0.06);
  // horns (0,52) 2x7x2: ridged grey-brown
  p.box(0, 52, 2, 7, 2, 0x9a9288, 0.06);
  for (let y = 54; y < 61; y += 2) p.fill(0, y, 8, 1, 0x7a7268);
});

/* ---------------------------------------------------------------------------
   Polar bear: 30 health, speed 0.25, 6 damage, 1.4 x 1.4. Leaves you alone
   unless you hit it, or come near its cub; rears up on its hind legs before
   it swipes. Cubs run when hurt and the adults near them turn on whoever
   did it. Hunts foxes. Drops raw cod (three times in four) or salmon.
   Cannot be bred.
--------------------------------------------------------------------------- */
class BearMeleeGoal extends MeleeAttackGoal {
  tick() {
    const m = this.mob, t = m.target;
    if (!t) return;
    const d2 = m.dist2(t.pos.x, t.pos.y, t.pos.z), reach = m.attackReach2(t);
    // within twice its reach it rears up as a warning, then swipes
    if (d2 > reach && d2 <= reach * 2 && this.cool <= 0) { m.standT = 20; }
    super.tick();
  }
}
class BearCubTargetGoal extends PetTargetGoal {
  canUse() {
    const m = this.mob, p = m.m.player;
    if (m.ageT < 0 || RI(10) !== 0 || !p.alive() || p.creative()) return false;
    if (m.dist2(p.pos.x, p.pos.y, p.pos.z) > 400) return false;
    const cub = m.m.nearest(m, 8, e => e.type === 'polar_bear' && e.ageT < 0 && !e.dead);
    if (!cub || !m.canSee(p)) return false;
    this.t = p;
    return true;
  }
}
export class PolarBear extends Animal {
  static W = 1.4; static H = 1.4; static HEALTH = 30; static SPEED = 0.25; static ATTACK = 6; static FOLLOW = 20;
  static MODEL = 'polar_bear'; static TEX = 'polar_bear'; static SHADOW = 0.9; static FOOD = [];
  static WATER_SPEED = 0.04; static WATER_DRAG = 0.98 * 0.92;
  static checkSpawn(S, x, y, z) { const b = S.m.t.get(x, y - 1, z); return (b === B.ice || b === B.packed_ice || b === B.snow_block || b === B.snow || b === B.grass_block) && S.brightEnough(x, y, z) && S.onGround(PolarBear, x, y, z); }
  constructor(m, type) { super(m, type); this.standT = 0; this.stand = 0; this.oStand = 0; this.angerT = 0; this.angryAt = null; }
  registerGoals() {
    this.goals.add(0, new FloatGoal(this));
    this.goals.add(1, new BearMeleeGoal(this, 1.25, true));
    this.goals.add(1, new PanicGoal(this, 2));
    this.goals.add(4, new FollowParentGoal(this, 1.25));
    this.goals.add(5, new StrollGoal(this, 1));
    this.goals.add(6, new LookAtPlayerGoal(this, 6));
    this.goals.add(7, new LookAroundGoal(this));
    this.targets.add(1, new DefendSelfGoal(this));
    this.targets.add(2, new BearCubTargetGoal(this));
    this.targets.add(3, new AngerTargetGoal(this));
    this.targets.add(4, new KindTargetGoal(this, e => e.type === 'fox', 10, true));
  }
  // cubs panic; grown bears stand and fight
  onHurt(amount, source) {
    super.onHurt(amount, source);
    const a = source.attacker;
    if (!a || a === this) return;
    this.angryAt = a; this.angerT = 400 + RI(380);
    if (this.ageT < 0) {
      // a cub calls the grown bears round it
      this.m.forNear(this.pos.x, this.pos.z, 20, o => { if (o.type === 'polar_bear' && o.ageT >= 0 && !o.dead) { o.angryAt = a; o.angerT = 400 + RI(380); if (!o.target) o.target = a; } });
    }
  }
  aiStep() {
    if (this.angerT > 0 && --this.angerT === 0) { if (this.target === this.angryAt) this.target = null; this.angryAt = null; }
    super.aiStep();
    this.oStand = this.stand;
    if (this.standT > 0) this.standT--;
    this.stand = Math.max(0, Math.min(1, this.stand + (this.standT > 0 ? 0.25 : -0.25)));
    // a cub does not fight: it runs (the panic goal), never the melee
    if (this.ageT < 0 && this.target) this.target = null;
  }
  doHurtTarget(t) { this.standT = 0; return super.doHurtTarget(t); }
  interact() { return false; }
  anim(A, a) { A.stand = this.oStand + (this.stand - this.oStand) * a; }
  loot(drop, byPlayer, L) { if (R() < 0.75) drop(this.fire > 0 ? 'cooked_cod' : 'cod', RI(3) + looted(L)); else drop(this.fire > 0 ? 'cooked_salmon' : 'salmon', RI(3) + looted(L)); }
}
register('polar_bear', PolarBear);
model('polar_bear', [
  { name: 'head', pivot: [0, 10, -16], boxes: [[-3.5, -3, -3, 7, 7, 7, 0, 0], [-2.5, 1, -6, 5, 3, 3, 0, 44], [-4.5, -4, -1, 2, 2, 1, 26, 0], [2.5, -4, -1, 2, 2, 1, 26, 0, 0, true]] },
  { name: 'body', pivot: [-2, 9, 12], rot: [PI / 2, 0, 0], boxes: [[-5, -13, -7, 14, 14, 11, 0, 19], [-4, -25, -7, 12, 12, 10, 39, 0]] },
  { name: 'rightHind', pivot: [-4.5, 14, 6], boxes: [[-2, 0, -2, 4, 10, 6, 50, 22]] },
  { name: 'leftHind', pivot: [4.5, 14, 6], boxes: [[-2, 0, -2, 4, 10, 6, 50, 22, 0, true]] },
  { name: 'rightFront', pivot: [-3.5, 14, -8], boxes: [[-2, 0, -2, 4, 10, 6, 50, 40]] },
  { name: 'leftFront', pivot: [3.5, 14, -8], boxes: [[-2, 0, -2, 4, 10, 6, 50, 40, 0, true]] },
], (m, P, A) => {
  const I = m.index, w = A.walk * 0.6662, s = A.amt, st = A.stand || 0;
  set(P, I.head, RX, A.pitch); set(P, I.head, RY, A.yaw);
  set(P, I.rightHind, RX, Math.cos(w) * 1.4 * s); set(P, I.leftHind, RX, Math.cos(w + PI) * 1.4 * s);
  set(P, I.rightFront, RX, Math.cos(w + PI) * 1.4 * s); set(P, I.leftFront, RX, Math.cos(w) * 1.4 * s);
  if (st > 0) {
    // up on its hind legs: the body tips back about its rear, the front legs and head go up with it
    add(P, I.body, RX, -st * PI * 0.35); add(P, I.body, 1, st * 2);
    for (const k of ['rightFront', 'leftFront']) { add(P, I[k], 1, -st * 20); add(P, I[k], 2, st * 4); add(P, I[k], RX, -st * PI * 0.45); }
    add(P, I.head, 1, -st * 24); add(P, I.head, 2, st * 13); add(P, I.head, RX, st * PI * 0.15);
  }
});
addArt('polar_bear', [128, 64], p => {
  const fur = 0xf0eee6, shade = 0xd8d4ca, dark = 0x2a2626;
  const coat = (x, y, w, h) => { p.fill(x, y, w, h, fur, 0.04); p.speckle(x, y, w, h, shade, 0.22, 0.03); };
  p.clear(0, 0, 128, 64);
  p.box(0, 0, 7, 7, 7, { all: coat });                                            // head
  p.px(8, 9, dark); p.px(12, 9, dark);                                              // eyes
  p.box(0, 44, 5, 3, 3, { all: coat });                                            // snout
  p.fill(4, 47, 3, 1, dark); p.px(5, 48, 0x4a4040);                                 // the black nose on its tip
  p.box(26, 0, 2, 2, 1, { all: coat });                                            // ears
  p.box(0, 19, 14, 14, 11, { all: coat });                                         // hind body
  p.box(39, 0, 12, 12, 10, { all: coat });                                         // shoulders
  p.box(50, 22, 4, 10, 6, { all: coat }); p.box(50, 40, 4, 10, 6, { all: coat });  // legs
  p.fill(50, 22 + 6 + 8, 20, 2, shade, 0.04); p.fill(50, 40 + 6 + 8, 20, 2, shade, 0.04);
  p.fill(60, 22, 4, 6, 0x3a3434, 0.05); p.fill(60, 40, 4, 6, 0x3a3434, 0.05);       // pads under the paws
});
