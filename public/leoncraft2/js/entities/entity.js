/* ---------------------------------------------------------------------------
   Leoncraft 2 - entities: anything in the world that is not a block.

   Entity      a box with a position and a velocity, moved 20 times a second
               with the game's physics: gravity 0.08 a tick then 0.98 drag
               up and down, 0.91 drag across in the air and the block's
               slipperiness x 0.91 on the ground (0.546 on most blocks),
               water drag 0.8 and lava 0.5 with gravity cut to a sixteenth
               and a quarter, the same collision and 0.6 step as the player.
               Drawn between ticks (prev -> pos by the frame's alpha).
   Living      health; hurt with the game's 10 tick window (a second hit in
               it only counts for what it adds over the first), the red
               flash, knockback 0.4 away from the attacker, fall damage past
               3 blocks, drowning, burning, death: falling over for 20 ticks,
               a puff of smoke, loot and experience.
   Mob         a Living with a mind: goals picked by priority (ai.js), a path
               to follow (path.js), and the game's move, look, jump and body
               controls turning that into walking.

   Yaw here is the player's: 0 faces -z, and the way ahead is
   (-sin yaw, -cos yaw).
--------------------------------------------------------------------------- */
import { BLOCKS, FLUID, B } from '../blocks.js?v=107';
const THREE = window.THREE;

export const DEG = Math.PI / 180;
/* a facing brought round towards another over a few ticks: small changes at once (10
   degrees or less), a share of a big one, never more than 40 degrees a tick */
export function easeYaw(from, to) {
  const d = wrap(to - from), ad = Math.abs(d);
  const step = Math.min(40 * DEG, Math.max(10 * DEG, ad * 0.4));
  return ad <= step ? to : from + Math.sign(d) * step;
}
export const wrap = a => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
// turn from a towards b by no more than max
export const rotTowards = (a, b, max) => { const d = wrap(b - a); return a + Math.max(-max, Math.min(max, d)); };
export const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
/* Looting on a loot table entry (the game's enchanted_count_increase): the share of
   a whole item a level (k, mostly 1) times the level, a random part of it, rounded.
   So one level adds 0 or 1 (even odds), three add 0 to 3, half a level on average.
   A base count below one (spider eyes and wither skeleton coal uniform(-1, 1), magma cream uniform(-2, 1)) counts
   as 0 before Looting: 26.1.2's ItemStack.grow adds to getCount(), which is 0 for an empty stack, so the loot
   functions' (RI(3) === 0 ? 1 : 0) + looted(L) is the game's own odds. */
export const looted = (level, k = 1) => (level > 0 ? Math.round(level * k * Math.random()) : 0);

let NEXT_ID = 1;
const WATERLOGGED = new Uint8Array(4096);
for (const d of BLOCKS) if (d && d.waterlogged) WATERLOGGED[d.id] = 1;
// 1 cactus, 2 sweet berry bush, 3 fire, 4 magma
const TOUCH = new Uint8Array(4096);
for (const d of BLOCKS) if (d) TOUCH[d.id] = d.name === 'cactus' ? 1 : d.name === 'sweet_berry_bush' ? 2 : (d.name === 'fire' || d.name === 'soul_fire') ? 3 : d.name === 'magma_block' ? 4 : 0;

export class Entity {
  constructor(m, type) {
    this.m = m;                       // the manager (manager.js)
    this.type = type;
    this.id = NEXT_ID++;
    this.pos = new THREE.Vector3(); this.prev = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yaw = 0; this.prevYaw = 0; this.pitch = 0; this.prevPitch = 0;
    const d = this.constructor;
    this.w = d.W || 0.6; this.h = d.H || 1.8; this.hw = this.w / 2;
    this.stepH = d.STEP !== undefined ? d.STEP : 0.6;
    this.gravity = 0.08;
    this.onGround = false; this.hCollide = false; this.vCollide = false;
    this.inWater = false; this.inLava = false; this.eyeInWater = false; this.waterDepth = 0;
    this.fallDist = 0; this.age = 0; this.removed = false;
    this.fire = 0;                    // ticks left burning
    this.vehicle = null; this.passengers = [];
    this.noPhysics = false; this.persistent = false;
    this.cell = -1;                   // its place in the spatial grid
  }
  get eyeH() { return this.h * 0.85; }
  setPos(x, y, z) { this.pos.set(x, y, z); this.prev.set(x, y, z); return this; }
  // the box, as [x0, y0, z0, x1, y1, z1]
  box(out) { const p = this.pos; out[0] = p.x - this.hw; out[1] = p.y; out[2] = p.z - this.hw; out[3] = p.x + this.hw; out[4] = p.y + this.h; out[5] = p.z + this.hw; return out; }
  dist2(x, y, z) { const dx = this.pos.x - x, dy = this.pos.y - y, dz = this.pos.z - z; return dx * dx + dy * dy + dz * dz; }
  distTo(e) { return Math.sqrt(this.dist2(e.pos.x, e.pos.y, e.pos.z)); }
  remove() { this.removed = true; }
  /* 64 below the dimension's floor (manager.js checks every entity each tick):
     anything but a living thing is simply gone, as in the game */
  belowWorld() { this.remove(); }
  // the start of every tick: where it was, and what it is standing in
  baseTick() {
    this.prev.copy(this.pos); this.prevYaw = this.yaw; this.prevPitch = this.pitch;
    this.age++;
    const T = this.m.t, p = this.pos;
    const wasIn = this.inWater;
    if (this.nearFluid()) {
      this.waterDepth = T.fluidDepth(p.x - this.hw + 0.001, p.y + 0.001, p.z - this.hw + 0.001, p.x + this.hw - 0.001, p.y + this.h - 0.001, p.z + this.hw - 0.001, 1);
      this.inWater = this.waterDepth > 0;
      this.inLava = T.boxFluid(p.x - this.hw + 0.001, p.y + 0.001, p.z - this.hw + 0.001, p.x + this.hw - 0.001, p.y + this.h - 0.001, p.z + this.hw - 0.001, 2);
    } else { this.waterDepth = 0; this.inWater = false; this.inLava = false; }
    const ey = p.y + this.eyeH;
    const eb = T.get(Math.floor(p.x), Math.floor(ey), Math.floor(p.z));
    this.eyeInWater = (FLUID[eb] === 1 && ey < Math.floor(ey) + T.fluidHeight(Math.floor(p.x), Math.floor(ey), Math.floor(p.z))) || !!(BLOCKS[eb] && BLOCKS[eb].waterlogged);
    if (this.inWater && !wasIn && this.vel.y < -0.2 && this.m.hooks.onSplash) this.m.hooks.onSplash(p.x, p.z, Math.min(1.4, -this.vel.y * 3));
    if (this.inWater) { this.fallDist = 0; if (this.fire > 0) this.fire = 0; }
    if (this.inLava) { this.fallDist *= 0.5; this.lavaHurt(); }
    if (this.fire > 0) this.burnTick();
    if (this.age % 2 === 0) this.touchBlocks();
  }
  // any water, lava or waterlogged block at the corners of the box, from the feet to the head? (a cheap test first)
  nearFluid() {
    const T = this.m.t, p = this.pos, hw = this.hw;
    const x0 = Math.floor(p.x - hw), x1 = Math.floor(p.x + hw), z0 = Math.floor(p.z - hw), z1 = Math.floor(p.z + hw);
    const y0 = Math.floor(p.y), y1 = Math.floor(p.y + this.h);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const b = T.get(x, y, z);
      if (b && (FLUID[b] || WATERLOGGED[b])) return true;
    }
    return false;
  }
  // blocks that hurt to touch: cactus, berry bushes, fire, standing on magma
  touchBlocks() {
    if (!this.maxHealth || this.dead) return;
    const T = this.m.t, p = this.pos, hw = this.hw + 0.07;
    const x0 = Math.floor(p.x - hw), x1 = Math.floor(p.x + hw), z0 = Math.floor(p.z - hw), z1 = Math.floor(p.z + hw);
    const y0 = Math.floor(p.y - 0.01), y1 = Math.floor(p.y + this.h - 0.01);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const k = TOUCH[T.get(x, y, z)];
      if (!k) continue;
      if (k === 1) this.hurt(1, { type: 'cactus' });
      else if (k === 2 && y >= Math.floor(p.y) && (Math.abs(this.vel.x) > 0.003 || Math.abs(this.vel.z) > 0.003) && !this.constructor.BERRY_SAFE) { this.hurt(1, { type: 'berry' }); this.vel.x *= 0.8; this.vel.z *= 0.75; }
      else if (k === 3 && y >= Math.floor(p.y)) { if (this.setFire) this.setFire(8); this.hurt(1, { type: 'fire' }); }
      else if (k === 4 && y === Math.floor(p.y - 0.01) && y < p.y && !this.constructor.FIRE_IMMUNE) this.hurt(1, { type: 'magma' });
    }
  }
  lavaHurt() {}
  burnTick() { this.fire--; }
  /* the game's physics for something with no legs of its own (an item, a
     boat sets its own, a mob goes through Living.travel) */
  tick() {
    this.baseTick();
    if (this.noPhysics) return;
    const v = this.vel;
    v.y -= this.gravity;
    this.move(v.x, v.y, v.z);
    const f = this.onGround ? this.m.t.slip(Math.floor(this.pos.x), Math.floor(this.pos.y - 0.5), Math.floor(this.pos.z)) * 0.98 : 0.98;
    v.x *= f; v.z *= f; v.y *= 0.98;
    if (this.onGround) v.y *= -0.5;
  }
  // a move through the world, with fall distance kept as the game does
  move(dx, dy, dz) {
    const wasGround = this.onGround, oy = this.pos.y;
    this.m.t.move(this, dx, dy, dz);
    const my = this.pos.y - oy;
    if (this.onGround) {
      if (this.fallDist > 0) this.landed(this.fallDist, wasGround);
      this.fallDist = 0;
    } else if (my < 0) this.fallDist -= my;
  }
  landed() {}
  hurt() { return false; }
  isAlive() { return !this.removed; }
  alive() { return !this.removed && !this.dead; }
  // what the rider sits on, relative to the feet
  ridingOffset() { return this.h * 0.75; }
  // saving
  toJSON() { return { t: this.type, p: [r3(this.pos.x), r3(this.pos.y), r3(this.pos.z)], v: [r3(this.vel.x), r3(this.vel.y), r3(this.vel.z)], y: r3(this.yaw), f: this.fire || undefined }; }
  fromJSON(o) { this.setPos(o.p[0], o.p[1], o.p[2]); if (o.v) this.vel.set(o.v[0], o.v[1], o.v[2]); this.yaw = this.prevYaw = o.y || 0; this.fire = o.f || 0; }
}
export const r3 = v => Math.round(v * 1000) / 1000;

/* ---------------------------------------------------------------------------
   Living things
--------------------------------------------------------------------------- */
export class Living extends Entity {
  constructor(m, type) {
    super(m, type);
    const d = this.constructor;
    this.maxHealth = d.HEALTH || 20;
    this.health = this.maxHealth;
    this.speed = d.SPEED || 0.25;     // the movement speed attribute
    this.attackDamage = d.ATTACK || 0;
    this.kbResist = d.KB_RESIST || 0;
    this.hurtTime = 0; this.invul = 0; this.lastHurt = 0;
    this.deathTime = 0; this.dead = false;
    this.air = 300;
    this.bodyYaw = 0; this.prevBodyYaw = 0; this.headYaw = 0; this.prevHeadYaw = 0;
    this.zza = 0; this.xxa = 0; this.jumping = false; this.jumpDelay = 0;
    this.walk = 0; this.prevWalk = 0; this.walkAmt = 0; this.prevWalkAmt = 0;
    this.swingT = 0; this.prevSwing = 0; this.swinging = false;
    this.lastHurtBy = null; this.lastHurtByTime = 0;
    this.noActionTime = 0;
    this.climbing = false;
    this.armor = 0;                   // armour points, for mobs wearing some
    this.helmet = false;
  }
  // the living take the void's 4, through the hurt window: 4 every half second until they die
  belowWorld() { this.hurt(4, { type: 'void' }); }
  baseTick() {
    this.prevBodyYaw = this.bodyYaw; this.prevHeadYaw = this.headYaw;
    super.baseTick();
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.invul > 0) this.invul--;
    if (this.dead) return;
    // breath, for those that need air
    if (!this.constructor.WATER_BREATHER && this.eyeInWater) {
      if (--this.air <= -20) { this.air = 0; this.hurt(2, { type: 'drown' }); }
    } else if (this.constructor.WATER_BREATHER === 'only' && !this.inWater) {
      if (--this.air <= -20) { this.air = 0; this.hurt(2, { type: 'dry' }); }
    } else this.air = Math.min(300, this.air + 4);
    if (this.lastHurtByTime > 0 && --this.lastHurtByTime === 0) this.lastHurtBy = null;
  }
  lavaHurt() { if (!this.constructor.FIRE_IMMUNE) { this.setFire(15); this.hurt(4, { type: 'lava' }); } }
  setFire(seconds) { if (this.constructor.FIRE_IMMUNE) return; this.fire = Math.max(this.fire, seconds * 20); }
  // a point of fire damage on every 20th tick left, counted before the tick goes (so a hit that set it alight takes the first in its window)
  burnTick() {
    if (this.fire % 20 === 0 && !this.constructor.FIRE_IMMUNE) this.hurt(1, { type: 'fire' });
    this.fire--;
  }
  landed(dist) {
    const n = Math.ceil(dist - 3 - (this.constructor.SAFE_FALL || 0));
    if (n > 0 && !this.constructor.NO_FALL) this.hurt(n, { type: 'fall' });
  }

  /* ---- being hurt ----
     source: { type, attacker (an entity, or the player), x, z (where it came
     from), noKnock } */
  hurt(amount, source) {
    if (this.dead || this.removed || amount <= 0) return false;
    if (this.m.difficulty === 'peaceful' && this.constructor.HOSTILE && source.type !== 'void' && !source.player) { /* still hurtable by the player */ }
    if (source.type === 'fire' && this.constructor.FIRE_IMMUNE) return false;
    // the 10 tick window, on the hit as it comes (armour then takes its share of what counts)
    let full = true;
    if (this.invul > 10) {
      if (amount <= this.lastHurt) return false;
      const extra = amount - this.lastHurt;
      this.lastHurt = amount;
      amount = extra;
      full = false;
    } else {
      this.lastHurt = amount;
      this.invul = 20;
      this.hurtTime = 10;
    }
    /* armour, the game's formula: max(points / 5, points - 4 x damage / (toughness + 8)),
       at most 20, takes 4% a point (a zombie's natural 2 takes 1.6% off a 6 point hit);
       a mace's Breach takes 15 percentage points a level off what it stops */
    if (this.armor > 0 && source.type !== 'fall' && source.type !== 'drown' && source.type !== 'void' && source.type !== 'fire' && source.type !== 'magic') {
      const f = Math.min(20, Math.max(this.armor / 5, this.armor - 4 * amount / ((this.toughness || 0) + 8))) / 25;
      amount = amount * (1 - Math.max(0, f - 0.15 * (source.breach || 0)));
    }
    this.health -= amount;
    if (source.attacker) { this.lastHurtBy = source.attacker; this.lastHurtByTime = 100; }
    // pushed away from where it came from
    if (full && !source.noKnock && source.x !== undefined) {
      let dx = source.x - this.pos.x, dz = source.z - this.pos.z;
      if (dx * dx + dz * dz < 1e-4) { dx = (Math.random() - Math.random()) * 0.01; dz = (Math.random() - Math.random()) * 0.01; }
      this.knockback(0.4, dx, dz);
    }
    this.onHurt(amount, source);
    if (this.health <= 0) this.die(source);
    return true;
  }
  onHurt() {}
  /* The game's knockback: half the speed it had, plus strength away from
     (dx, dz) across, and up to 0.4 upwards if it was on the ground. */
  knockback(strength, dx, dz) {
    strength *= 1 - this.kbResist;
    if (strength <= 0) return;
    const l = Math.hypot(dx, dz) || 1;
    const v = this.vel;
    v.x = v.x / 2 - dx / l * strength;
    v.z = v.z / 2 - dz / l * strength;
    if (this.onGround) v.y = Math.min(0.4, v.y / 2 + strength);
  }
  heal(n) { if (!this.dead) this.health = Math.min(this.maxHealth, this.health + n); }
  die(source) {
    if (this.dead) return;
    this.dead = true; this.health = 0; this.deathTime = 0;
    this.killedBy = source;
    this.m.onDeath(this, source);
  }
  // after death: fall over for 20 ticks, then the puff and the experience
  deadTick() {
    this.deathTime++;
    this.zza = this.xxa = 0; this.jumping = false;
    this.travel();
    // (RIP Computer: the body stays lying a while instead of the puff: manager.js corpse)
    if (this.deathTime >= 20) { if (!(this.m.corpse && this.m.corpse(this))) this.m.poof(this); this.m.dropXp(this); this.remove(); }
  }
  // the arm swing, 6 ticks
  swing() { if (!this.swinging || this.swingT >= 3 || this.swingT < 0) { this.swingT = -1; this.swinging = true; } }
  swingTick() {
    this.prevSwing = this.swingT / 6;
    if (this.swinging) { if (++this.swingT >= 6) { this.swingT = 0; this.swinging = false; } } else this.swingT = 0;
  }

  tick() {
    this.baseTick();
    if (this.removed) return;
    if (this.dead) { this.deadTick(); this.animTick(); return; }
    this.aiStep();
    /* the body control comes after the move, as in the game: whether it is walking is
       where it is now against where it was when the tick began. (Run inside serverAi,
       before the move, it never saw a step, so a mob walked on with its body still facing
       wherever it last stood: sideways, or backwards.) */
    if (this.bodyDue) { this.bodyDue = false; this.bodyControl(); }
    this.animTick();
  }
  aiStep() {
    if (this.jumpDelay > 0) this.jumpDelay--;
    const v = this.vel;
    if (Math.abs(v.x) < 0.003) v.x = 0;
    if (Math.abs(v.y) < 0.003) v.y = 0;
    if (Math.abs(v.z) < 0.003) v.z = 0;
    this.serverAi();
    if (this.jumping) {
      if (this.inWater && this.waterDepth > 0.4 * this.h * 0 + (this.h < 0.8 ? 0.2 : 0.4) || this.inLava) v.y += 0.04;
      else if (this.onGround && this.jumpDelay === 0) { this.jumpFromGround(); this.jumpDelay = 10; }
      else if (this.inWater) v.y += 0.04;
    } else this.jumpDelay = 0;
    // a rider's keys are a full step of input; the mob's own input is damped (the game's 0.98)
    if (!this.ridden) { this.xxa *= 0.98; this.zza *= 0.98; }
    this.ridden = false;
    this.travel();
    this.m.pushOthers(this);
  }
  serverAi() {}
  jumpFromGround() { this.vel.y = 0.42 * (this.constructor.JUMP || 1); this.onGround = false; }
  /* ---- moving itself ----
     xxa / zza: sideways and forward input, already times the speed
     (that is the game's: a mob's forward input is its speed). */
  travel() {
    const v = this.vel, T = this.m.t, p = this.pos;
    if (this.inWater && !this.constructor.FLYING) {
      const y0 = p.y;
      const f = this.constructor.WATER_SPEED || 0.02;
      this.moveRelative(f, this.xxa, this.zza);
      this.move(v.x, v.y, v.z);
      const drag = this.constructor.WATER_DRAG || 0.8;
      v.x *= drag; v.y *= 0.8; v.z *= drag;
      v.y -= this.gravity / 16 * (this.constructor.WATER_BREATHER === 'only' ? 0 : 1);
      // climbing out at the bank
      if (this.hCollide && this.bankFree(v.x, v.y + 0.6 - (p.y - y0), v.z)) v.y = 0.3;
    } else if (this.inLava && !this.constructor.FLYING) {
      this.moveRelative(0.02, this.xxa, this.zza);
      this.move(v.x, v.y, v.z);
      v.x *= 0.5; v.y *= 0.5; v.z *= 0.5;
      v.y -= this.gravity / 4;
      if (this.hCollide && this.bankFree(v.x, v.y + 0.6, v.z)) v.y = 0.3;
    } else if (this.constructor.FLYING) {
      this.moveRelative(this.onGround ? 0.1 * this.speed / 0.25 : 0.02, this.xxa, this.zza);
      this.move(v.x, v.y, v.z);
      v.multiplyScalar(0.91);
    } else {
      const slip = this.onGround ? T.slip(Math.floor(p.x), Math.floor(p.y - 0.5), Math.floor(p.z)) : 1;
      const f = this.onGround ? slip * 0.91 : 0.91;
      const sp = this.onGround ? this.zzaScale() * (0.21600002 / (slip * slip * slip)) : 0.02;
      this.moveRelative(sp, this.xxa, this.zza);
      // ladders and the spider's walls
      if (this.onClimbable()) { v.x = Math.max(-0.15, Math.min(0.15, v.x)); v.z = Math.max(-0.15, Math.min(0.15, v.z)); v.y = Math.max(v.y, -0.15); }
      this.move(v.x, v.y, v.z);
      if ((this.hCollide || this.jumping) && this.onClimbable()) v.y = 0.2;
      v.y -= this.gravity;
      v.y *= 0.98;
      v.x *= f; v.z *= f;
    }
  }
  // would the box moved this far be clear of blocks and fluid (climbing out at a bank)?
  bankFree(dx, dy, dz) {
    const p = this.pos, T = this.m.t;
    const x0 = p.x - this.hw + dx, y0 = p.y + dy, z0 = p.z - this.hw + dz, x1 = p.x + this.hw + dx, y1 = p.y + this.h + dy, z1 = p.z + this.hw + dz;
    return !T.boxHits(x0, y0, z0, x1, y1, z1) && !T.boxFluid(x0, y0, z0, x1, y1, z1, 1) && !T.boxFluid(x0, y0, z0, x1, y1, z1, 2);
  }
  // the speed a step of input is worth (Mob overrides with its attribute)
  zzaScale() { return 1; }
  /* input to velocity, turned by the yaw: z is forward, x is to the left
     (the game's xxa: A is +1) */
  moveRelative(amount, x, z) {
    let l = x * x + z * z;
    if (l < 1e-7) return;
    l = Math.sqrt(l);
    if (l > 1) { x /= l; z /= l; }
    x *= amount; z *= amount;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    this.vel.x += -s * z - c * x;
    this.vel.z += -c * z + s * x;
  }
  onClimbable() {
    const b = this.m.t.get(Math.floor(this.pos.x), Math.floor(this.pos.y), Math.floor(this.pos.z));
    const d = BLOCKS[b];
    return !!(d && (d.name === 'ladder' || d.name === 'vine' || /^(weeping|twisting)_vines|cave_vines|scaffolding/.test(d.name))) || (this.constructor.CLIMBS && this.climbing);
  }
  // how far the legs swing this tick (the game's walk animation)
  animTick() {
    this.swingTick();
    this.prevWalk = this.walk; this.prevWalkAmt = this.walkAmt;
    const dx = this.pos.x - this.prev.x, dz = this.pos.z - this.prev.z;
    const dy = this.constructor.FLYING || this.constructor.WATER_BREATHER === 'only' ? this.pos.y - this.prev.y : 0;
    const f = Math.min(1, Math.sqrt(dx * dx + dz * dz + dy * dy) * 4);
    this.walkAmt += (f - this.walkAmt) * 0.4;
    this.walk += this.walkAmt;
  }
  toJSON() {
    const o = super.toJSON(); o.h = r3(this.health); if (this.persistent) o.pp = 1;
    // the body's and head's own turns (a mob standing about keeps its body where its head took it, away from yaw,
    // the way it last walked: loaded with both set to yaw, it swung round up to 180 degrees in one frame)
    if (this.bodyYaw !== undefined && Math.abs(this.bodyYaw - this.yaw) > 1e-3) o.by = r3(this.bodyYaw);
    if (this.headYaw !== undefined && Math.abs(this.headYaw - this.yaw) > 1e-3) o.hy = r3(this.headYaw);
    if (this.maxHealth !== (this.constructor.HEALTH || 20)) o.mh = this.maxHealth;
    if (this.customName) o.cn = this.customName;
    if (this.equip && Object.keys(this.equip).length) o.eq = this.equip;
    // the armour points what it wears gives it (a zombie in a helmet, a piglin in gold)
    if (this.armor) o.ar = this.armor; if (this.toughness) o.at = this.toughness;
    return o;
  }
  fromJSON(o) {
    super.fromJSON(o); if (o.mh) this.maxHealth = o.mh; if (o.h !== undefined) this.health = o.h;
    this.bodyYaw = this.prevBodyYaw = o.by !== undefined ? o.by : this.yaw; this.headYaw = this.prevHeadYaw = o.hy !== undefined ? o.hy : this.yaw; this.persistent = !!o.pp;
    if (o.cn) this.customName = o.cn;
    if (o.eq && this.equip) Object.assign(this.equip, o.eq);
    if (o.ar !== undefined) this.armor = o.ar; if (o.at) this.toughness = o.at;
  }
}

/* ---------------------------------------------------------------------------
   Mobs: a mind on top
--------------------------------------------------------------------------- */
export class Mob extends Living {
  constructor(m, type) {
    super(m, type);
    this.goals = new GoalSelector();
    this.targets = new GoalSelector();
    this.target = null;               // what it means to attack
    this.nav = null;                  // set by the manager (path.js Navigation)
    // move control
    this.mcOp = 0; this.mcX = 0; this.mcY = 0; this.mcZ = 0; this.mcSpeed = 0;
    this.moveSpeed = 0;               // speed modifier x attribute, while walking
    // look control
    this.lookX = 0; this.lookY = 0; this.lookZ = 0; this.lookHas = 0; this.lookYawMax = 10 * DEG; this.lookPitchMax = 40 * DEG;
    // body control
    this.headStableT = 0; this.lastStableHead = 0;
    this.extra = {};                  // per mob animation state
    /* What it holds and wears, by slot (mainhand, offhand, head, chest,
       legs, feet): item names. Killed by a player, each piece drops 8.5%
       of the time (and 1% more a level of Looting), and each adds 1 to 3 to
       the experience. */
    this.equip = {};
    this.registerGoals();
  }
  registerGoals() {}
  // how much it likes to wander to a spot (the game's walk target value): no preference unless a kind says so
  walkValue() { return 0; }
  holding(name) { return this.equip.mainhand === name || this.equip.offhand === name; }
  equipXp() { let n = 0; for (const k in this.equip) if (this.equip[k]) n += 1 + Math.floor(Math.random() * 3); return n; }
  dropEquipment(drop, byPlayer, looting) {
    for (const k in this.equip) {
      const it = this.equip[k];
      if (!it) continue;
      const ch = this.dropChance && this.dropChance[k] !== undefined ? this.dropChance[k] : 0.085;
      if (ch >= 1 || (byPlayer && Math.random() < ch + 0.01 * (looting || 0))) drop(it, 1);
    }
  }
  zzaScale() { return this.moveSpeedNow || this.speed; }
  serverAi() {
    this.noActionTime++;
    this.m.despawnCheck(this);
    if (this.removed) return;
    // ridden by the player: the rider steers (horses, a pig with a carrot on a stick)
    const rider = this.passengers[0];
    if (rider && rider.isPlayer && this.rideControl && this.rideControl(this.m.P.keys, this.m.P)) {
      this.ridden = true;
      if (this.nav) this.nav.stop();
      this.headYaw = this.bodyYaw = this.yaw;
      return;
    }
    this.targets.tick();
    this.goals.tick();
    if (this.nav) this.nav.tick();
    this.moveControl();
    this.lookControl();
    // (the body turns once the tick's move is made, Living.tick: it goes by how far it got this tick)
    this.bodyDue = true;
  }
  /* ---- the move control: towards a wanted point, turning at most 90
     degrees a tick, jumping when the next step is too high ---- */
  setWanted(x, y, z, speedMod) { this.mcX = x; this.mcY = y; this.mcZ = z; this.mcSpeed = speedMod; if (this.mcOp !== 3) this.mcOp = 1; }
  moveControl() {
    if (this.mcOp === 1) {
      this.mcOp = 0;
      const dx = this.mcX - this.pos.x, dz = this.mcZ - this.pos.z, dy = this.mcY - this.pos.y;
      if (dx * dx + dy * dy + dz * dz < 2.5e-7) { this.zza = 0; return; }
      this.yaw = rotTowards(this.yaw, yawTo(dx, dz), 90 * DEG);
      this.moveSpeedNow = this.mcSpeed * this.speed;
      this.zza = this.moveSpeedNow;
      // a step too high: jump (or a fence's shape in the way)
      const step = Math.max(1, this.w * this.w);
      if ((dy > this.stepH && dx * dx + dz * dz < step) || (this.hCollide && this.onGround && dy > -0.5 && this.blockedAhead())) { this.jumping = true; this.mcOp = 3; }
    } else if (this.mcOp === 3) {
      this.zza = this.moveSpeedNow;
      if (this.onGround) { this.mcOp = 0; this.jumping = false; }
    } else {
      this.zza = 0;
      if (!this.keepJump) this.jumping = false;
    }
    // swimming up: the float goal holds jumping
    if (this.wantFloat) this.jumping = true;
  }
  blockedAhead() {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const x = Math.floor(this.pos.x - s * (this.hw + 0.4)), z = Math.floor(this.pos.z - c * (this.hw + 0.4)), y = Math.floor(this.pos.y + 0.5);
    return this.m.t.solid(x, y, z) && !this.m.t.solid(x, y + 1, z) && !this.m.t.solid(x, y + 2, z);
  }
  stopMoving() { this.mcOp = 0; this.zza = 0; if (this.nav) this.nav.stop(); }
  /* ---- the look control: the head turns towards a point, 10 degrees a tick
     round and 40 up and down; with nothing to look at it comes back to the
     body; never more than 75 degrees off it ---- */
  lookAt(x, y, z, yawMax, pitchMax) { this.lookX = x; this.lookY = y; this.lookZ = z; this.lookHas = 2; this.lookYawMax = (yawMax || 10) * DEG; this.lookPitchMax = (pitchMax || this.maxPitch()) * DEG; }
  lookAtEntity(e, yawMax, pitchMax) { this.lookAt(e.pos.x, e.pos.y + (e.eyeH !== undefined ? e.eyeH : 1.62), e.pos.z, yawMax, pitchMax); }
  maxPitch() { return 40; }
  lookControl() {
    if (this.lookHas > 0) {
      this.lookHas--;
      const dx = this.lookX - this.pos.x, dy = this.lookY - (this.pos.y + this.eyeH), dz = this.lookZ - this.pos.z;
      const hd = Math.sqrt(dx * dx + dz * dz);
      if (hd > 1e-5 || Math.abs(dy) > 1e-5) {
        this.headYaw = rotTowards(this.headYaw, yawTo(dx, dz), this.lookYawMax);
        this.pitch = rotTowards(this.pitch, Math.atan2(dy, hd), this.lookPitchMax);
      }
    } else {
      this.pitch = rotTowards(this.pitch, 0, 10 * DEG);
      this.headYaw = rotTowards(this.headYaw, this.bodyYaw, 10 * DEG);
    }
    const max = this.headMax(), off = wrap(this.headYaw - this.bodyYaw);
    // (with no head of its own, HEAD_MAX 0, it turns all of itself to look, as a happy ghast does)
    if (max === 0) this.bodyYaw = this.headYaw;
    else if (Math.abs(off) > max) this.headYaw = this.bodyYaw + Math.sign(off) * max;
  }
  // how far the head may turn from the body (75 degrees; a ghast's HEAD_MAX 0: it has no head of its own)
  headMax() { const h = this.constructor.HEAD_MAX; return (h === undefined ? 75 : h) * DEG; }
  // for mobs that face the way they move, head and all (fish, slimes, tadpoles, bats, ghasts): eased as below
  followYaw() { this.bodyYaw = this.headYaw = easeYaw(this.bodyYaw, this.yaw); }
  /* ---- the body: follows the way it walks; standing, it keeps within 75
     degrees of the head (its HEAD_MAX) and, after a moment, turns to it ---- */
  bodyControl() {
    const dx = this.pos.x - this.prev.x, dz = this.pos.z - this.prev.z;
    if (dx * dx + dz * dz > 2.5e-7) {
      /* the body comes round to the way it walks over a few ticks, as the game's
         client shows it (it eases a mob's facing over three ticks): setting it at
         once turned a mob that stood looking about 90 to 190 degrees in one tick
         when it set off, and showed every 90-degree turn of the move control */
      this.bodyYaw = easeYaw(this.bodyYaw, this.yaw);
      const off = wrap(this.headYaw - this.bodyYaw), max = this.headMax();
      if (Math.abs(off) > max) this.headYaw = this.bodyYaw + Math.sign(off) * max;
      this.lastStableHead = this.headYaw; this.headStableT = 0;
      return;
    }
    if (Math.abs(wrap(this.headYaw - this.lastStableHead)) > 15 * DEG) {
      this.headStableT = 0; this.lastStableHead = this.headYaw;
      const off = wrap(this.headYaw - this.bodyYaw), max = this.headMax();
      if (Math.abs(off) > max) this.bodyYaw = this.headYaw - Math.sign(off) * max;
    } else if (++this.headStableT > 10) {
      const k = Math.max(0, Math.min(1, (this.headStableT - 10) / 10));
      const max = this.headMax() * (1 - k);
      const off = wrap(this.headYaw - this.bodyYaw);
      if (Math.abs(off) > max) this.bodyYaw = this.headYaw - Math.sign(off) * max;
    }
  }
  // can it see an entity (nothing solid between their eyes)?
  canSee(e) {
    if (!e) return false;
    return this.m.t.sees(this.pos.x, this.pos.y + this.eyeH, this.pos.z, e.pos.x, e.pos.y + (e.eyeH || 1.62), e.pos.z);
  }
  // melee: the game's reach is the mob's width doubled, squared, plus the target's width
  attackReach2(t) { const w = this.w * 2; return w * w + (t.w || 0.6); }
  doHurtTarget(t) {
    const dmg = this.attackDamage;
    this.swing();
    if (t.isPlayer) return this.m.hurtPlayer(dmg, { type: 'mob', attacker: this, x: this.pos.x, z: this.pos.z, knock: this.constructor.ATTACK_KB || 0, yaw: this.yaw });
    const ok = t.hurt(dmg, { type: 'mob', attacker: this, x: this.pos.x, z: this.pos.z });
    if (ok && this.constructor.ATTACK_KB) t.knockback(this.constructor.ATTACK_KB * 0.5, Math.sin(this.yaw), Math.cos(this.yaw));
    return ok;
  }
  onHurt(amount, source) {
    if (source.attacker && source.attacker !== this) this.hurtBy = source.attacker;
  }
}

/* ---------------------------------------------------------------------------
   The goal selector: the game's. Goals have flags (move, look, jump,
   target); each tick, running goals that can no longer go on stop, then
   every idle goal whose flags are free (or held by a lower priority goal
   that may be interrupted) and that can start, starts; then the running
   goals tick. A lower number is a higher priority.
--------------------------------------------------------------------------- */
export const MOVE = 1, LOOK = 2, JUMP = 4, TARGET = 8;
export class GoalSelector {
  constructor() { this.list = []; this.locks = [null, null, null, null]; }
  add(priority, goal) { goal.priority = priority; goal.running = false; this.list.push(goal); this.list.sort((a, b) => a.priority - b.priority); return goal; }
  remove(goal) { if (goal.running) this.stopGoal(goal); this.list.splice(this.list.indexOf(goal), 1); }
  stopGoal(g) {
    g.running = false; g.stop();
    for (let i = 0; i < 4; i++) if (this.locks[i] === g) this.locks[i] = null;
  }
  tick() {
    const L = this.list, locks = this.locks;
    for (let i = 0; i < L.length; i++) { const g = L[i]; if (g.running && !g.canContinue()) this.stopGoal(g); }
    for (let i = 0; i < L.length; i++) {
      const g = L[i];
      if (g.running) continue;
      let free = true;
      for (let k = 0; k < 4; k++) {
        if (!(g.flags & (1 << k))) continue;
        const o = locks[k];
        if (o && (o.priority <= g.priority || !o.interruptable())) { free = false; break; }
      }
      if (!free || !g.canUse()) continue;
      for (let k = 0; k < 4; k++) if (g.flags & (1 << k)) { const o = locks[k]; if (o) this.stopGoal(o); locks[k] = g; }
      g.running = true;
      g.start();
    }
    for (let i = 0; i < L.length; i++) { const g = L[i]; if (g.running) g.tick(); }
  }
  stopAll() { for (const g of this.list) if (g.running) this.stopGoal(g); }
}
export class Goal {
  constructor(mob, flags) { this.mob = mob; this.flags = flags || 0; }
  canUse() { return false; }
  canContinue() { return this.canUse(); }
  interruptable() { return true; }
  start() {} stop() {} tick() {}
}
