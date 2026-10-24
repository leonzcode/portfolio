/* ---------------------------------------------------------------------------
   Leoncraft 2 - the mobs: hostiles and farm animals.

   Numbers from the Minecraft Wiki's mob pages (Java Edition): health, the
   movement speed attribute, attack damage on Normal (Easy and Hard are
   worked out from it when the player is hit, see manager.js), follow
   range, size, loot, experience, and the goals each one runs, in the
   game's priority order.
--------------------------------------------------------------------------- */
import { Mob, Living, DEG, wrap, yawTo, rotTowards, Goal, MOVE, LOOK, looted } from './entity.js?v=107';
import { FloatGoal, PanicGoal, StrollGoal, LookAtPlayerGoal, LookAroundGoal, TemptGoal, BreedGoal, FollowParentGoal, EatGrassGoal,
  MeleeAttackGoal, BowAttackGoal, SwellGoal, LeapGoal, AvoidGoal, NearestPlayerTargetGoal, HurtByTargetGoal, NearestMobTargetGoal } from './ai.js?v=107';
import { B, BLOCKS, FLUID, OPACITY } from '../blocks.js?v=107';
import { itemId, armorOf } from '../items.js?v=107';

const R = () => Math.random();
const RI = n => Math.floor(Math.random() * n);
const between = (a, b) => a + RI(b - a + 1);

export const TYPES = {};
export function register(name, cls) { cls.TYPE = name; TYPES[name] = cls; return cls; }

/* ---- regional difficulty, the game's way (Minecraft Wiki): 0.75, plus the
   world's age (nothing for the first 3 days, up to 0.25 at 63), plus the
   moon (a quarter of its brightness, no more than the age part), times 1, 2
   or 3 for Easy, Normal and Hard; clamped is 0 below 2, 1 above 4, between
   in a straight line. The time spent in the chunk is not kept here, so that
   part is left out. ---- */
const MOON_BRIGHT = [1, 0.75, 0.5, 0.25, 0, 0.25, 0.5, 0.75];
export function clampedDifficulty(m) {
  const d = m.difficulty;
  if (d === 'peaceful') return 0;
  const t = m.time || 0;
  const age = t > 63 * 24000 ? 0.25 : t < 72000 ? 0 : (t - 72000) / 5760000;
  let chunk = Math.min(MOON_BRIGHT[Math.floor(t / 24000) % 8] * 0.25, age);
  if (d === 'easy') chunk *= 0.5;
  const r = (0.75 + age + chunk) * (d === 'hard' ? 3 : d === 'easy' ? 1 : 2);
  return r < 2 ? 0 : r > 4 ? 1 : (r - 2) / 2;
}
/* What a zombie or a skeleton is wearing when it appears (Minecraft Wiki):
   armour 15% x the clamped regional difficulty of the time; leather 23.60%,
   copper 32.23%, gold 33.29%, chainmail 9.73%, iron 1.10%, diamond 0.04%; a
   helmet always, then the chestplate, the leggings and the boots, each with a
   75% chance to go on (90% on Hard). The pieces add their armour points. */
const SPAWN_ARMOR = [['leather', 0.2360], ['copper', 0.3223], ['golden', 0.3329], ['chainmail', 0.0973], ['iron', 0.0110], ['diamond', 0.0004]];
const PIECES = [['head', 'helmet'], ['chest', 'chestplate'], ['legs', 'leggings'], ['feet', 'boots']];
export function spawnArmor(mob) {
  const m = mob.m;
  if (R() >= 0.15 * clampedDifficulty(m)) return;
  let r = R(), mat = 'leather';
  for (const [n, p] of SPAWN_ARMOR) { if (r < p) { mat = n; break; } r -= p; }
  const keep = m.difficulty === 'hard' ? 0.9 : 0.75;
  for (let i = 0; i < 4; i++) {
    if (i > 0 && R() >= keep) break;
    const [slot, piece] = PIECES[i], name = mat + '_' + piece, a = armorOf(itemId(name));
    if (mob.equip[slot] || !a) continue;
    mob.equip[slot] = name;
    mob.armor += a.points; mob.toughness = (mob.toughness || 0) + a.toughness;
  }
}

/* On Halloween (31 October, by the player's own clock) a zombie or a
   skeleton with nothing on its head has a 25% chance to appear in a carved
   pumpkin, one in ten of those a jack o'lantern, which it never drops (the
   game's rule). */
export function halloweenHead(mob) {
  if (mob.equip.head) return;
  const d = new Date();
  if (d.getMonth() !== 9 || d.getDate() !== 31 || R() >= 0.25) return;
  mob.equip.head = R() < 0.1 ? 'jack_o_lantern' : 'carved_pumpkin';
  mob.dropChance = Object.assign(mob.dropChance || {}, { head: 0 });
}

/* ---------------------------------------------------------------------------
   Monsters: they burn in daylight (the undead), prefer the dark when they
   wander, and go away when you are far off.
--------------------------------------------------------------------------- */
export class Monster extends Mob {
  static HOSTILE = true; static CATEGORY = 'monster'; static XP = 5;
  walkValue(x, y, z) { return 0.5 - this.m.brightness(x, y, z); }
  // the undead catch fire in the sun: by day, in full light, under open sky, not wet, nothing on the head
  sunBurn() {
    if (!this.constructor.UNDEAD || this.fire > 0 || this.inWater || this.helmet || (this.equip && this.equip.head)) return;
    if (!this.m.isDay()) return;
    const x = Math.floor(this.pos.x), y = Math.floor(this.pos.y + this.eyeH), z = Math.floor(this.pos.z);
    const br = this.m.brightness(x, y, z);
    if (br > 0.5 && R() * 30 < (br - 0.4) * 2 && this.m.t.sky(x, y, z) >= 15 && this.m.seesSky(x, y, z)) this.setFire(8);
  }
  aiStep() { this.sunBurn(); super.aiStep(); }
}

/* ---- Zombie: 20 health, speed 0.23, 3 damage, follow 35 ---- */
export class Zombie extends Monster {
  static W = 0.6; static H = 1.95; static HEALTH = 20; static SPEED = 0.23; static ATTACK = 3; static FOLLOW = 35; static ARMOR = 2;
  static UNDEAD = true; static MODEL = 'zombie'; static TEX = 'zombie'; static SHADOW = 0.5; static SPAWN_ARMOR = true;
  constructor(m, type) {
    super(m, type);
    this.armor = 2;
    this.canOpenDoors = false;
    this.baby = false;
  }
  registerGoals() {
    // 2: attack (arms raised); 7: stroll; 8: look; targets: hurt by (calls others), the player
    this.goals.add(2, new MeleeAttackGoal(this, 1, false));
    this.goals.add(7, new StrollGoal(this, 1));
    this.goals.add(8, new LookAtPlayerGoal(this, 8));
    this.goals.add(8, new LookAroundGoal(this));
    this.targets.add(1, new HurtByTargetGoal(this, true));
    this.targets.add(2, new NearestPlayerTargetGoal(this, true));
    // villagers (and wandering traders), then iron golems
    this.targets.add(3, new NearestMobTargetGoal(this, e => e.type === 'villager' || e.type === 'wandering_trader', false));
    this.targets.add(3, new NearestMobTargetGoal(this, e => e.type === 'iron_golem', true));
  }
  // a baby zombie: half the size, half again as fast, more experience
  setBaby(b) {
    this.baby = b;
    if (b) { this.w = 0.3; this.hw = 0.15; this.h = 0.975; this.speed = this.constructor.SPEED * 1.5; }
  }
  get xp() { return this.baby ? 12 : 5; }
  finalizeSpawn() {
    // 5% are babies (and some of those ride chickens, not here)
    if (R() < 0.05) this.setBaby(true);
    if (this.constructor.SPAWN_ARMOR) spawnArmor(this);
    halloweenHead(this);
    // can break doors on Hard (a 10% chance per zombie, scaled by regional difficulty: about 10%)
    this.breaksDoors = this.m.difficulty === 'hard' && R() < 0.1;
  }
  serverAi() {
    super.serverAi();
    if (this.breaksDoors && this.m.difficulty === 'hard') this.doorBreak();
  }
  /* Under water for 30 seconds a zombie starts to drown, shakes for 15
     more, and comes up a drowned (a husk becomes a zombie the same way). */
  aiStep() {
    super.aiStep();
    if (this.dead || this.removed || !this.constructor.CONVERTS_TO) return;
    if (this.eyeInWater) {
      if (!(this.convertT >= 0)) this.waterT = (this.waterT || 0) + 1;
      if (this.waterT >= 600 && !(this.convertT >= 0)) this.convertT = 300;
    } else if (!(this.convertT >= 0)) this.waterT = 0;
    if (this.convertT >= 0 && --this.convertT < 0) this.convert(this.constructor.CONVERTS_TO);
  }
  convert(type) {
    const n = this.m.spawn(type, this.pos.x, this.pos.y, this.pos.z, { natural: false, yaw: this.yaw });
    if (!n) return;
    if (this.baby && n.setBaby) n.setBaby(true);
    n.persistent = this.persistent;
    this.remove();
  }
  anim(A) { A.aggressive = this.aggressive; A.shake = this.convertT >= 0; }
  rootPose(root, t, a) { if (this.convertT >= 0) root.multiply(t.makeRotationY(Math.cos((this.age + a) * 3.25) * Math.PI * 0.01)); }
  /* Breaking a door: standing at a closed wooden door in its path, it beats
     on it for 240 ticks (Hard) and the door breaks. */
  doorBreak() {
    if (!this.hCollide || !this.nav || this.nav.isDone()) { this.doorT = 0; return; }
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const x = Math.floor(this.pos.x - s * 0.8), z = Math.floor(this.pos.z - c * 0.8);
    for (const dy of [0, 1]) {
      const y = Math.floor(this.pos.y) + dy, b = this.m.t.get(x, y, z), d = BLOCKS[b];
      if (d && d.shape === 'door' && !/^iron/.test(d.name) && !(this.m.t.meta(x, y, z) & 4)) {
        this.doorT = (this.doorT || 0) + 1;
        if (this.doorT % 20 === 0) this.swing();
        if (this.doorT >= 240) { this.m.breakBlock(x, y, z, true); this.doorT = 0; }
        return;
      }
    }
    this.doorT = 0;
  }
  /* L: the Looting on what killed it (manager.js onDeath): a common drop gets up to one
     more a level, a rare one a percentage point more a level */
  loot(drop, byPlayer, L) {
    drop('rotten_flesh', RI(3) + looted(L));
    if (byPlayer && R() < 0.025 + 0.01 * L) drop(['iron_ingot', 'carrot', this.fire > 0 ? 'baked_potato' : 'potato'][RI(3)], 1);
  }
  doHurtTarget(t) {
    const ok = super.doHurtTarget(t);
    // a villager killed by a zombie: half the time on Normal, always on Hard, it gets up a zombie villager
    if (ok && t.type === 'villager' && t.dead) {
      const d = this.m.difficulty;
      if (d === 'hard' || (d === 'normal' && R() < 0.5)) { t.removed = true; const z = this.m.spawn('zombie_villager', t.pos.x, t.pos.y, t.pos.z, { natural: false, yaw: t.yaw }); if (z) z.persistent = true; }
    }
    return ok;
  }
  toJSON() { const o = super.toJSON(); if (this.baby) o.baby = 1; return o; }
  fromJSON(o) { super.fromJSON(o); if (o.baby) this.setBaby(true); }
}
Zombie.CONVERTS_TO = 'drowned';
register('zombie', Zombie);
// a husk: does not burn, and its hit makes you hungry (it drops what a zombie drops)
export class Husk extends Zombie {
  static UNDEAD = false; static TEX = 'husk'; static CONVERTS_TO = 'zombie';
  doHurtTarget(t) { const ok = super.doHurtTarget(t); if (ok && t.isPlayer) this.m.effectPlayer('hunger', 140 * 2); return ok; }
}
register('husk', Husk);
/* A drowned with a trident throws it (the game's ranged attack: every 40 ticks at a target it can see within
   10 blocks); the trident it throws is gone, the one it holds may drop. */
class DrownedTridentGoal extends Goal {
  constructor(mob) { super(mob, MOVE | LOOK); this.t = 0; }
  canUse() { const m = this.mob, t = m.target; return m.equip.mainhand === 'trident' && !!t && t.alive() && m.dist2(t.pos.x, t.pos.y, t.pos.z) < 100 && m.canSee(t); }
  start() { this.t = 20; this.mob.aiming = true; }
  stop() { this.mob.aiming = false; }
  tick() {
    const m = this.mob, t = m.target;
    if (!t) return;
    m.lookAtEntity(t, 30, 30);
    if (m.nav) m.nav.stop();
    if (--this.t > 0) return;
    this.t = 40;
    const ey = m.pos.y + m.eyeH - 0.1, dx = t.pos.x - m.pos.x, dz = t.pos.z - m.pos.z, dy = t.pos.y + (t.h || 1.8) / 3 - ey, hd = Math.hypot(dx, dz);
    const tr = m.m.spawn('trident', m.pos.x, ey, m.pos.z, { natural: false });
    if (!tr) return;
    tr.owner = m; tr.pickup = 0; tr.stack = null;
    const diff = { peaceful: 0, easy: 1, normal: 2, hard: 3 }[m.m.difficulty] || 2;
    tr.shoot(dx, dy + hd * 0.2, dz, 1.6, 14 - diff * 4);
    m.swing();
  }
}
// a drowned: lives in water, swims after you
export class Drowned extends Zombie {
  static TEX = 'drowned'; static WATER_BREATHER = true; static CONVERTS_TO = null; static SPAWN_ARMOR = false;
  constructor(m, type) { super(m, type); this.waterCost = 0; }
  /* What it holds, as the game's natural ones (Minecraft Wiki): a trident 6.25% of the time, else a fishing
     rod 3.75%; a nautilus shell in its other hand 3%. Half of those with a trident, outside rivers, come
     riding a zombie nautilus. */
  finalizeSpawn(o) {
    super.finalizeSpawn(o);
    if (o && (o.spawner || o.trial || o.converted)) return;
    const r = R();
    if (r < 0.0625) this.equip.mainhand = 'trident';
    else if (r < 0.1) this.equip.mainhand = 'fishing_rod';
    if (R() < 0.03) this.equip.offhand = 'nautilus_shell';
    if (this.equip.mainhand === 'trident' && !this.baby && R() < 0.5 && o && o.natural !== false) {
      const W = this.m.world, b = W && W.biomeAt ? W.biomeAt(Math.floor(this.pos.x), Math.floor(this.pos.z)) : -1;
      const name = b >= 0 && BIOME_NAMES[b] ? BIOME_NAMES[b] : '';
      if (!/river/.test(name)) {
        const n = this.m.spawn('zombie_nautilus', this.pos.x, this.pos.y, this.pos.z, { natural: false });
        if (n) { this.vehicle = n; n.passengers.push(this); }
      }
    }
  }
  registerGoals() {
    this.goals.add(1, new DrownedTridentGoal(this));
    this.goals.add(2, new MeleeAttackGoal(this, 1, false));
    this.goals.add(7, new StrollGoal(this, 1, 120, false));
    this.goals.add(8, new LookAroundGoal(this));
    this.targets.add(1, new HurtByTargetGoal(this, true));
    this.targets.add(2, new NearestPlayerTargetGoal(this, true, p => p.inWater() || !this.m.isDay()));
  }
  aiStep() {
    // swimming: towards its target in three dimensions
    if (this.inWater && this.target) {
      const t = this.target, dx = t.pos.x - this.pos.x, dy = t.pos.y - this.pos.y, dz = t.pos.z - this.pos.z, l = Math.hypot(dx, dy, dz) || 1;
      this.vel.y += dy / l * 0.012 + 0.005;
      this.yaw = rotTowards(this.yaw, yawTo(dx, dz), 20 * DEG);
    }
    super.aiStep();
  }
  loot(drop, byPlayer, L) { drop('rotten_flesh', RI(3) + looted(L)); if (byPlayer && R() < 0.11 + 0.02 * L) drop('copper_ingot', 1); }
}
register('drowned', Drowned);
const BIOME_NAMES = [];
import('../biomes.js?v=107').then(m => { for (const b of m.BIOMES) BIOME_NAMES[b.id] = b.name; }).catch(() => {});

/* ---- Zombie villager: a zombie with a villager's face ---- */
export class ZombieVillager extends Zombie {
  static MODEL = 'zombie_villager'; static TEX = 'zombie_villager'; static CONVERTS_TO = null;
}
register('zombie_villager', ZombieVillager);

/* ---- Skeleton: 20 health, speed 0.25, a bow ---- */
export class Skeleton extends Monster {
  static W = 0.6; static H = 1.99; static HEALTH = 20; static SPEED = 0.25; static ATTACK = 2; static FOLLOW = 16;
  static UNDEAD = true; static MODEL = 'skeleton'; static TEX = 'skeleton'; static SHADOW = 0.5; static SPAWN_ARMOR = true;
  finalizeSpawn() { if (this.constructor.SPAWN_ARMOR) spawnArmor(this); halloweenHead(this); }
  constructor(m, type) { super(m, type); this.equip.mainhand = 'bow'; this.snowT = 0; this.convertT = -1; }
  registerGoals() {
    this.goals.add(3, new AvoidGoal(this, e => e.type === 'wolf' && !e.dead, 6, 1, 1.2));
    this.goals.add(4, new BowAttackGoal(this, 1, 15));
    this.goals.add(5, new StrollGoal(this, 1));
    this.goals.add(6, new LookAtPlayerGoal(this, 8));
    this.goals.add(6, new LookAroundGoal(this));
    this.targets.add(1, new HurtByTargetGoal(this, false));
    this.targets.add(2, new NearestPlayerTargetGoal(this, true));
  }
  // sideways while shooting (the strafe of its bow goal)
  strafe(fwd, side) { this.zza = fwd * this.speed; this.xxa = side * this.speed; this.moveSpeedNow = this.speed; this.mcOp = 2; }
  moveControl() {
    if (this.mcOp === 2) { this.mcOp = 0; return; }    // a strafe set this tick's input
    super.moveControl();
  }
  /* The shot: an arrow from the eyes at 1.6 blocks a tick, aimed a fifth of
     the distance above the target's chest, spread by 14 - 4 x difficulty. */
  shootAt(t, power) {
    const diff = { peaceful: 0, easy: 1, normal: 2, hard: 3 }[this.m.difficulty] || 2;
    const ey = this.pos.y + this.eyeH - 0.1;
    const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z, dy = t.pos.y + (t.h || 1.8) / 3 - ey;
    const hd = Math.hypot(dx, dz);
    const a = this.m.spawn('arrow', this.pos.x, ey, this.pos.z);
    if (!a) return;
    a.owner = this; a.base = 2 + (R() - 0.5) * 0.5 + diff * 0.11;
    a.shoot(dx, dy + hd * 0.2, dz, 1.6, 14 - diff * 4);
    a.pickup = this.constructor.STRAY ? 0 : 1;
    if (this.constructor.STRAY) a.effect = 'slowness';
    this.swing();
  }
  loot(drop, byPlayer, L) { drop('bone', RI(3) + looted(L)); drop('arrow', RI(3) + looted(L)); }
  /* Seven seconds in powder snow and a skeleton starts to shake; fifteen
     more and it is a stray. */
  aiStep() {
    super.aiStep();
    if (this.dead || this.removed || this.constructor !== Skeleton) return;
    const T = this.m.t, x = Math.floor(this.pos.x), z = Math.floor(this.pos.z);
    const ps = B.powder_snow;
    const inSnow = ps !== undefined && (T.get(x, Math.floor(this.pos.y), z) === ps || T.get(x, Math.floor(this.pos.y + 1), z) === ps);
    if (this.convertT >= 0) { if (--this.convertT < 0) this.m.convertMob(this, 'stray'); return; }
    if (inSnow) { if (++this.snowT >= 140) this.convertT = 300; } else this.snowT = 0;
  }
  anim(A) { A.aiming = this.aiming; A.shake = this.convertT >= 0; }
  rootPose(root, t, a) { if (this.convertT >= 0) root.multiply(t.makeRotationY(Math.cos((this.age + a) * 3.25) * Math.PI * 0.01)); }
}
register('skeleton', Skeleton);
export class Stray extends Skeleton {
  static TEX = 'stray'; static STRAY = true;
  loot(drop, byPlayer, L) { drop('bone', RI(3) + looted(L)); drop('arrow', RI(3) + looted(L)); if (byPlayer) drop('tipped_arrow', Math.min(1, RI(2) + looted(L))); }
}
register('stray', Stray);

/* ---- Creeper: 20 health, a 30 tick fuse, an explosion of power 3 ---- */
export class Creeper extends Monster {
  static W = 0.6; static H = 1.7; static HEALTH = 20; static SPEED = 0.25; static FOLLOW = 16;
  static MODEL = 'creeper'; static TEX = 'creeper'; static SHADOW = 0.5;
  constructor(m, type) { super(m, type); this.swell = 0; this.oSwell = 0; this.swellDir = -1; this.fuse = 30; this.power = 3; this.charged = false; }
  // struck by lightning (manager.js lightning): charged, and hurt and set alight as anything is
  thunderHit() { this.charged = true; }
  registerGoals() {
    this.goals.add(1, new FloatGoal(this));
    this.goals.add(2, new SwellGoal(this));
    this.goals.add(3, new AvoidGoal(this, e => (e.type === 'cat' || e.type === 'ocelot') && !e.dead, 6, 1, 1.2));
    this.goals.add(4, new MeleeAttackGoal(this, 1, false));
    this.goals.add(5, new StrollGoal(this, 0.8));
    this.goals.add(6, new LookAtPlayerGoal(this, 8));
    this.goals.add(6, new LookAroundGoal(this));
    this.targets.add(1, new NearestPlayerTargetGoal(this, true));
    this.targets.add(2, new HurtByTargetGoal(this, false));
  }
  // a creeper's "attack" is to light its fuse
  doHurtTarget() { this.swellDir = 1; return true; }
  // flint and steel (worn by 1) or a fire charge (used up) lights it for good, as the game's creeper igniters do
  interact(held) {
    if ((held !== 'flint_and_steel' && held !== 'fire_charge') || this.ignited || this.dead) return false;
    this.ignited = true;
    return held === 'fire_charge' ? 'consume' : 'damage';
  }
  tick() {
    this.oSwell = this.swell;
    if (!this.dead && !this.removed) {
      if (this.ignited) this.swellDir = 1;
      if (this.swellDir > 0 && this.swell === 0) this.m.fuseSound && this.m.fuseSound(this);
      this.swell += this.swellDir;
      if (this.swell < 0) this.swell = 0;
      if (this.swell >= this.fuse) {
        this.swell = this.fuse;
        // boom: the creeper is gone, the blocks and everything near are hit
        this.m.explode(this.pos.x, this.pos.y, this.pos.z, this.power * (this.charged ? 2 : 1), { type: 'explosion', attacker: this, mob: true });
        this.dead = true; this.remove();
        return;
      }
    }
    super.tick();
  }
  loot(drop, byPlayer, L) { drop('gunpowder', RI(3) + looted(L)); }
  anim(A, a) { A.swell = (this.oSwell + (this.swell - this.oSwell) * a) / (this.fuse - 2); }
  toJSON() { const o = super.toJSON(); if (this.charged) o.ch = 1; if (this.ignited) o.ig = 1; return o; }
  fromJSON(o) { super.fromJSON(o); this.charged = !!o.ch; this.ignited = !!o.ig; }
}
register('creeper', Creeper);

/* ---- Spider: 16 health, speed 0.3, 2 damage, climbs walls, only hostile in the dark ---- */
export class Spider extends Monster {
  static W = 1.4; static H = 0.9; static HEALTH = 16; static SPEED = 0.3; static ATTACK = 2; static FOLLOW = 16;
  static CLIMBS = true; static MODEL = 'spider'; static TEX = 'spider'; static SHADOW = 1;
  get eyeH() { return 0.65; }
  registerGoals() {
    this.goals.add(1, new FloatGoal(this));
    this.goals.add(3, new LeapGoal(this, 0.4));
    this.goals.add(4, new SpiderAttack(this, 1, true));
    this.goals.add(5, new StrollGoal(this, 0.8));
    this.goals.add(6, new LookAtPlayerGoal(this, 8));
    this.goals.add(6, new LookAroundGoal(this));
    this.targets.add(1, new HurtByTargetGoal(this, false));
    // a spider only goes for you in the dark (or once you hit it)
    this.targets.add(2, new NearestPlayerTargetGoal(this, true, () => this.m.brightness(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.5), Math.floor(this.pos.z)) < 0.5));
  }
  aiStep() { this.climbing = this.hCollide; super.aiStep(); }
  loot(drop, byPlayer, L) { drop('string', RI(3) + looted(L)); if (byPlayer) drop('spider_eye', (RI(3) === 0 ? 1 : 0) + looted(L)); }
  // spiders' jockeys and effects on Hard are left out
}
// the spider gives up the chase in daylight (one chance in a hundred a tick)
class SpiderAttack extends MeleeAttackGoal {
  canContinue() {
    const m = this.mob;
    if (m.m.brightness(Math.floor(m.pos.x), Math.floor(m.pos.y + 0.5), Math.floor(m.pos.z)) >= 0.5 && R() < 0.01 && m.lastHurtBy !== m.target) { m.target = null; return false; }
    return super.canContinue();
  }
}
register('spider', Spider);
export class CaveSpider extends Spider {
  static W = 0.7; static H = 0.5; static HEALTH = 12; static TEX = 'cave_spider'; static SHADOW = 0.6; static SCALE = 0.7;
  get eyeH() { return 0.45; }
  doHurtTarget(t) {
    const ok = super.doHurtTarget(t);
    // poison: 7 seconds on Normal, 15 on Hard
    if (ok && t.isPlayer && this.m.difficulty !== 'easy') this.m.effectPlayer('poison', this.m.difficulty === 'hard' ? 300 : 140);
    return ok;
  }
}
register('cave_spider', CaveSpider);

/* ---------------------------------------------------------------------------
   Animals: they wander towards grass, follow a player holding their food,
   breed (two in love make a baby that grows up in 20 minutes), panic when
   hit, and never despawn.
--------------------------------------------------------------------------- */
export class Animal extends Mob {
  // animals never despawn, but (not being "persistent") they count towards the creature cap, as in the game
  static CATEGORY = 'creature'; static SHADOW = 0.5; static NO_DESPAWN = true;
  static FOOD = ['wheat'];
  constructor(m, type) {
    super(m, type);
    this.ageT = 0;          // below 0: a baby, counting up to grown; above 0: time before it can breed again
    this.inLove = 0;
  }
  registerGoals() {
    const c = this.constructor;
    this.goals.add(0, new FloatGoal(this));
    this.goals.add(1, new PanicGoal(this, c.PANIC || 1.25));
    this.goals.add(2, new BreedGoal(this, 1));
    this.goals.add(3, new TemptGoal(this, c.TEMPT || 1.2, c.FOOD));
    this.goals.add(4, new FollowParentGoal(this, 1.1));
    this.goals.add(5, new StrollGoal(this, 1));
    this.goals.add(6, new LookAtPlayerGoal(this, 6));
    this.goals.add(7, new LookAroundGoal(this));
  }
  get isBaby() { return this.ageT < 0; }
  walkValue(x, y, z) { return this.m.t.get(x, y - 1, z) === B.grass_block ? 10 : this.m.brightness(x, y, z) - 0.5; }
  aiStep() {
    super.aiStep();
    if (this.ageT < 0) { if (++this.ageT === 0) this.grewUp(); }
    else if (this.ageT > 0) this.ageT--;
    if (this.inLove > 0) { this.inLove--; if (this.age % 10 === 0) this.m.particles('heart', this.pos.x, this.pos.y + this.h + 0.3, this.pos.z, 1, 0.4); }
  }
  grewUp() {}
  // fed: babies grow a tenth of the way; grown ones fall in love
  feed() {
    if (this.ageT < 0) { this.ageT = Math.min(0, this.ageT + Math.floor(-this.ageT * 0.1)); this.m.particles('sparkle', this.pos.x, this.pos.y + this.h, this.pos.z, 4, 0.5); return true; }
    if (this.ageT === 0 && !this.inLove) { this.inLove = 600; return true; }
    return false;
  }
  interact(held) {
    if (this.constructor.FOOD.indexOf(held) >= 0 && this.feed()) return 'consume';
    return false;
  }
  get xp() { return this.ageT < 0 ? 0 : 1 + RI(3); }
  toJSON() { const o = super.toJSON(); if (this.ageT) o.age = this.ageT; return o; }
  fromJSON(o) { super.fromJSON(o); this.ageT = o.age || 0; }
}

/* ---- Pig: 10 health, speed 0.25; carrots, potatoes, beetroot; a saddle to ride ---- */
export class Pig extends Animal {
  static W = 0.9; static H = 0.9; static HEALTH = 10; static SPEED = 0.25; static MODEL = 'pig'; static TEX = 'pig'; static SHADOW = 0.7;
  static FOOD = ['carrot', 'potato', 'beetroot', 'carrot_on_a_stick'];
  constructor(m, type) { super(m, type); this.saddled = false; this.boostT = 0; this.boostLen = 0; }
  aiStep() { super.aiStep(); if (this.boostT > 0) this.boostT--; }
  // struck by lightning: a zombified piglin with a golden sword where it stood (not on Peaceful, where it is only hurt)
  thunderHit(m) {
    if (m.difficulty === 'peaceful') return undefined;
    const n = m.convertMob(this, 'zombified_piglin', z => { if (z.equip) z.equip.mainhand = 'golden_sword'; z.attackDamage = 8; z.persistent = true; });
    return n ? false : undefined;
  }
  // a burst from the carrot on a stick: 140 to 980 ticks, the speed rising and falling up to 2.15 times (as the strider's)
  boost() { if (this.boostT > 0) return false; this.boostLen = this.boostT = 140 + RI(841); return true; }
  boostFactor() { return this.boostT > 0 ? 1 + 1.15 * Math.sin((1 - this.boostT / this.boostLen) * Math.PI) : 1; }
  loot(drop, byPlayer, L) { drop(this.fire > 0 ? 'cooked_porkchop' : 'porkchop', between(1, 3) + looted(L)); if (this.saddled) drop('saddle', 1); }
  interact(held) {
    if (held === 'saddle' && !this.saddled && this.ageT >= 0) { this.saddled = true; return 'consume'; }
    if (this.saddled && this.passengers.length === 0 && held !== 'carrot' && held !== 'potato' && held !== 'beetroot') { this.m.mount(this); return 'swing'; }
    return super.interact(held);
  }
  // ridden with a carrot on a stick: it goes where you look
  rideControl(keys, rider) {
    if (this.m.heldName() !== 'carrot_on_a_stick') return false;
    this.yaw = rotTowards(this.yaw, rider.yaw, 10 * DEG);
    this.bodyYaw = this.yaw; this.headYaw = this.yaw;
    this.moveSpeedNow = this.speed * 0.225 / 0.25 * this.boostFactor();
    this.zza = this.moveSpeedNow;
    return true;
  }
  layers(out) { if (this.saddled) out.push(['pig_saddle', 'pig_saddle', null]); }
  // the seat on its back, 0.86875 up; a player's own seat is 0.6 above its feet
  seat(i, p) { return [0, 0.86875 - (p && p.isPlayer ? 0.6 : 0), 0]; }
  ridingOffset() { return 0.86875; }
  toJSON() { const o = super.toJSON(); if (this.saddled) o.sad = 1; return o; }
  fromJSON(o) { super.fromJSON(o); this.saddled = !!o.sad; }
}
register('pig', Pig);

/* ---- Cow: 10 health, speed 0.2; wheat; milk with a bucket ---- */
export class Cow extends Animal {
  static W = 0.9; static H = 1.4; static HEALTH = 10; static SPEED = 0.2; static PANIC = 2; static TEMPT = 1.25;
  static MODEL = 'cow'; static TEX = 'cow'; static SHADOW = 0.7;
  loot(drop, byPlayer, L) { drop('leather', RI(3) + looted(L)); drop(this.fire > 0 ? 'cooked_beef' : 'beef', between(1, 3) + looted(L)); }
  interact(held) {
    if (held === 'bucket' && this.ageT >= 0) return 'milk';
    return super.interact(held);
  }
}
register('cow', Cow);

/* ---- Sheep: 8 health, speed 0.23; wheat; shears for 1-3 wool, eats grass to grow it back ---- */
export const DYES = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
// the game's wool tints (multiplied into the white wool texture)
export const DYE_RGB = {
  white: 0xf9fffe, orange: 0xf9801d, magenta: 0xc74ebd, light_blue: 0x3ab3da, yellow: 0xfed83d, lime: 0x80c71f, pink: 0xf38baa, gray: 0x474f52,
  light_gray: 0x9d9d97, cyan: 0x169c9c, purple: 0x8932b8, blue: 0x3c44aa, brown: 0x835432, green: 0x5e7c16, red: 0xb02e26, black: 0x1d1d21,
};
export class Sheep extends Animal {
  static W = 0.9; static H = 1.3; static HEALTH = 8; static SPEED = 0.23; static MODEL = 'sheep'; static TEX = 'sheep'; static SHADOW = 0.7;
  constructor(m, type) { super(m, type); this.color = 'white'; this.sheared = false; }
  registerGoals() {
    super.registerGoals();
    this.goals.add(5, new EatGrassGoal(this));
  }
  finalizeSpawn() {
    // the game's natural colours: mostly white, some grey, black, brown, and rarely pink
    const r = R() * 100;
    this.color = r < 5 ? 'black' : r < 10 ? 'gray' : r < 15 ? 'light_gray' : r < 18 ? 'brown' : r < 18.164 ? 'pink' : 'white';
  }
  ateGrass() { this.sheared = false; if (this.ageT < 0) this.ageT = Math.min(0, this.ageT + 60 * 20); }
  interact(held) {
    if (held === 'shears' && !this.sheared && this.ageT >= 0) {
      this.sheared = true;
      this.m.dropAt(this, this.color + '_wool', between(1, 3));
      return 'damage';
    }
    if (held && held.endsWith('_dye')) {
      const c = held.slice(0, -4);
      if (DYES.indexOf(c) >= 0 && c !== this.color && !this.sheared) { this.color = c; return 'consume'; }
    }
    return super.interact(held);
  }
  loot(drop, byPlayer, L) { if (!this.sheared) drop(this.color + '_wool', 1); drop(this.fire > 0 ? 'cooked_mutton' : 'mutton', between(1, 2) + looted(L)); }
  layers(out) { if (!this.sheared) out.push(['sheep_wool', 'sheep_wool', DYE_RGB[this.color]]); }
  anim(A, a) { const e = this.extra.eatT || 0; A.eating = e <= 0 ? 0 : e >= 4 && e <= 36 ? 1 : e < 4 ? (e - a) / 4 : -(e - 40 - a) / 4; }
  toJSON() { const o = super.toJSON(); o.c = this.color; if (this.sheared) o.sh = 1; return o; }
  fromJSON(o) { super.fromJSON(o); this.color = o.c || 'white'; this.sheared = !!o.sh; }
}
register('sheep', Sheep);

/* ---- Chicken: 4 health, speed 0.25; seeds; falls slowly, lays an egg every 5-10 minutes ---- */
export class Chicken extends Animal {
  static W = 0.4; static H = 0.7; static HEALTH = 4; static SPEED = 0.25; static PANIC = 1.4; static TEMPT = 1;
  static NO_FALL = true; static MODEL = 'chicken'; static TEX = 'chicken'; static SHADOW = 0.3;
  static FOOD = ['wheat_seeds', 'melon_seeds', 'pumpkin_seeds', 'beetroot_seeds', 'torchflower_seeds', 'pitcher_pod'];
  constructor(m, type) { super(m, type); this.flap = 0; this.oFlap = 0; this.flapSpeed = 0; this.oFlapSpeed = 0; this.flapping = 1; this.eggT = 6000 + RI(6000); }
  aiStep() {
    super.aiStep();
    // the wings flap while it falls, and the fall is slowed to 0.6 a tick
    this.oFlap = this.flap; this.oFlapSpeed = this.flapSpeed;
    this.flapSpeed += (this.onGround ? -1 : 4) * 0.3;
    this.flapSpeed = Math.max(0, Math.min(1, this.flapSpeed));
    if (!this.onGround && this.flapping < 1) this.flapping = 1;
    this.flapping *= 0.9;
    if (!this.onGround && this.vel.y < 0) this.vel.y *= 0.6;
    this.flap += this.flapping * 2;
    if (!this.dead && this.ageT >= 0 && --this.eggT <= 0) {
      this.m.dropAt(this, 'egg', 1);
      this.eggT = 6000 + RI(6000);
    }
  }
  loot(drop, byPlayer, L) { drop('feather', RI(3) + looted(L)); drop(this.fire > 0 ? 'cooked_chicken' : 'chicken', 1 + looted(L)); }
  anim(A, a) {
    const f = this.oFlap + (this.flap - this.oFlap) * a, s = this.oFlapSpeed + (this.flapSpeed - this.oFlapSpeed) * a;
    A.flap = (Math.sin(f) + 1) * s;
  }
}
register('chicken', Chicken);
