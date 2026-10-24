/* ---------------------------------------------------------------------------
   Leoncraft 2 - what mobs want: the game's goals.

   Each goal says when it can start, when it carries on, and what it does a
   tick; the mob's goal selector (entity.js) runs the most important ones
   whose flags do not clash. The numbers are the game's (from the Minecraft
   Wiki's mob pages and its AI notes): a stroll every 120 ticks or so to
   somewhere within 10 blocks, a 2% chance a tick to look at a player within
   8, panic running at 1.25 to 2 times walking speed, a melee swing every 20
   ticks, a skeleton's shot every 20 ticks on Hard and 40 otherwise from up
   to 15 blocks, a creeper's fuse once you are within 3 blocks.
--------------------------------------------------------------------------- */
import { Goal, MOVE, LOOK, JUMP, TARGET, DEG, wrap, yawTo } from './entity.js?v=107';
import { BLOCKS, FLUID, SOLID, B } from '../blocks.js?v=107';

const R = () => Math.random();
const RI = n => Math.floor(Math.random() * n);

/* ---- random places to walk to (the game's LandRandomPos) ----
   Ten tries within h blocks across and v up and down, each moved to the
   ground there; the best by the mob's liking (animals like grass, monsters
   like the dark) that it could actually stand on. */
export function randomLandPos(mob, h, v, avoidWater = true, towards) {
  const T = mob.m.t;
  let best = null, bestV = -Infinity;
  for (let i = 0; i < 10; i++) {
    let dx = RI(2 * h + 1) - h, dz = RI(2 * h + 1) - h, dy = RI(2 * v + 1) - v;
    if (towards) {
      // biased towards (or away from) a point
      const ax = towards[0] - mob.pos.x, az = towards[2] - mob.pos.z, l = Math.hypot(ax, az) || 1;
      if ((dx * ax + dz * az) / l < 0) { dx = -dx; dz = -dz; }
    }
    const x = Math.floor(mob.pos.x) + dx, z = Math.floor(mob.pos.z) + dz;
    let y = Math.floor(mob.pos.y) + dy;
    if (!T.loaded(x, z)) continue;
    // to the ground: up out of anything solid, down to something to stand on
    let n = 0;
    while (T.solid(x, y, z) && n++ < 8) y++;
    n = 0;
    while (!T.solid(x, y - 1, z) && !FLUID[T.get(x, y - 1, z)] && n++ < 8) y--;
    if (T.solid(x, y, z) || T.solid(x, y + 1, z) && mob.h > 1) continue;
    const below = T.get(x, y - 1, z);
    if (FLUID[below] === 2 || FLUID[T.get(x, y, z)] === 2) continue;
    const wet = FLUID[T.get(x, y, z)] === 1 || FLUID[below] === 1;
    if (wet && avoidWater && R() < 0.999) continue;
    // a mob with no liking of its own takes any spot alike (the game's PathfinderMob gives 0)
    const val = mob.walkValue ? mob.walkValue(x, y, z) : 0;
    if (val > bestV) { bestV = val; best = [x + 0.5, y, z + 0.5]; }
  }
  return best;
}
// somewhere away from a point (fleeing)
export function posAway(mob, h, v, from) {
  const away = [mob.pos.x * 2 - from.x, 0, mob.pos.z * 2 - from.z];
  return randomLandPos(mob, h, v, false, away);
}

/* ---- swim: keep the head above water ---- */
export class FloatGoal extends Goal {
  constructor(mob) { super(mob, JUMP); }
  canUse() { const m = this.mob; return (m.inWater && m.waterDepth > (m.eyeH < 0.4 ? 0.2 : 0.4)) || m.inLava; }
  tick() { this.mob.wantFloat = R() < 0.8; }
  stop() { this.mob.wantFloat = false; }
}

/* ---- run about when hurt (or burning) ---- */
export class PanicGoal extends Goal {
  constructor(mob, speed) { super(mob, MOVE); this.speed = speed; }
  canUse() {
    const m = this.mob;
    if (!(m.lastHurtBy || m.fire > 0)) return false;
    if (m.lastHurtByTime < 80 && !m.fire) return false;
    const p = m.lastHurtBy ? posAway(m, 5, 4, m.lastHurtBy.pos) : randomLandPos(m, 5, 4, false);
    if (!p) return false;
    this.p = p;
    return true;
  }
  start() { this.mob.nav.moveTo(this.p[0], this.p[1], this.p[2], this.speed, 0.5); this.mob.panicking = true; }
  canContinue() { return !this.mob.nav.isDone(); }
  stop() { this.mob.panicking = false; }
}

/* ---- wander ---- */
export class StrollGoal extends Goal {
  constructor(mob, speed, interval = 120, avoidWater = true) { super(mob, MOVE); this.speed = speed; this.interval = interval; this.avoidWater = avoidWater; }
  canUse() {
    const m = this.mob;
    if (m.vehicle || m.sitting) return false;
    if (!this.forced) {
      if (m.noActionTime >= 100 && m.constructor.HOSTILE) return false;
      if (RI(this.interval) !== 0) return false;
    }
    this.forced = false;
    const p = randomLandPos(m, 10, 7, this.avoidWater);
    if (!p) return false;
    this.p = p;
    return true;
  }
  start() { this.mob.nav.moveTo(this.p[0], this.p[1], this.p[2], this.speed, 0.5); }
  canContinue() { return !this.mob.nav.isDone() && !this.mob.vehicle; }
  stop() { this.mob.nav.stop(); }
}

/* ---- look at the player now and then ---- */
export class LookAtPlayerGoal extends Goal {
  constructor(mob, dist = 8, chance = 0.02) { super(mob, LOOK); this.dist = dist; this.chance = chance; }
  canUse() {
    if (R() >= this.chance) return false;
    const m = this.mob, p = m.m.player;
    if (!p || !p.alive()) return false;
    if (m.target && m.target !== p) return false;
    if (m.dist2(p.pos.x, p.pos.y, p.pos.z) > this.dist * this.dist) return false;
    this.t = 40 + RI(40);
    return true;
  }
  canContinue() { const m = this.mob, p = m.m.player; return this.t > 0 && p.alive() && m.dist2(p.pos.x, p.pos.y, p.pos.z) <= this.dist * this.dist; }
  tick() { this.t--; this.mob.lookAtEntity(this.mob.m.player); }
}
export class LookAroundGoal extends Goal {
  constructor(mob) { super(mob, MOVE | LOOK); }
  canUse() { return R() < 0.02; }
  start() { const a = R() * Math.PI * 2; this.dx = Math.cos(a); this.dz = Math.sin(a); this.t = 20 + RI(20); }
  canContinue() { return this.t >= 0; }
  tick() { this.t--; const m = this.mob; m.lookAt(m.pos.x + this.dx, m.pos.y + m.eyeH, m.pos.z + this.dz); }
}

/* ---- follow a player holding food it likes ---- */
export class TemptGoal extends Goal {
  constructor(mob, speed, items) { super(mob, MOVE | LOOK); this.speed = speed; this.items = items; this.cool = 0; }
  canUse() {
    if (this.cool > 0) { this.cool--; return false; }
    const m = this.mob, p = m.m.player;
    if (!p || !p.alive() || m.sitting) return false;
    if (m.dist2(p.pos.x, p.pos.y, p.pos.z) > 100) return false;
    const held = m.m.heldName();
    return this.items.indexOf(held) >= 0 || this.items.indexOf(m.m.offhandName()) >= 0;
  }
  canContinue() { return this.canUse(); }
  tick() {
    const m = this.mob, p = m.m.player;
    m.lookAt(p.pos.x, p.pos.y + 1.62, p.pos.z, 30, 40);
    if (m.dist2(p.pos.x, p.pos.y, p.pos.z) < 6.25) m.nav.stop();
    else if (m.age % 5 === 0 || m.nav.isDone()) m.nav.moveTo(p.pos.x, p.pos.y, p.pos.z, this.speed, 1.5);
  }
  stop() { this.mob.nav.stop(); this.cool = 100; }
}

/* ---- breeding: two in love find each other; a baby after 60 ticks ---- */
export class BreedGoal extends Goal {
  constructor(mob, speed) { super(mob, MOVE | LOOK); this.speed = speed; }
  canUse() {
    const m = this.mob;
    if (!m.inLove) return false;
    this.mate = m.m.nearest(m, 8, e => e !== m && e.type === m.type && e.inLove > 0 && !e.dead);
    return !!this.mate;
  }
  canContinue() { return this.mate && !this.mate.dead && this.mate.inLove > 0 && this.mob.inLove > 0 && this.t < 60; }
  start() { this.t = 0; }
  stop() { this.mate = null; this.t = 0; }
  tick() {
    const m = this.mob, o = this.mate;
    m.lookAtEntity(o, 10, m.maxPitch());
    if (m.age % 4 === 0) m.nav.moveTo(o.pos.x, o.pos.y, o.pos.z, this.speed, 1);
    this.t++;
    if (this.t >= 60 && m.dist2(o.pos.x, o.pos.y, o.pos.z) < 9) m.m.breed(m, o);
  }
}
export class FollowParentGoal extends Goal {
  constructor(mob, speed) { super(mob, 0); this.speed = speed; }
  canUse() {
    const m = this.mob;
    if (m.ageT >= 0) return false;
    this.parent = m.m.nearest(m, 8, e => e !== m && e.type === m.type && e.ageT >= 0 && !e.dead);
    return !!this.parent && m.dist2(this.parent.pos.x, this.parent.pos.y, this.parent.pos.z) >= 9;
  }
  canContinue() { const m = this.mob, p = this.parent; return m.ageT < 0 && p && !p.dead && m.dist2(p.pos.x, p.pos.y, p.pos.z) >= 9 && m.dist2(p.pos.x, p.pos.y, p.pos.z) <= 256; }
  start() { this.t = 0; }
  tick() { if (--this.t <= 0) { this.t = 10; this.mob.nav.moveTo(this.parent.pos.x, this.parent.pos.y, this.parent.pos.z, this.speed, 2); } }
}

/* ---- a sheep eating grass (and growing its wool back) ---- */
export class EatGrassGoal extends Goal {
  constructor(mob) { super(mob, MOVE | LOOK | JUMP); }
  canUse() {
    const m = this.mob;
    if (RI(m.ageT < 0 ? 50 : 1000) !== 0) return false;
    const T = m.m.t, x = Math.floor(m.pos.x), y = Math.floor(m.pos.y), z = Math.floor(m.pos.z);
    return T.get(x, y, z) === B.short_grass || T.get(x, y - 1, z) === B.grass_block;
  }
  start() { this.t = 40; this.mob.nav.stop(); this.mob.extra.eatT = 40; }
  canContinue() { return this.t > 0; }
  stop() { this.t = 0; this.mob.extra.eatT = 0; }
  tick() {
    this.t = Math.max(0, this.t - 1);
    this.mob.extra.eatT = this.t;
    if (this.t !== 4) return;
    const m = this.mob, W = m.m.world, x = Math.floor(m.pos.x), y = Math.floor(m.pos.y), z = Math.floor(m.pos.z);
    if (m.m.t.get(x, y, z) === B.short_grass) { W.set(x, y, z, 0, 0); m.ateGrass(); }
    else if (m.m.t.get(x, y - 1, z) === B.grass_block) { W.set(x, y - 1, z, B.dirt, 0); m.ateGrass(); }
  }
}

/* ---- attacking ---- */
export class MeleeAttackGoal extends Goal {
  constructor(mob, speed, evenUnseen) { super(mob, MOVE | LOOK); this.speed = speed; this.evenUnseen = evenUnseen; this.cool = 0; }
  canUse() {
    const m = this.mob, t = m.target;
    if (!t || !t.alive()) return false;
    if (m.age - (this.lastUse || -100) < 20) return false;
    this.lastUse = m.age;
    if (m.dist2(t.pos.x, t.pos.y, t.pos.z) <= m.attackReach2(t)) return true;
    return m.nav.moveTo(t.pos.x, t.pos.y, t.pos.z, this.speed, 1);
  }
  canContinue() {
    const m = this.mob, t = m.target;
    if (!t || !t.alive()) return false;
    if (!this.evenUnseen) return !m.nav.isDone();
    return !(t.isPlayer && t.creative());
  }
  start() { this.repath = 0; this.cool = 0; this.mob.aggressive = true; this.ticks = 0; }
  stop() { const m = this.mob; m.aggressive = false; m.nav.stop(); if (m.target && !m.target.alive()) m.target = null; }
  tick() {
    const m = this.mob, t = m.target;
    if (!t) return;
    this.ticks++;
    m.lookAtEntity(t, 30, 30);
    const d2 = m.dist2(t.pos.x, t.pos.y, t.pos.z);
    this.repath = Math.max(this.repath - 1, 0);
    // a new path every so often, less often the further away it is
    if ((this.evenUnseen || m.canSee(t)) && this.repath <= 0 && (R() < 0.05 || m.nav.isDone() || Math.abs(t.pos.x - this.lx) + Math.abs(t.pos.z - this.lz) > 1 || this.lx === undefined)) {
      this.lx = t.pos.x; this.lz = t.pos.z;
      this.repath = 4 + RI(7);
      if (d2 > 1024) this.repath += 10; else if (d2 > 256) this.repath += 5;
      if (!m.nav.moveTo(t.pos.x, t.pos.y, t.pos.z, this.speed, 0.5)) this.repath += 15;
    }
    this.cool = Math.max(this.cool - 1, 0);
    if (d2 <= m.attackReach2(t) && this.cool <= 0 && m.canSee(t)) {
      this.cool = 20;
      m.doHurtTarget(t);
    }
  }
}

/* ---- a skeleton's bow: draw for 20 ticks, shoot, strafe ---- */
export class BowAttackGoal extends Goal {
  constructor(mob, speed, range = 15) { super(mob, MOVE | LOOK); this.speed = speed; this.range2 = range * range; }
  interval() { return this.mob.m.difficulty === 'hard' ? 20 : 40; }
  canUse() { const t = this.mob.target; return !!t && t.alive(); }
  start() { this.seen = 0; this.cool = -1; this.drawT = 0; this.strafeT = -1; this.back = false; this.cw = false; this.mob.aggressive = true; }
  stop() { const m = this.mob; m.aggressive = false; m.aiming = false; this.seen = 0; this.drawT = 0; m.nav.stop(); }
  tick() {
    const m = this.mob, t = m.target;
    if (!t) return;
    const d2 = m.dist2(t.pos.x, t.pos.y, t.pos.z), sees = m.canSee(t);
    if (sees !== this.seen > 0) this.seen = 0;
    this.seen += sees ? 1 : -1;
    if (d2 <= this.range2 && this.seen >= 20) { m.nav.stop(); this.strafeT++; }
    else { if (m.age % 10 === 0 || m.nav.isDone()) m.nav.moveTo(t.pos.x, t.pos.y, t.pos.z, this.speed, 1); this.strafeT = -1; }
    if (this.strafeT >= 20) {
      if (R() < 0.3) this.cw = !this.cw;
      if (R() < 0.3) this.back = !this.back;
      this.strafeT = 0;
    }
    if (this.strafeT > -1) {
      if (d2 > this.range2 * 0.75) this.back = false; else if (d2 < this.range2 * 0.25) this.back = true;
      m.strafe(this.back ? -0.5 : 0.5, this.cw ? 0.5 : -0.5);
      m.lookAtEntity(t, 30, 30);
    } else m.lookAtEntity(t, 30, 30);
    if (m.aiming) {
      if (!sees && this.seen < -60) { m.aiming = false; this.drawT = 0; }
      else if (sees && ++this.drawT >= 20) {
        m.aiming = false; this.drawT = 0;
        m.shootAt(t, 1);
        this.cool = this.interval();
      }
    } else if (--this.cool <= 0 && this.seen >= -60) { m.aiming = true; this.drawT = 0; }
  }
}

/* ---- the creeper's fuse ---- */
export class SwellGoal extends Goal {
  constructor(mob) { super(mob, MOVE); }
  canUse() { const m = this.mob, t = m.target; return m.swellDir > 0 || (t && t.alive() && m.dist2(t.pos.x, t.pos.y, t.pos.z) < 9); }
  start() { this.mob.nav.stop(); }
  stop() { this.mob.swellDir = -1; }
  tick() {
    const m = this.mob, t = m.target;
    if (!t || !t.alive()) m.swellDir = -1;
    else if (m.dist2(t.pos.x, t.pos.y, t.pos.z) > 49) m.swellDir = -1;
    else if (!m.canSee(t)) m.swellDir = -1;
    else m.swellDir = 1;
  }
}

/* ---- a spider's pounce ---- */
export class LeapGoal extends Goal {
  constructor(mob, up) { super(mob, JUMP | MOVE); this.up = up; }
  canUse() {
    const m = this.mob, t = m.target;
    if (!t || !m.onGround) return false;
    const d2 = m.dist2(t.pos.x, t.pos.y, t.pos.z);
    return d2 >= 4 && d2 <= 16 && RI(5) === 0;
  }
  canContinue() { return !this.mob.onGround; }
  start() {
    const m = this.mob, t = m.target, v = m.vel;
    let dx = t.pos.x - m.pos.x, dz = t.pos.z - m.pos.z;
    const l = Math.hypot(dx, dz);
    if (l > 1e-4) { dx = dx / l * 0.4 + v.x * 0.2; dz = dz / l * 0.4 + v.z * 0.2; } else { dx = v.x; dz = v.z; }
    v.x = dx; v.z = dz; v.y = this.up;
  }
}

/* ---- running from something (creepers from cats, skeletons from wolves...) ---- */
export class AvoidGoal extends Goal {
  constructor(mob, test, dist, walk, sprint) { super(mob, MOVE); this.test = test; this.dist = dist; this.walk = walk; this.sprint = sprint; }
  canUse() {
    const m = this.mob;
    this.from = m.m.nearest(m, this.dist, this.test);
    if (!this.from) return false;
    const p = posAway(m, 16, 7, this.from.pos);
    if (!p) return false;
    if (this.from.dist2(p[0], p[1], p[2]) < this.from.dist2(m.pos.x, m.pos.y, m.pos.z)) return false;
    this.p = p;
    return true;
  }
  start() { this.mob.nav.moveTo(this.p[0], this.p[1], this.p[2], this.walk, 0.5); }
  canContinue() { return !this.mob.nav.isDone(); }
  tick() { this.mob.nav.speed = this.mob.distTo(this.from) < 7 ? this.sprint : this.walk; }
}

/* ---- picking a target ---- */
export class NearestPlayerTargetGoal extends Goal {
  constructor(mob, mustSee = true, test) { super(mob, TARGET); this.mustSee = mustSee; this.test = test; this.unseen = 0; }
  range() { return this.mob.constructor.FOLLOW || 16; }
  canUse() {
    const m = this.mob;
    if (RI(10) !== 0) return false;
    const p = m.m.player;
    if (!p || !p.alive() || p.creative() || m.m.difficulty === 'peaceful') return false;
    if (this.test && !this.test(p)) return false;
    let r = this.range();
    // sneaking halves how far mobs notice you; a mob head would too
    if (p.sneaking()) r *= 0.8;
    if (m.dist2(p.pos.x, p.pos.y + 0.9, p.pos.z) > r * r) return false;
    if (this.mustSee && !m.canSee(p)) return false;
    return true;
  }
  start() { this.mob.target = this.mob.m.player; this.unseen = 0; }
  canContinue() {
    const m = this.mob, t = m.target;
    if (!t || !t.alive() || (t.isPlayer && t.creative()) || m.m.difficulty === 'peaceful' && m.constructor.HOSTILE) return false;
    if (this.test && !this.test(t)) return false;
    const r = this.range();
    if (m.dist2(t.pos.x, t.pos.y, t.pos.z) > r * r) return false;
    if (this.mustSee) { if (m.canSee(t)) this.unseen = 0; else if (++this.unseen > 60) return false; }
    return true;
  }
  stop() { this.mob.target = null; }
}
export class HurtByTargetGoal extends Goal {
  constructor(mob, alertOthers) { super(mob, TARGET); this.alert = alertOthers; this.seen = null; }
  canUse() {
    const m = this.mob, a = m.lastHurtBy;
    if (!a || a === this.seen || !a.alive || !a.alive()) return false;
    if (a.isPlayer && a.creative()) return false;
    return true;
  }
  start() {
    const m = this.mob;
    m.target = m.lastHurtBy; this.seen = m.lastHurtBy;
    if (this.alert) for (const o of m.m.near(m.pos.x, m.pos.y, m.pos.z, m.constructor.FOLLOW || 16)) {
      if (o !== m && o.type === m.type && !o.target && o.targets) o.target = m.lastHurtBy;
    }
    this.unseen = 0;
  }
  canContinue() {
    const m = this.mob, t = m.target;
    if (!t || !t.alive() || (t.isPlayer && t.creative())) return false;
    const r = m.constructor.FOLLOW || 16;
    if (m.dist2(t.pos.x, t.pos.y, t.pos.z) > r * r) return false;
    if (m.canSee(t)) this.unseen = 0; else if (++this.unseen > 60) return false;
    return true;
  }
  stop() { this.mob.target = null; }
}

/* ---- swimming about (fish, squid) ---- */
export class SwimGoal extends Goal {
  constructor(mob, speed, interval = 40) { super(mob, MOVE); this.speed = speed; this.interval = interval; }
  canUse() {
    const m = this.mob;
    if (!m.inWater || RI(this.interval) !== 0) return false;
    const T = m.m.t;
    for (let i = 0; i < 10; i++) {
      const x = Math.floor(m.pos.x) + RI(21) - 10, y = Math.floor(m.pos.y) + RI(9) - 4, z = Math.floor(m.pos.z) + RI(21) - 10;
      if (FLUID[T.get(x, y, z)] === 1 && FLUID[T.get(x, y + Math.ceil(m.h) - 1, z)] === 1) { this.p = [x + 0.5, y + 0.2, z + 0.5]; return true; }
    }
    return false;
  }
  start() { this.t = 100; }
  canContinue() { const m = this.mob; return this.t > 0 && m.inWater && m.dist2(this.p[0], this.p[1], this.p[2]) > 1; }
  tick() { this.t--; const m = this.mob; m.swimTo(this.p[0], this.p[1], this.p[2], this.speed); }
  stop() { this.mob.swimStop && this.mob.swimStop(); }
}

/* ---- going after another kind of mob (zombies after villagers, golems after monsters) ---- */
export class NearestMobTargetGoal extends Goal {
  constructor(mob, test, mustSee = true, chance = 10) { super(mob, TARGET); this.test = test; this.mustSee = mustSee; this.chance = chance; }
  range() { return this.mob.constructor.FOLLOW || 16; }
  canUse() {
    const m = this.mob;
    if (RI(this.chance) !== 0) return false;
    const r = this.range();
    const t = m.m.nearest(m, r, e => e !== m && !e.dead && !e.removed && this.test(e) && (!this.mustSee || m.canSee(e)));
    if (!t) return false;
    this.t = t;
    return true;
  }
  start() { this.mob.target = this.t; this.unseen = 0; }
  canContinue() {
    const m = this.mob, t = m.target;
    if (!t || t.dead || t.removed || !t.alive()) return false;
    const r = this.range();
    if (m.dist2(t.pos.x, t.pos.y, t.pos.z) > r * r) return false;
    if (this.mustSee) { if (m.canSee(t)) this.unseen = 0; else if (++this.unseen > 60) return false; }
    return true;
  }
  stop() { this.mob.target = null; }
}
