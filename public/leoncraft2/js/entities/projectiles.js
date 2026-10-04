/* ---------------------------------------------------------------------------
   Leoncraft 2 - things that fly: arrows, eggs, snowballs, thrown potions.

   An arrow moves by its velocity, then slows by 0.99 a tick (0.6 in water)
   and falls 0.05; it hits the first block or mob along its path that tick.
   Damage is the speed it hits at times its base damage (2), rounded up, so
   a skeleton's arrow does 1 to 4 (5 on Hard) depending on how far it flew;
   a critical arrow adds a random amount. Stuck in a block it stays for a
   minute (1200 ticks). Thrown things fall 0.03 a tick and drag 0.99.
--------------------------------------------------------------------------- */
import { Entity, r3 } from './entity.js?v=9';
import { rayBox } from './terrain.js?v=9';
import { register } from './mobs.js?v=9';
import { FLUID } from '../blocks.js?v=9';

const R = () => Math.random();
const gauss = () => { let u = 0, v = 0; while (!u) u = R(); while (!v) v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

export class Projectile extends Entity {
  static W = 0.25; static H = 0.25; static STEP = 0;
  constructor(m, type) { super(m, type); this.owner = null; this.stuck = false; this.life = 0; this.gravity = 0.03; this.drag = 0.99; }
  // send it along (dx, dy, dz) at speed, spread by inaccuracy (the game's 0.0075 per point)
  shoot(dx, dy, dz, speed, inacc) {
    const l = Math.hypot(dx, dy, dz) || 1;
    dx = dx / l + gauss() * 0.0075 * inacc; dy = dy / l + gauss() * 0.0075 * inacc; dz = dz / l + gauss() * 0.0075 * inacc;
    this.vel.set(dx * speed, dy * speed, dz * speed);
    this.yaw = Math.atan2(-dx, -dz); this.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    this.prevYaw = this.yaw; this.prevPitch = this.pitch;
  }
  tick() {
    this.prev.copy(this.pos); this.prevYaw = this.yaw; this.prevPitch = this.pitch;
    this.age++;
    if (this.stuck) { this.stuckTick(); return; }
    const p = this.pos, v = this.vel, T = this.m.t;
    const sp = v.length();
    if (sp > 1e-6) {
      const dx = v.x / sp, dy = v.y / sp, dz = v.z / sp;
      // the first block on the way
      let tb = T.ray(p.x, p.y, p.z, dx, dy, dz, sp);
      // and the first mob (or the player), its box grown by 0.3
      let hit = null, te = tb;
      this.m.forNear(p.x, p.z, sp + 3, e => {
        if (e === this || e === this.owner && this.age < 5 || e.removed || e.dead || e instanceof Projectile || !e.hurt || e.vehicle === this.owner) return;
        const t = rayBox(p.x, p.y, p.z, dx, dy, dz, e.pos.x - e.hw - 0.3, e.pos.y - 0.3, e.pos.z - e.hw - 0.3, e.pos.x + e.hw + 0.3, e.pos.y + e.h + 0.3, e.pos.z + e.hw + 0.3);
        if (t < te) { te = t; hit = e; }
      });
      const P = this.m.player;
      if (P && P.alive() && (this.owner !== P || this.age >= 5)) {
        const t = rayBox(p.x, p.y, p.z, dx, dy, dz, P.pos.x - 0.6, P.pos.y - 0.3, P.pos.z - 0.6, P.pos.x + 0.6, P.pos.y + 2.1, P.pos.z + 0.6);
        if (t < te) { te = t; hit = P; }
      }
      if (hit) {
        p.set(p.x + dx * te, p.y + dy * te, p.z + dz * te);
        if (this.hitEntity(hit, sp) !== false) return;
      } else if (tb < sp) {
        p.set(p.x + dx * tb, p.y + dy * tb, p.z + dz * tb);
        this.hitBlock(T.rayX, T.rayY, T.rayZ, sp);
        return;
      } else p.add(v);
      // point along the flight
      this.yaw = Math.atan2(-v.x, -v.z); this.pitch = Math.atan2(v.y, Math.hypot(v.x, v.z));
    }
    const inWater = FLUID[T.get(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))] === 1;
    if (inWater && this.m.age % 3 === 0) this.m.particles('bubble', p.x, p.y, p.z, 1, 0.1);
    const d = inWater ? this.waterDrag : this.drag;
    v.multiplyScalar(d);
    v.y -= this.gravity;
    if (++this.life > 1200 || p.y < -128) this.remove();
  }
  get waterDrag() { return 0.8; }
  stuckTick() { if (++this.life > 1200) this.remove(); }
  hitBlock() { this.remove(); }
  hitEntity() { this.remove(); }
}

/* ---- the arrow ---- */
export class Arrow extends Projectile {
  static W = 0.5; static H = 0.5; static MODEL = 'arrow'; static TEX = 'arrow';
  constructor(m, type) { super(m, type); this.gravity = 0.05; this.base = 2; this.crit = false; this.pickup = 0; this.shake = 0; this.knock = 0; }
  get waterDrag() { return 0.6; }
  // drawn along its flight, tipped by its pitch (and quivering after it sticks)
  rootPose(root, t, a) {
    let p = this.prevPitch + (this.pitch - this.prevPitch) * a;
    if (this.shake > 0) p += Math.sin((this.shake - a) * 3) * (this.shake - a) * 0.02;
    root.multiply(t.makeRotationX(-p));
  }
  hitBlock(x, y, z) {
    this.stuck = true; this.life = 0; this.vel.set(0, 0, 0);
    this.stuckAt = [x, y, z];
    this.shake = 7;
    // nudged back so it shows out of the face
    const l = Math.hypot(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    void l;
  }
  stuckTick() {
    if (this.shake > 0) this.shake--;
    // the block it was in went: fall again
    const s = this.stuckAt;
    if (s && !this.m.t.get(s[0], s[1], s[2])) { this.stuck = false; this.vel.set((R() - 0.5) * 0.2, 0, (R() - 0.5) * 0.2); return; }
    // the player walks over it and picks it up
    const P = this.m.player;
    if (this.pickup && P && P.alive() && this.life > 10 && Math.abs(P.pos.x - this.pos.x) < 1.3 && Math.abs(P.pos.z - this.pos.z) < 1.3 && this.pos.y > P.pos.y - 1 && this.pos.y < P.pos.y + 2.3) {
      if (this.m.pickupArrow(this)) { this.remove(); return; }
    }
    super.stuckTick();
  }
  hitEntity(e, speed) {
    let dmg = Math.ceil(Math.max(0, Math.min(speed * this.base, 2147483647)));
    if (this.crit) dmg += Math.floor(R() * (dmg / 2 + 2));
    const src = { type: 'arrow', attacker: this.owner || null, direct: this, x: this.pos.x - this.vel.x, z: this.pos.z - this.vel.z };
    if (e.type === 'enderman') { if (e.teleportAway) e.teleportAway(); return false; }
    const ok = e.isPlayer ? this.m.hurtPlayer(dmg, src) : e.hurt(dmg, src);
    if (ok) {
      if (this.knock > 0 && e.knockback) { const l = Math.hypot(this.vel.x, this.vel.z) || 1; e.knockback(this.knock * 0.6, -this.vel.x / l, -this.vel.z / l); }
      if (this.effect && e.isPlayer) this.m.effectPlayer(this.effect, 600);
      if (this.fire > 0 && e.setFire) e.setFire(5);
      this.remove();
      return true;
    }
    // bounced off (an entity still in its hurt window): back the way it came, slowly
    this.vel.multiplyScalar(-0.1);
    this.yaw += Math.PI;
    return false;
  }
  toJSON() { const o = super.toJSON(); o.st = this.stuck ? 1 : 0; o.pk = this.pickup; o.pi = r3(this.pitch); o.l = this.life; if (this.stuckAt) o.sa = this.stuckAt; return o; }
  fromJSON(o) { super.fromJSON(o); this.stuck = !!o.st; this.pickup = o.pk || 0; this.pitch = this.prevPitch = o.pi || 0; this.life = o.l || 0; this.stuckAt = o.sa || null; }
}
register('arrow', Arrow);

/* ---- thrown things ---- */
export class Snowball extends Projectile {
  static MODEL = 'ball'; static TEX = 'snowball';
  hitEntity(e) {
    const src = { type: 'thrown', attacker: this.owner, direct: this, x: this.pos.x - this.vel.x, z: this.pos.z - this.vel.z };
    // no damage, but a knock (blazes take 3)
    if (e.isPlayer) this.m.hurtPlayer(0.0001, src); else e.hurt(e.type === 'blaze' ? 3 : 0.0001, src);
    this.splat(); this.remove();
  }
  hitBlock() { this.splat(); this.remove(); }
  splat() { this.m.particles('poof', this.pos.x, this.pos.y, this.pos.z, 8, 0.1, [1, 1, 1]); }
}
register('snowball', Snowball);
export class Egg extends Snowball {
  static TEX = 'egg';
  // one throw in eight hatches a chick (and one of those in 32, four)
  splat() {
    this.m.particles('poof', this.pos.x, this.pos.y, this.pos.z, 8, 0.1, [0.95, 0.92, 0.8]);
    if (R() < 1 / 8) {
      const n = R() < 1 / 32 ? 4 : 1;
      for (let i = 0; i < n; i++) { const c = this.m.spawn('chicken', this.pos.x, this.pos.y, this.pos.z); if (c) c.ageT = -24000; }
    }
  }
}
register('egg', Egg);
/* A witch's splash potion: breaks where it lands and puts its effect on
   everyone within 4 blocks, weaker further away. Harming hurts 6 (3 hearts)
   at the middle. */
export class Potion extends Snowball {
  static TEX = 'splash_potion';
  constructor(m, type) { super(m, type); this.gravity = 0.05; this.kind = 'harming'; }
  splat() {
    const p = this.pos, col = { harming: [0.26, 0.04, 0.04], poison: [0.31, 0.58, 0.19], slowness: [0.35, 0.42, 0.5], weakness: [0.28, 0.29, 0.28], healing: [0.97, 0.14, 0.14] }[this.kind] || [0.5, 0.2, 0.5];
    this.m.particles('poof', p.x, p.y, p.z, 20, 0.25, col);
    const P = this.m.player;
    const hit = (e, isP) => {
      const d2 = (e.pos.x - p.x) ** 2 + (e.pos.y - p.y) ** 2 + (e.pos.z - p.z) ** 2;
      if (d2 >= 16) return;
      const k = 1 - Math.sqrt(d2) / 4;
      if (this.kind === 'harming') { const dmg = Math.floor(6 * k + 0.5); if (isP) this.m.hurtPlayer(dmg, { type: 'magic', attacker: this.owner, noKnock: true }); else if (!e.constructor.UNDEAD) e.hurt(dmg, { type: 'magic', attacker: this.owner, noKnock: true }); else e.heal(dmg); }
      else if (isP) this.m.effectPlayer(this.kind, Math.floor((this.kind === 'poison' ? 900 : this.kind === 'slowness' ? 1800 : 1800) * 0.75 * k));
    };
    if (P && P.alive()) hit(P, true);
    this.m.forNear(p.x, p.z, 5, e => { if (e.hurt && !(e instanceof Projectile) && !e.dead) hit(e, false); });
  }
}
register('potion', Potion);
