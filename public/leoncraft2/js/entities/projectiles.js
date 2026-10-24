/* ---------------------------------------------------------------------------
   Leoncraft 2 - things that fly: arrows, eggs, snowballs, thrown potions.

   An arrow moves by its velocity, then slows by 0.99 a tick (0.6 in water)
   and falls 0.05; it hits the first block or mob along its path that tick.
   Damage is the speed it hits at times its base damage (2), rounded up, so
   a skeleton's arrow does 1 to 4 (5 on Hard) depending on how far it flew;
   a critical arrow adds a random 0 to damage / 2 + 1. Punch pushes 0.6 a
   level along the flight (and 0.1 up); Piercing goes through that many
   mobs and one more; a tipped arrow gives an eighth of its potion, a
   spectral one 10 seconds of Glowing. Stuck in a block it stays for a
   minute (1200 ticks). Thrown things fall 0.03 a tick and drag 0.99.
--------------------------------------------------------------------------- */
import { Entity, r3 } from './entity.js?v=107';
import { rayBox } from './terrain.js?v=107';
import { register } from './mobs.js?v=107';
import { FLUID } from '../blocks.js?v=107';
import { POTIONS } from '../brewing.js?v=107';
import { applyPotion, splashPotion, lingeringPotion } from './mobfx.js?v=107';

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
        if (e === this || e === this.owner && this.age < 5 || e.removed || e.dead || e instanceof Projectile || !e.hurt || (this.owner && e.vehicle === this.owner) || (this.skip && this.skip(e))) return;
        const t = rayBox(p.x, p.y, p.z, dx, dy, dz, e.pos.x - e.hw - 0.3, e.pos.y - 0.3, e.pos.z - e.hw - 0.3, e.pos.x + e.hw + 0.3, e.pos.y + e.h + 0.3, e.pos.z + e.hw + 0.3);
        if (t < te) { te = t; hit = e; }
      });
      const P = this.m.player;
      if (P && P.alive() && (this.owner !== P || this.age >= 5) && !(this.skip && this.skip(P))) {
        const t = rayBox(p.x, p.y, p.z, dx, dy, dz, P.pos.x - 0.6, P.pos.y - 0.3, P.pos.z - 0.6, P.pos.x + 0.6, P.pos.y + 2.1, P.pos.z + 0.6);
        if (t < te) { te = t; hit = P; }
      }
      if (hit) {
        p.set(p.x + dx * te, p.y + dy * te, p.z + dz * te);
        if (this.hitEntity(hit, sp) !== false) return;
      } else if (tb < sp) {
        p.set(p.x + dx * tb, p.y + dy * tb, p.z + dz * tb);
        // the simulation hears of it (a target block, sim/rsparts.js)
        if (this.m.onProjectileBlock) this.m.onProjectileBlock(this, T.rayX, T.rayY, T.rayZ);
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
  // a piercing arrow passes the mobs it has already gone through, and any arrow what it has bounced off
  skip(e) { const k = e.id === undefined ? 'player' : e.id; return !!((this.pierced && this.pierced.has(k)) || (this.bounced && this.bounced.has(k))); }
  hitEntity(e, speed) {
    let dmg = Math.ceil(Math.max(0, Math.min(speed * this.base, 2147483647)));
    if (this.crit) dmg += Math.floor(R() * (Math.floor(dmg / 2) + 2));
    const src = { type: 'arrow', attacker: this.owner || null, direct: this, player: !!(this.owner && this.owner.isPlayer), x: this.pos.x - this.vel.x, z: this.pos.z - this.vel.z };
    if (e.type === 'enderman') { if (e.teleportAway) e.teleportAway(); return false; }
    if (this.pierce > 0) {
      const k = e.id === undefined ? 'player' : e.id;
      this.pierced = this.pierced || new Set();
      if (this.pierced.size >= this.pierce + 1) { this.remove(); return true; }
      this.pierced.add(k);
    }
    // on fire itself, it sets what it hits alight for 5 seconds (an enderman aside)
    if (this.fire > 0 && e.setFire && !e.isPlayer) e.setFire(5);
    const ok = e.isPlayer ? this.m.hurtPlayer(dmg, src) : e.hurt(dmg, src);
    if (ok) {
      if (src.player && !e.isPlayer) e.lastHurtByPlayer = this.m.age;
      // Punch: a push along the flight, 0.6 a level, less by the target's knockback resistance
      if (this.knock > 0) {
        const l = Math.hypot(this.vel.x, this.vel.z) || 1, k = this.knock * 0.6 * Math.max(0, 1 - (e.kbResist || 0));
        if (e.isPlayer) e.push(this.vel.x / l * k, 0.1, this.vel.z / l * k); else { e.vel.x += this.vel.x / l * k; e.vel.y += 0.1; e.vel.z += this.vel.z / l * k; }
      }
      // (a stray's slowness lasts 30 seconds, a bogged's poison 4: effectT)
      if (this.effect && e.isPlayer) this.m.effectPlayer(this.effect, this.effectT || 600);
      if (e.isPlayer && this.item === 'spectral_arrow') this.m.effectPlayer('glowing', 200);
      if (e.isPlayer && this.potion) tippedOnPlayer(this.m.survival, this.potion);
      // on a mob: an eighth of each effect's time (at least a tick), instant ones in full
      else if (this.potion && !e.isPlayer) applyPotion(this.m, e, this.potion, 0.125, 1, this.owner, 0);
      if (this.effect && !e.isPlayer && e.addEffect) e.addEffect(this.effect, 1, this.effectT || 600, this.owner);
      if (!e.isPlayer && this.item === 'spectral_arrow' && e.addEffect) e.addEffect('glowing', 1, 200, this.owner);
      if (!(this.pierce > 0)) this.remove();
      return true;
    }
    if (this.pierce > 0) return true;
    // bounced off (a raised shield, or an entity still in its hurt window): back the way it came, slowly, and never
    // into the same one again (it was left on the edge of their box, so it hit again every tick and the hit landed
    // the moment the shield came down)
    (this.bounced || (this.bounced = new Set())).add(e.id === undefined ? 'player' : e.id);
    this.vel.multiplyScalar(-0.1);
    this.yaw += Math.PI;
    return false;
  }
  toJSON() { const o = super.toJSON(); o.st = this.stuck ? 1 : 0; o.pk = this.pickup; o.pi = r3(this.pitch); o.l = this.life; if (this.stuckAt) o.sa = this.stuckAt; return o; }
  fromJSON(o) { super.fromJSON(o); this.stuck = !!o.st; this.pickup = o.pk || 0; this.pitch = this.prevPitch = o.pi || 0; this.life = o.l || 0; this.stuckAt = o.sa || null; }
}
register('arrow', Arrow);

// a tipped arrow's potion on the player: an eighth of each effect's time (instant ones in full)
function tippedOnPlayer(sv, potion) {
  const p = POTIONS[potion];
  if (!sv || !p) return;
  for (const [e, lv, t] of p.effects) {
    if (e === 'instant_health') sv.heal(4 << (lv - 1));
    else if (e === 'instant_damage') sv.hurtEffect(6 << (lv - 1), 'magic');
    else sv.addEffect(e, lv, Math.max(1, Math.floor(t / 8)));
  }
}

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
/* A thrown potion (splash or lingering): it falls 0.05 a tick and breaks on
   the first block or mob it meets (entities/mobfx.js has what it does).
   potion: its name (harming, long_swiftness...); a witch sets kind. */
export class Potion extends Snowball {
  static TEX = 'splash_potion';
  constructor(m, type) { super(m, type); this.gravity = 0.05; this.potion = 'harming'; this.lingering = false; this.direct = null; }
  set kind(k) { this.potion = k; }
  get kind() { return this.potion; }
  hitEntity(e) { this.direct = e; this.splat(); this.remove(); }
  splat() {
    const p = this.pos, pp = POTIONS[this.potion] || POTIONS.water;
    const c = pp.colour;
    this.m.particles('magic', p.x, p.y, p.z, 24, 0.5, [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255]);
    this.m.particles('poof', p.x, p.y, p.z, 6, 0.2, [0.9, 0.9, 0.95]);
    if (this.lingering) lingeringPotion(this.m, p.x, p.y, p.z, this.potion, this.owner);
    else splashPotion(this.m, p.x, p.y, p.z, this.potion, this.owner, this.direct);
  }
  toJSON() { const o = super.toJSON(); o.po = this.potion; if (this.lingering) o.li = 1; return o; }
  fromJSON(o) { super.fromJSON(o); if (o.po) this.potion = o.po; this.lingering = !!o.li; }
}
register('potion', Potion);
