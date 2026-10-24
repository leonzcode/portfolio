/* ---------------------------------------------------------------------------
   Leoncraft 2 - a thrown trident (the Trident page, Java Edition).

   Thrown at 2.5 blocks a tick, it falls 0.05 a tick and keeps 0.99 of its
   speed in air and in water alike. The first mob it meets takes 8 (and
   Impaling's 2.5 a level on water mobs), then it bounces off and drops.
   It sticks in a block as an arrow does. With Loyalty, once it has hit
   something (or been in a block four ticks) it flies home through
   anything, 0.05 a level a tick towards your eyes; without, it waits to be
   picked up. Channeling in a thunderstorm calls lightning down on the mob
   it hits (or a lightning rod) if the sky is open above.
--------------------------------------------------------------------------- */
import { Projectile } from '../entities/projectiles.js?v=107';
import { register } from '../entities/mobs.js?v=107';
import { model } from '../entities/mobs2.js?v=107';
import { addArt } from '../entities/mobart.js?v=107';
import { B } from '../blocks.js?v=107';
import { I } from '../items.js?v=107';
import { enchantBonus, enchOf } from './weapons.js?v=107';

/* ---- the shape: a long pole with three prongs, pointing along -z ---- */
model('trident', [
  { name: 'pole', pivot: [0, 24, 0], boxes: [
    [-0.5, -0.5, -12, 1, 1, 26, 0, 0],          // the pole
    [-2.5, -0.5, -12, 5, 1, 1, 34, 30],         // the crossbar
    [-0.5, -0.5, -17, 1, 1, 5, 0, 30],          // the middle prong
    [-2.5, -0.5, -15, 1, 1, 3, 14, 30],         // the side prongs
    [1.5, -0.5, -15, 1, 1, 3, 24, 30],
  ] },
]);
addArt('trident', [64, 64], p => {
  p.box(0, 0, 1, 1, 26, 0x2f6d6a, 0.1);
  p.box(34, 30, 5, 1, 1, 0x5ab8a8, 0.06);
  p.box(0, 30, 1, 1, 5, 0x7fe0d0, 0.06);
  p.box(14, 30, 1, 1, 3, 0x7fe0d0, 0.06);
  p.box(24, 30, 1, 1, 3, 0x7fe0d0, 0.06);
});

export class ThrownTrident extends Projectile {
  static W = 0.5; static H = 0.5; static MODEL = 'trident'; static TEX = 'trident';
  constructor(m, type) {
    super(m, type);
    this.gravity = 0.05; this.drag = 0.99;
    this.stack = null; this.pickup = 1; this.dealt = false; this.returning = false; this.groundT = 0; this.shake = 0;
  }
  get waterDrag() { return 0.99; }
  get loyalty() { return enchOf(this.stack, 'loyalty'); }
  rootPose(root, t, a) {
    let p = this.prevPitch + (this.pitch - this.prevPitch) * a;
    if (this.shake > 0) p += Math.sin((this.shake - a) * 3) * (this.shake - a) * 0.02;
    root.multiply(t.makeRotationX(-p));
  }
  // after it has hit something it passes through mobs
  skip() { return this.dealt || this.returning; }
  tick() {
    const owner = this.owner;
    if ((this.dealt || this.groundT > 4) && this.loyalty > 0 && owner && owner.isPlayer) {
      if (!owner.alive()) { this.dropHere(); return; }
      this.homeTick(owner);
      return;
    }
    if (this.pos.y < -128 && this.loyalty > 0 && owner && owner.isPlayer && owner.alive()) { this.dealt = true; this.stuck = false; return; }
    super.tick();
  }
  // flying home through anything, a little faster each tick
  homeTick(owner) {
    this.prev.copy(this.pos); this.prevYaw = this.yaw; this.prevPitch = this.pitch;
    this.age++;
    this.returning = true; this.stuck = false;
    const L = this.loyalty, p = this.pos, v = this.vel;
    const ex = owner.pos.x - p.x, ey = owner.pos.y + 1.62 - p.y, ez = owner.pos.z - p.z;
    p.y += ey * 0.015 * L;
    const l = Math.hypot(ex, ey, ez) || 1, k = 0.05 * L;
    v.set(v.x * 0.95 + ex / l * k, v.y * 0.95 + ey / l * k, v.z * 0.95 + ez / l * k);
    p.add(v);
    this.yaw = Math.atan2(-v.x, -v.z); this.pitch = Math.atan2(v.y, Math.hypot(v.x, v.z));
    if (this.touchesOwner(owner)) this.takeBack();
  }
  touchesOwner(o) {
    const p = this.pos;
    return Math.abs(o.pos.x - p.x) < 1.3 + 0.25 && Math.abs(o.pos.z - p.z) < 1.3 + 0.25 && p.y + 0.5 > o.pos.y - 0.5 && p.y < o.pos.y + 2.3;
  }
  takeBack() {
    const c = this.m.combat;
    if (c ? c.pickupTrident(this) : true) this.remove();
  }
  // nobody to go back to: it drops as an item (wear and enchantments kept)
  dropHere() {
    const D = window.__lc2 && window.__lc2.drops;
    if (this.pickup === 1 && this.stack && D && D.spawn) D.spawn(this.pos.x, this.pos.y, this.pos.z, this.stack);
    this.remove();
  }
  hitEntity(e, speed) {
    void speed;
    if (this.dealt) return false;
    const owner = this.owner;
    const dmg = 8 + enchantBonus(this.stack, e);
    const src = { type: 'trident', attacker: owner || null, direct: this, player: !!(owner && owner.isPlayer), x: this.pos.x - this.vel.x, z: this.pos.z - this.vel.z };
    this.dealt = true;
    const ok = e.isPlayer ? this.m.hurtPlayer(dmg, src) : e.hurt(dmg, src);
    if (ok && owner && owner.isPlayer && !e.isPlayer) e.lastHurtByPlayer = this.m.age;
    if (ok && enchOf(this.stack, 'channeling')) this.channel(Math.floor(e.pos.x), Math.floor(e.pos.y), Math.floor(e.pos.z));
    // bounce off and fall
    this.vel.set(this.vel.x * -0.01, this.vel.y * -0.1, this.vel.z * -0.01);
    return true;
  }
  hitBlock(x, y, z) {
    this.stuck = true; this.life = 0; this.vel.set(0, 0, 0); this.stuckAt = [x, y, z]; this.shake = 7;
    if (enchOf(this.stack, 'channeling') && this.m.t.get(x, y, z) === B.lightning_rod) this.channel(x, y + 1, z);
  }
  // lightning, if a storm is on and the sky is open over (x, y, z)
  channel(x, y, z) {
    const sim = this.m.inter && this.m.inter.sim, W = sim && sim.weather;
    if (!W || !W.thundering || !W.strike) return;
    if (sim.canSeeSky && !sim.canSeeSky(x, y, z)) return;
    W.strike(x, y, z);
  }
  stuckTick() {
    if (this.shake > 0) this.shake--;
    this.groundT++;
    const s = this.stuckAt;
    if (s && !this.m.t.get(s[0], s[1], s[2])) { this.stuck = false; this.groundT = 0; return; }
    const o = this.m.player;
    if (o && o.alive() && this.groundT > 7 && this.touchesOwner(o)) { this.takeBack(); return; }
    // without Loyalty it lies there a minute, as an arrow does
    if (this.loyalty <= 0 && ++this.life > 1200) this.remove();
  }
  toJSON() {
    const o = super.toJSON();
    o.st = this.stuck ? 1 : 0; o.pi = Math.round(this.pitch * 1000) / 1000; o.pk = this.pickup; o.dl = this.dealt ? 1 : 0;
    if (this.stuckAt) o.sa = this.stuckAt;
    if (this.stack) o.it = { d: this.stack.dmg | 0, e: this.stack.ench || null };
    return o;
  }
  fromJSON(o) {
    super.fromJSON(o);
    this.stuck = !!o.st; this.pitch = this.prevPitch = o.pi || 0; this.pickup = o.pk === undefined ? 1 : o.pk; this.dealt = !!o.dl;
    this.stuckAt = o.sa || null;
    if (o.it && I.trident !== undefined) { this.stack = { id: I.trident, count: 1 }; if (o.it.d) this.stack.dmg = o.it.d; if (o.it.e) this.stack.ench = o.it.e; }
    // a trident saved in flight comes back to whoever is playing
    if (this.pickup) this.owner = this.m.player;
  }
}
register('trident', ThrownTrident);
